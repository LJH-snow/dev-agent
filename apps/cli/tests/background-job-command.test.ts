import assert from "node:assert/strict";
import test from "node:test";

import {
  formatBackgroundJobCommandResult,
  parseBackgroundJobCommand,
} from "../dist/background-job-command.js";

const job = {
  id: "job-0123456789abcdef",
  status: "running" as const,
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:01.000Z",
  runCount: 1,
  projectRoot: "/workspace",
  worktreePath: "/private/jobs/job-0123456789abcdef/worktrees/task",
  sessionId: "job-0123456789abcdef",
};

test("parses background job list, start, inspect, cancel, and explicit resume commands", () => {
  assert.deepEqual(parseBackgroundJobCommand(":jobs"), { handled: true, action: "list" });
  assert.deepEqual(parseBackgroundJobCommand("/jobs"), { handled: true, action: "list" });
  assert.deepEqual(parseBackgroundJobCommand(":job start fix the bug"), {
    handled: true,
    action: "start",
    prompt: "fix the bug",
  });
  assert.deepEqual(parseBackgroundJobCommand(":job resume job-0123456789abcdef"), {
    handled: true,
    action: "resume",
    id: "job-0123456789abcdef",
  });
  assert.deepEqual(parseBackgroundJobCommand(":job cancel job-0123456789abcdef"), {
    handled: true,
    action: "cancel",
    id: "job-0123456789abcdef",
  });
  assert.deepEqual(parseBackgroundJobCommand(":job job-0123456789abcdef"), {
    handled: true,
    action: "inspect",
    id: "job-0123456789abcdef",
  });
  assert.equal(parseBackgroundJobCommand(":unknown").handled, false);
});

test("renders bounded metadata without a task prompt or agent output", () => {
  const list = formatBackgroundJobCommandResult(
    { handled: true, action: "list" },
    [job],
  );
  assert.match(list, /job-0123456789abcdef/);
  assert.doesNotMatch(list, /secret prompt|model output/);
  const inspect = formatBackgroundJobCommandResult(
    { handled: true, action: "inspect", id: job.id },
    [],
    job,
  );
  assert.match(inspect, /Status: running/);
  assert.match(inspect, /Worktree: \/private\/jobs/);
  assert.doesNotMatch(inspect, /secret prompt|model output/);
});
