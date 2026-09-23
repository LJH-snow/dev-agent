import assert from "node:assert/strict";
import test from "node:test";

import { DesktopRunState } from "../dist/run-state.js";

test("run replay keeps only bounded, metadata-safe event data", () => {
  const run = new DesktopRunState("session-1", "run-1", "2026-09-21T10:00:00.000Z");

  run.append({
    type: "token",
    data: { token: "partial", secret: "must not leak" },
  });
  run.append({
    type: "tool",
    data: {
      name: "filesystem",
      input: { path: "/private/secret.txt", contents: "sensitive" },
    },
  });
  run.append({
    type: "tool-result",
    data: {
      name: "filesystem",
      output: "raw command output must not leak",
    },
  });
  run.append({
    type: "approval-request",
    data: {
      id: "approval-1",
      tool: "filesystem",
      reason: "needs approval",
      input: { path: "/private/secret.txt" },
      review: { diff: "private diff" },
    },
  });
  run.append({
    type: "runtime",
    data: {
      event: {
        type: "tool.input",
        sequence: 4,
        data: { raw: "must not leak" },
      },
    },
  });
  run.append({
    type: "error",
    data: { message: "raw provider error must not leak" },
  });

  const snapshot = run.snapshot();
  assert.deepEqual(snapshot.events[0]?.data, { token: "partial" });
  assert.deepEqual(snapshot.events[1]?.data, { name: "filesystem" });
  assert.deepEqual(snapshot.events[2]?.data, { name: "filesystem" });
  assert.deepEqual(snapshot.events[3]?.data, {
    id: "approval-1",
    tool: "filesystem",
    reason: "needs approval",
  });
  assert.deepEqual(snapshot.events[4]?.data, {
    event: { type: "tool.input", sequence: 4 },
  });
  assert.deepEqual(snapshot.events[5]?.data, {});
  assert.equal(JSON.stringify(snapshot).includes("must not leak"), false);
  assert.equal(JSON.stringify(snapshot).includes("private"), false);
});

test("run replay is bounded by event count and text size", () => {
  const run = new DesktopRunState("session-1", "run-1");
  const oversizedToken = "x".repeat(20 * 1024);

  run.append({ type: "token", data: { token: oversizedToken } });
  const oversizedSnapshot = run.snapshot();
  assert.equal(oversizedSnapshot.live.assistant?.length, 20 * 1024);
  for (let index = 0; index < 300; index += 1) {
    run.append({ type: "turn", data: { turn: index } });
  }

  const snapshot = run.snapshot();
  assert.equal(snapshot.sequence, 301);
  assert.equal(snapshot.truncated, true);
  assert.ok(snapshot.events.length <= 256);
  assert.ok(snapshot.events[0]?.sequence > 1);
  assert.equal((snapshot.events[0]?.data.token as string | undefined)?.length, undefined);
});

test("terminal run clears live fragments and remains inactive", () => {
  const run = new DesktopRunState("session-1", "run-1");
  run.append({ type: "token", data: { token: "unfinished answer" } });
  run.append({
    type: "approval-request",
    data: { id: "approval-1", tool: "filesystem", reason: "review" },
  });
  run.append({ type: "done", data: { status: "done", turns: 1 } });

  const snapshot = run.snapshot();
  assert.equal(snapshot.active, false);
  assert.equal(snapshot.status, "done");
  assert.deepEqual(snapshot.live, {});
  assert.ok(snapshot.finishedAt);
});

test("plan review replay keeps a bounded diff for the desktop review card", () => {
  const run = new DesktopRunState("session-1", "run-plan");

  run.append({
    type: "plan-review",
    data: {
      review: {
        changeSetId: "change-1",
        createdAt: "2026-09-22T00:00:00.000Z",
        additions: 1,
        deletions: 1,
        files: [{
          path: "src/example.ts",
          kind: "file",
          beforeHash: "before",
          afterHash: "after",
          diff: "-old\n+new",
          additions: 1,
          deletions: 1,
          beforeExists: true,
          afterExists: true,
        }],
      },
      secret: "must not leak",
    },
  });

  const snapshot = run.snapshot();
  assert.deepEqual(snapshot.events[0]?.data, {
    review: {
      changeSetId: "change-1",
      createdAt: "2026-09-22T00:00:00.000Z",
      additions: 1,
      deletions: 1,
      files: [{
        path: "src/example.ts",
        kind: "file",
        beforeHash: "before",
        afterHash: "after",
        diff: "-old\n+new",
        additions: 1,
        deletions: 1,
        beforeExists: true,
        afterExists: true,
      }],
    },
  });
  assert.equal(snapshot.status, "waiting");
});
