import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentHookRegistry,
  AgentRunTrace,
} from "../dist/index.js";

test("records one run with model and tool spans from lifecycle hooks", async () => {
  const hooks = new AgentHookRegistry();
  const trace = new AgentRunTrace(hooks);

  await hooks.run("session.start", {
    sessionId: "session-1",
    runId: "run-1",
    occurredAt: "2026-09-20T10:00:00.000Z",
  });
  await hooks.run("before.model", {
    sessionId: "session-1",
    runId: "run-1",
    operationId: "model-1",
    turn: 1,
    occurredAt: "2026-09-20T10:00:00.010Z",
  });
  await hooks.run("after.model", {
    sessionId: "session-1",
    runId: "run-1",
    operationId: "model-1",
    turn: 1,
    status: "streaming",
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    providerTiming: {
      loadMs: 1,
      promptEvalMs: 2,
      generationMs: 3,
      serverTotalMs: 7,
    },
    occurredAt: "2026-09-20T10:00:00.030Z",
  });
  await hooks.run("before.tool", {
    sessionId: "session-1",
    runId: "run-1",
    operationId: "tool-1",
    turn: 1,
    toolName: "filesystem",
    occurredAt: "2026-09-20T10:00:00.040Z",
  });
  await hooks.run("after.tool", {
    sessionId: "session-1",
    runId: "run-1",
    operationId: "tool-1",
    turn: 1,
    toolName: "filesystem",
    status: "done",
    occurredAt: "2026-09-20T10:00:00.090Z",
  });
  await hooks.run("session.end", {
    sessionId: "session-1",
    runId: "run-1",
    status: "done",
    occurredAt: "2026-09-20T10:00:00.100Z",
  });

  assert.deepEqual(trace.snapshot().runs[0], {
    runId: "run-1",
    status: "completed",
    startedAt: "2026-09-20T10:00:00.000Z",
    completedAt: "2026-09-20T10:00:00.100Z",
    durationMs: 100,
    totalMs: 100,
    turns: 1,
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    spans: [
      {
        id: "model-1",
        kind: "model",
        status: "completed",
        startedAt: "2026-09-20T10:00:00.010Z",
        completedAt: "2026-09-20T10:00:00.030Z",
        durationMs: 20,
        turn: 1,
        providerTiming: {
          loadMs: 1,
          promptEvalMs: 2,
          generationMs: 3,
          serverTotalMs: 7,
        },
      },
      {
        id: "tool-1",
        kind: "tool",
        name: "filesystem",
        status: "completed",
        startedAt: "2026-09-20T10:00:00.040Z",
        completedAt: "2026-09-20T10:00:00.090Z",
        durationMs: 50,
        turn: 1,
      },
    ],
  });

  const serialized = JSON.stringify(trace.snapshot());
  assert.doesNotMatch(serialized, /session-1|prompt text|tool output|secret/i);
});

test("bounds completed runs and reports evicted metadata", async () => {
  const hooks = new AgentHookRegistry();
  const trace = new AgentRunTrace(hooks, { maxRuns: 20 });

  for (let index = 0; index < 21; index += 1) {
    const runId = `run-${index}`;
    await hooks.run("session.start", {
      sessionId: "session-1",
      runId,
      occurredAt: `2026-09-20T10:00:${String(index).padStart(2, "0")}.000Z`,
    });
    await hooks.run("session.end", {
      sessionId: "session-1",
      runId,
      status: "done",
      occurredAt: `2026-09-20T10:00:${String(index).padStart(2, "0")}.010Z`,
    });
  }

  const snapshot = trace.snapshot();
  assert.equal(snapshot.runs.length, 20);
  assert.equal(snapshot.runs[0]?.runId, "run-1");
  assert.equal(snapshot.runs.at(-1)?.runId, "run-20");
  assert.equal(snapshot.droppedRuns, 1);
});

test("closes unfinished spans when a run ends with an error", async () => {
  const hooks = new AgentHookRegistry();
  const trace = new AgentRunTrace(hooks);

  await hooks.run("session.start", {
    sessionId: "session-1",
    runId: "run-error",
    occurredAt: "2026-09-20T10:00:00.000Z",
  });
  await hooks.run("before.model", {
    sessionId: "session-1",
    runId: "run-error",
    operationId: "model-error",
    occurredAt: "2026-09-20T10:00:00.010Z",
  });
  await hooks.run("session.end", {
    sessionId: "session-1",
    runId: "run-error",
    status: "error",
    occurredAt: "2026-09-20T10:00:00.040Z",
  });

  const span = trace.latest()?.spans[0];
  assert.equal(trace.latest()?.status, "failed");
  assert.equal(span?.status, "failed");
  assert.equal(span?.completedAt, "2026-09-20T10:00:00.040Z");
  assert.equal(span?.durationMs, 30);
});
