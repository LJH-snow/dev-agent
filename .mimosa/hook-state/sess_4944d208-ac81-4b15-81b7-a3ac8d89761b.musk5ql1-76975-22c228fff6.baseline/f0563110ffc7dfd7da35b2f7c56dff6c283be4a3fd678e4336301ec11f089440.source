import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeEventSequence } from "@dev-agent/agent-core";
import {
  TuiSessionModel,
  renderToolCard,
  type TuiRunState,
} from "../dist/tui-session.js";

test("a turn moves from ready to thinking to streaming and back to ready", () => {
  const session = new TuiSessionModel();

  assert.equal(session.snapshot().state, "ready");
  session.dispatch({ type: "turn-start" });
  assert.equal(session.snapshot().state, "thinking");
  session.dispatch({ type: "assistant-token", text: "hello" });
  assert.equal(session.snapshot().state, "streaming");
  session.dispatch({ type: "turn-complete" });
  assert.equal(session.snapshot().state, "ready");
});

test("approval and validation are explicit states", () => {
  const session = new TuiSessionModel();

  session.dispatch({ type: "turn-start" });
  session.dispatch({ type: "approval-request", tool: "filesystem" });
  assert.equal(session.snapshot().state, "waiting-approval");
  session.dispatch({ type: "approval-resolved", decision: "allow" });
  session.dispatch({ type: "validation-start" });
  assert.equal(session.snapshot().state, "validating");
});

test("tool card updates in place instead of duplicating call and result blocks", () => {
  const session = new TuiSessionModel();
  const id = session.dispatch({ type: "tool-start", name: "shell", input: "pwd" });

  session.dispatch({ type: "tool-progress", id, detail: "running 1/1" });
  assert.equal(session.snapshot().cards.length, 1);
  assert.equal(session.snapshot().cards[0]?.detail, "running 1/1");
  session.dispatch({ type: "tool-finish", id, output: "/tmp/project" });
  const cards = session.snapshot().cards;

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.status, "completed");
  assert.match(renderToolCard(cards[0]!, { width: 48 }), /shell/);
});

test("runtime tool progress updates the existing card with bounded numeric progress", () => {
  const session = new TuiSessionModel();
  const sequence = new RuntimeEventSequence("progress-ui");

  session.applyRuntimeEvent(
    sequence.create("run.started", { prompt: "index" }, { runId: "run-progress" }),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "tool.started",
      { tool: "mcp:search" },
      { runId: "run-progress" },
    ),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "tool.progress",
      {
        tool: "mcp:search",
        progress: 30,
        total: 10,
        detail: "scanning",
      },
      { runId: "run-progress" },
    ),
  );

  const cards = session.snapshot().cards;
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0]?.progress, { progress: 10, total: 10 });
  assert.equal(cards[0]?.detail, "scanning");
});

test("terminal state events preserve an explicit state before returning to ready", () => {
  const session = new TuiSessionModel();

  session.dispatch({ type: "turn-start" });
  session.dispatch({ type: "turn-error", message: "provider unavailable" });
  assert.equal(session.snapshot().state, "error" satisfies TuiRunState);
  session.dispatch({ type: "ready" });
  assert.equal(session.snapshot().state, "ready");
});

test("late callbacks cannot reopen a failed turn", () => {
  const session = new TuiSessionModel();

  session.dispatch({ type: "turn-start" });
  session.dispatch({ type: "turn-error", message: "provider unavailable" });
  session.dispatch({ type: "assistant-token", text: "late token" });
  session.dispatch({ type: "tool-start", name: "shell", input: "pwd" });

  assert.equal(session.snapshot().state, "error");
  assert.equal(session.snapshot().cards.length, 0);
});

test("approval and validation cards keep stable identities through resolution", () => {
  const session = new TuiSessionModel();
  const approvalId = session.dispatch({
    type: "approval-request",
    tool: "filesystem",
    detail: "1 file, +2/-1",
  });

  session.dispatch({ type: "approval-resolved", id: approvalId, decision: "allow" });
  const validationId = session.dispatch({
    type: "validation-start",
    detail: "running trusted checks",
  });
  session.dispatch({
    type: "validation-result",
    id: validationId,
    status: "blocked",
    detail: "postimage changed",
  });

  const cards = session.snapshot().cards;
  assert.deepEqual(cards.map((card) => card.id), [approvalId, validationId]);
  assert.equal(cards[0]?.status, "completed");
  assert.equal(cards[1]?.status, "blocked");
});

test("approval cards retain a review diff for the rich renderer", () => {
  const session = new TuiSessionModel();
  const approvalId = session.dispatch({
    type: "approval-request",
    tool: "filesystem",
    detail: "review required",
    diff: "```diff\n+new line\n```",
  });

  const card = session.snapshot().cards.find((candidate) => candidate.id === approvalId);
  assert.equal(card?.diff, "```diff\n+new line\n```");
  assert.match(renderToolCard(card!, { width: 48 }), /diff:/);
  assert.match(renderToolCard(card!, { width: 48 }), /new line/);
  assert.match(renderToolCard(card!, { width: 48 }), /\[allow\].*\[deny\]/);
  assert.match(
    renderToolCard(card!, { width: 48, collapsed: true }),
    /collapsed; expand this card/
  );
});

test("runtime sandbox expansion cards resolve independently from ordinary approvals", () => {
  const session = new TuiSessionModel();
  const sequence = new RuntimeEventSequence("sandbox-ui");

  session.applyRuntimeEvent(
    sequence.create("run.started", { prompt: "run a command" }, { runId: "run-1" })
  );
  session.applyRuntimeEvent(
    sequence.create(
      "tool.approval-requested",
      { tool: "shell", reason: "dangerous command" },
      { runId: "run-1" }
    )
  );
  session.applyRuntimeEvent(
    sequence.create(
      "tool.sandbox-expansion-requested",
      {
        tool: "shell",
        capability: "network",
        reason: "network access was denied",
      },
      { runId: "run-1" }
    )
  );

  session.applyRuntimeEvent(
    sequence.create(
      "tool.sandbox-expansion-resolved",
      { tool: "shell", capability: "network", decision: "allow" },
      { runId: "run-1" }
    )
  );
  session.applyRuntimeEvent(
    sequence.create(
      "tool.approval-resolved",
      { tool: "shell", decision: "deny" },
      { runId: "run-1" }
    )
  );

  const cards = session.snapshot().cards;
  assert.equal(cards.length, 2);
  assert.equal(cards[0]?.status, "failed");
  assert.equal(cards[1]?.status, "completed");
  assert.match(cards[1]?.detail ?? "", /allow/);
});

test("runtime approval review metadata becomes a bounded card diff", () => {
  const session = new TuiSessionModel();
  const sequence = new RuntimeEventSequence("review-diff-ui");

  session.applyRuntimeEvent(
    sequence.create("run.started", { prompt: "edit a file" }, { runId: "run-review" }),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "tool.approval-requested",
      {
        tool: "filesystem",
        reason: "review required",
        review: {
          changeSetId: "change-1",
          additions: 1,
          deletions: 1,
          files: [
            {
              path: "src/index.ts",
              kind: "file",
              diff: "--- a/src/index.ts\n+++ b/src/index.ts\n-const old = 1;\n+const next = 2;\n",
              additions: 1,
              deletions: 1,
            },
          ],
        },
      },
      { runId: "run-review" },
    ),
  );

  const card = session.snapshot().cards.at(-1);
  assert.equal(card?.kind, "approval");
  assert.match(card?.diff ?? "", /src\/index\.ts/);
  assert.match(card?.diff ?? "", /\+const next/);
});

test("cancellation closes active cards and ignores late tool results", () => {
  const session = new TuiSessionModel();
  const id = session.dispatch({ type: "tool-start", name: "shell", input: "sleep 10" });

  session.dispatch({ type: "turn-interrupted", reason: "SIGINT" });
  session.dispatch({ type: "tool-finish", id, output: "late result" });

  const card = session.snapshot().cards[0];
  assert.equal(session.snapshot().state, "interrupted");
  assert.equal(session.snapshot().error, undefined);
  assert.equal(card?.status, "cancelled");
  assert.notEqual(card?.output, "late result");
});

test("subscribers receive a fresh snapshot after session updates", () => {
  const session = new TuiSessionModel();
  const snapshots: string[] = [];
  const unsubscribe = session.subscribe((snapshot) => snapshots.push(snapshot.state));

  session.dispatch({ type: "turn-start" });
  session.dispatch({ type: "assistant-token", text: "hello" });
  unsubscribe();
  session.dispatch({ type: "turn-complete" });

  assert.deepEqual(snapshots, ["thinking", "streaming"]);
});
