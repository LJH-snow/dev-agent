import assert from "node:assert/strict";
import test from "node:test";

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

test("cancellation closes active cards and ignores late tool results", () => {
  const session = new TuiSessionModel();
  const id = session.dispatch({ type: "tool-start", name: "shell", input: "sleep 10" });

  session.dispatch({ type: "turn-interrupted", reason: "SIGINT" });
  session.dispatch({ type: "tool-finish", id, output: "late result" });

  const card = session.snapshot().cards[0];
  assert.equal(session.snapshot().state, "interrupted");
  assert.equal(card?.status, "cancelled");
  assert.notEqual(card?.output, "late result");
});
