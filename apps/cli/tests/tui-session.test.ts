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
