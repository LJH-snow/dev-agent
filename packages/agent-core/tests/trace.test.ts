import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeEventSequence } from "@dev-agent/runtime-events";

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

test("records authorization class and bounded terminal/preview lifecycle metadata", async () => {
  const hooks = new AgentHookRegistry();
  const trace = new AgentRunTrace(hooks, { maxLifecycleEvents: 3 });
  await hooks.run("session.start", {
    sessionId: "session-auth",
    runId: "run-auth",
    occurredAt: "2026-09-24T10:00:00.000Z",
  });
  await hooks.run("before.tool", {
    sessionId: "session-auth",
    runId: "run-auth",
    operationId: "tool-auth",
    toolName: "filesystem",
    occurredAt: "2026-09-24T10:00:00.010Z",
  });

  const events = new RuntimeEventSequence("session-auth", () => "2026-09-24T10:00:00.020Z");
  trace.recordRuntimeEvent(events.create("tool.started", {
    tool: "filesystem",
    metadata: {
      risk: "dangerous",
      confirmation: "always",
      resultFormat: "text",
      supportsProgress: false,
    },
  }, { runId: "run-auth", emittedAt: "2026-09-24T10:00:00.020Z" }));
  trace.recordRuntimeEvent(events.create("tool.approval-requested", {
    tool: "filesystem",
    metadata: {
      risk: "dangerous",
      confirmation: "always",
      resultFormat: "text",
      supportsProgress: false,
    },
  }, { runId: "run-auth", emittedAt: "2026-09-24T10:00:00.030Z" }));
  trace.recordRuntimeEvent(events.create("tool.approval-resolved", {
    tool: "filesystem",
    decision: "deny",
    reason: "secret path must not be exposed",
  }, { runId: "run-auth", emittedAt: "2026-09-24T10:00:00.040Z" }));
  trace.recordRuntimeEvent(events.create("tool.failed", {
    tool: "filesystem",
    error: "secret path /Users/private/project",
  }, { runId: "run-auth", emittedAt: "2026-09-24T10:00:00.050Z" }));
  await hooks.run("after.tool", {
    sessionId: "session-auth",
    runId: "run-auth",
    operationId: "tool-auth",
    toolName: "filesystem",
    status: "error",
    occurredAt: "2026-09-24T10:00:00.060Z",
  });

  trace.recordLifecycle("terminal", "started", "2026-09-24T10:00:00.070Z");
  trace.recordLifecycle("preview", "loaded", "2026-09-24T10:00:00.080Z");
  trace.recordLifecycle("preview", "cleared", "2026-09-24T10:00:00.090Z");
  trace.recordLifecycle("terminal", "completed", "2026-09-24T10:00:00.100Z");

  const snapshot = trace.snapshot();
  assert.deepEqual(snapshot.runs[0]?.spans[0], {
    id: "tool-auth",
    kind: "tool",
    name: "filesystem",
    status: "failed",
    startedAt: "2026-09-24T10:00:00.010Z",
    completedAt: "2026-09-24T10:00:00.060Z",
    durationMs: 50,
    capabilityClass: "dangerous",
    authorizationResult: "deny",
  });
  assert.deepEqual(snapshot.lifecycle, [
    { kind: "preview", status: "loaded", occurredAt: "2026-09-24T10:00:00.080Z" },
    { kind: "preview", status: "cleared", occurredAt: "2026-09-24T10:00:00.090Z" },
    { kind: "terminal", status: "completed", occurredAt: "2026-09-24T10:00:00.100Z" },
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret path|Users|private\/project/i);
});
