import assert from "node:assert/strict";
import test from "node:test";

import {
  RuntimeEventSequence,
  type RuntimeEvent,
  type RuntimeEventType,
} from "../dist/index.js";

test("creates versioned events with a monotonic session sequence", () => {
  const sequence = new RuntimeEventSequence("session-1", () => "2026-09-20T00:00:00.000Z");

  const first = sequence.create("run.started", {
    prompt: "hello",
    model: "test-model",
  });
  const second = sequence.create("run.status", {
    status: "thinking",
  }, { runId: "run-1" });

  assert.deepEqual(
    {
      version: first.version,
      sequence: first.sequence,
      emittedAt: first.emittedAt,
      sessionId: first.sessionId,
      type: first.type,
      data: first.data,
    },
    {
      version: 1,
      sequence: 1,
      emittedAt: "2026-09-20T00:00:00.000Z",
      sessionId: "session-1",
      type: "run.started",
      data: { prompt: "hello", model: "test-model" },
    },
  );
  assert.equal(second.sequence, 2);
  assert.equal(second.runId, "run-1");
});

test("keeps input queue, approval, interruption, and failure events distinct", () => {
  const sequence = new RuntimeEventSequence("session-1");
  const types: RuntimeEventType[] = [
    "input.queued",
    "tool.approval-requested",
    "run.interrupted",
    "run.failed",
  ];

  const events: RuntimeEvent[] = [
    sequence.create("input.queued", {
      input: "second prompt",
      position: 1,
      queueSize: 1,
    }),
    sequence.create("tool.approval-requested", {
      tool: "filesystem",
      reason: "write requires approval",
    }, { runId: "run-1" }),
    sequence.create("run.interrupted", {
      reason: "SIGINT",
    }, { runId: "run-1" }),
    sequence.create("run.failed", {
      error: "provider unavailable",
    }, { runId: "run-2" }),
  ];

  assert.deepEqual(events.map((event) => event.type), types);
  assert.equal(events[1]?.runId, "run-1");
  const interruption = events.find((event) => event.type === "run.interrupted");
  const failure = events.find((event) => event.type === "run.failed");
  assert.equal(interruption?.type, "run.interrupted");
  assert.equal(interruption?.data.reason, "SIGINT");
  assert.equal(failure?.type, "run.failed");
  assert.equal(failure?.data.error, "provider unavailable");
});

test("event payloads are copied at creation time", () => {
  const sequence = new RuntimeEventSequence("session-1");
  const payload = {
    input: "queued",
    position: 1,
    queueSize: 1,
  };

  const event = sequence.create("input.queued", payload);
  payload.input = "mutated";

  assert.equal(event.data.input, "queued");
});
