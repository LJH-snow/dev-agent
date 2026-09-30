import assert from "node:assert/strict";
import test from "node:test";

import {
  EXIT_CODES,
  BudgetTracker,
  NonInteractiveController,
  createEventEmitter,
  createNonInteractiveController,
  createNonInteractiveGuard,
  type EventEnvelope,
} from "../dist/non-interactive.js";

test("exposes stable non-interactive exit codes", () => {
  assert.deepEqual(EXIT_CODES, {
    success: 0,
    findings: 2,
    policy_denied: 3,
    config_error: 4,
    runtime_unavailable: 5,
    execution_error: 6,
    usage_error: 64,
  });
});

test("event emitter produces deterministic JSON envelopes with monotonically increasing sequence", () => {
  const lines: string[] = [];
  let now = 1_757_000_000_000;
  let id = 0;
  const emitter = createEventEmitter({
    clock: () => now,
    idGenerator: () => `event-${++id}`,
    write: (line) => lines.push(line),
    cwd: "/Users/alice/project",
  });

  const first = emitter.emitJsonEvent("run.started", {
    cwd: "/Users/alice/project",
    provider: "openai",
    apiKey: "sk-test-secret",
    command: "node /Users/alice/project/bin.js",
    stdout: "raw command output must not be emitted",
  });
  now += 10;
  const second = emitter.emit("run.finished", { ok: true });

  const firstEvent = JSON.parse(first) as EventEnvelope;
  assert.equal(firstEvent.schemaVersion, 1);
  assert.equal(firstEvent.eventId, "event-1");
  assert.equal(firstEvent.sequence, 1);
  assert.equal(firstEvent.type, "run.started");
  assert.equal(firstEvent.timestamp, new Date(1_757_000_000_000).toISOString());
  assert.equal(second.sequence, 2);
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]!), second);

  const serialized = JSON.stringify(firstEvent);
  assert.doesNotMatch(serialized, /Users\/alice\/project/);
  assert.doesNotMatch(serialized, /sk-test-secret/);
  assert.doesNotMatch(serialized, /raw command output must not be emitted/);
  assert.match(serialized, /redacted/);
});

test("event redaction removes secret-like keys and absolute paths recursively", () => {
  const event = createEventEmitter({
    clock: () => 1_757_000_000_000,
    idGenerator: () => "fixed",
  }).emit("diagnostic", {
    nested: {
      authorization: "Bearer super-secret",
      token: "token-value",
      path: "/private/tmp/work/file.txt",
      message: "failed at /Users/alice/workspace/src/index.ts",
    },
    stderr: "command stderr with private details",
  });

  const json = JSON.stringify(event);
  assert.doesNotMatch(json, /super-secret|token-value|private details/);
  assert.doesNotMatch(json, /\/private\/tmp|\/Users\/alice/);
});

test("non-interactive controller fails closed without reading stdin", () => {
  const controller = createNonInteractiveController({ interactive: false });
  assert.ok(controller instanceof NonInteractiveController);

  assert.deepEqual(controller.guard({ kind: "approval", action: "write file" }), {
    allowed: false,
    kind: "policy_denied",
    exitCode: EXIT_CODES.policy_denied,
    reason: "approval_required",
    interactive: false,
  });
  assert.deepEqual(controller.guard({ kind: "input", prompt: "Choose a provider" }), {
    allowed: false,
    kind: "needs_input",
    exitCode: EXIT_CODES.policy_denied,
    reason: "interactive_input_required",
    interactive: false,
  });
  assert.deepEqual(controller.guard({ kind: "unknown", state: "pending" }), {
    allowed: false,
    kind: "needs_input",
    exitCode: EXIT_CODES.policy_denied,
    reason: "unknown_interactive_state",
    interactive: false,
  });
});

test("guard helper has the same fail-closed behavior and never waits for stdin", () => {
  const guard = createNonInteractiveGuard();
  const approval = guard({ kind: "approval" });
  const input = guard({ kind: "input" });
  assert.equal(approval.allowed, false);
  assert.equal(input.allowed, false);
  if (!approval.allowed && !input.allowed) {
    assert.equal(approval.kind, "policy_denied");
    assert.equal(input.kind, "needs_input");
  }
});

test("budget tracker allows exact boundaries and stops before the next call", () => {
  let now = 10_000;
  const tracker = new BudgetTracker(
    { maxTurns: 1, maxTokens: 5, maxDurationMs: 100, maxOutputChars: 10 },
    { clock: () => now },
  );

  assert.equal(tracker.beginCall("model", { tokens: 3, outputChars: 6 }).allowed, true);
  assert.equal(tracker.snapshot().turns, 1);
  assert.equal(tracker.snapshot().tokens, 3);
  assert.equal(tracker.snapshot().outputChars, 6);

  assert.equal(tracker.beginCall("tool", { tokens: 2, outputChars: 4 }).allowed, true);
  assert.equal(tracker.snapshot().turns, 1);
  assert.equal(tracker.snapshot().tokens, 5);
  assert.equal(tracker.snapshot().outputChars, 10);

  const next = tracker.checkBeforeCall("model");
  assert.equal(next.allowed, false);
  if (!next.allowed) {
    assert.equal(next.kind, "budget_exceeded");
    assert.equal(next.exitCode, EXIT_CODES.execution_error);
    assert.equal(next.dimension, "maxTurns");
  }
});

test("budget tracker rejects requests that would cross token and output boundaries without mutating state", () => {
  const tracker = createBudgetTrackerForTest({ maxTurns: 10, maxTokens: 4, maxOutputChars: 5 });

  assert.equal(tracker.beginCall("model", { tokens: 5 }).allowed, false);
  assert.deepEqual(tracker.snapshot(), {
    turns: 0,
    tokens: 0,
    outputChars: 0,
    durationMs: 0,
    limits: { maxTurns: 10, maxTokens: 4, maxOutputChars: 5 },
  });

  assert.equal(tracker.beginCall("tool", { outputChars: 6 }).allowed, false);
  assert.equal(tracker.snapshot().outputChars, 0);
});

test("budget tracker stops at exact token and output limits before another call", () => {
  const tokens = new BudgetTracker({ maxTokens: 2 }, { clock: () => 1_000 });
  tokens.recordTokens(2);
  const tokenResult = tokens.checkBeforeCall("tool");
  assert.equal(tokenResult.allowed, false);
  if (!tokenResult.allowed) assert.equal(tokenResult.dimension, "maxTokens");

  const output = new BudgetTracker({ maxOutputChars: 3 }, { clock: () => 1_000 });
  output.recordOutputChars(3);
  const outputResult = output.checkBeforeCall("tool");
  assert.equal(outputResult.allowed, false);
  if (!outputResult.allowed) assert.equal(outputResult.dimension, "maxOutputChars");
});

test("budget tracker uses injected clock and reports duration boundary", () => {
  let now = 1_000;
  const tracker = new BudgetTracker({ maxDurationMs: 50 }, { clock: () => now });

  assert.equal(tracker.checkBeforeCall("model").allowed, true);
  now = 1_050;
  const result = tracker.checkBeforeCall("model");
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.kind, "budget_exceeded");
    assert.equal(result.dimension, "maxDurationMs");
    assert.equal(result.observed, 50);
  }
});

function createBudgetTrackerForTest(limits: ConstructorParameters<typeof BudgetTracker>[0]): BudgetTracker {
  return new BudgetTracker(limits, { clock: () => 1_000 });
}
