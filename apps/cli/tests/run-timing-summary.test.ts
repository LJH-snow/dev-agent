import assert from "node:assert/strict";
import test from "node:test";

import { diagnoseSlowStage, formatSlowStageDiagnosis, summarizeRunTimings } from "../dist/run-timing-summary.js";
import type { AgentTraceRun } from "@dev-agent/agent-core";

const run: AgentTraceRun = {
  runId: "run-test",
  status: "completed",
  startedAt: "2026-09-23T00:00:00.000Z",
  durationMs: 270,
  totalMs: 300,
  firstTokenMs: 180,
  queueMs: 30,
  speedMode: "fast",
  turns: 1,
  spans: [
    {
      id: "model-1",
      kind: "model",
      status: "completed",
      startedAt: "2026-09-23T00:00:00.030Z",
      durationMs: 120,
      turn: 1,
      providerTiming: {
        loadMs: 5,
        promptEvalMs: 70,
        generationMs: 30,
        serverTotalMs: 110,
      },
    },
    {
      id: "tool-1",
      kind: "tool",
      name: "filesystem",
      status: "completed",
      startedAt: "2026-09-23T00:00:00.150Z",
      durationMs: 60,
      turn: 1,
    },
  ],
};

test("summarizes end-to-end, queue, model, and tool durations", () => {
  assert.deepEqual(summarizeRunTimings(run), {
    firstTokenMs: 180,
    totalMs: 300,
    queueMs: 30,
    modelMs: 120,
    toolMs: 60,
    providerLoadMs: 5,
    providerPromptEvalMs: 70,
    providerGenerationMs: 30,
    providerServerMs: 110,
    providerOverheadMs: 10,
    unaccountedMs: 90,
  });
});

test("diagnoses the largest stage using timing metadata only", () => {
  assert.deepEqual(diagnoseSlowStage(run), {
    stage: "model",
    modelSubstage: "prompt-eval",
    modelSubstageMs: 70,
    modelSubstageSharePercent: 23,
    durationMs: 120,
    totalMs: 300,
    sharePercent: 40,
    longestSpan: { kind: "model", turn: 1, durationMs: 120 },
  });
});

test("reports queueing as the bottleneck when dispatch wait dominates", () => {
  const queuedRun: AgentTraceRun = {
    ...run,
    totalMs: 500,
    queueMs: 350,
    spans: [],
  };
  assert.equal(diagnoseSlowStage(queuedRun)?.stage, "queue");
  assert.equal(summarizeRunTimings(queuedRun).unaccountedMs, 150);
});


test("labels aggregate model and provider substage shares separately", () => {
  const longPrefill: AgentTraceRun = {
    ...run,
    totalMs: 1_000,
    spans: [
      {
        id: "slow-model",
        kind: "model",
        status: "completed",
        startedAt: "2026-09-23T00:00:00.000Z",
        durationMs: 980,
        providerTiming: {
          loadMs: 10,
          promptEvalMs: 450,
          generationMs: 300,
          serverTotalMs: 760,
        },
      },
    ],
  };

  assert.deepEqual(diagnoseSlowStage(longPrefill), {
    stage: "model",
    modelSubstage: "prompt-eval",
    modelSubstageMs: 450,
    modelSubstageSharePercent: 45,
    durationMs: 980,
    totalMs: 1_000,
    sharePercent: 98,
    longestSpan: { kind: "model", durationMs: 980 },
  });
});

test("selects the largest aggregate provider phase across model calls", () => {
  const multiCallRun: AgentTraceRun = {
    ...run,
    totalMs: 1_500,
    spans: [
      {
        id: "model-first",
        kind: "model",
        status: "completed",
        startedAt: "2026-09-23T00:00:00.000Z",
        durationMs: 500,
        providerTiming: { promptEvalMs: 300, generationMs: 250, serverTotalMs: 480 },
      },
      {
        id: "model-second",
        kind: "model",
        status: "completed",
        startedAt: "2026-09-23T00:00:01.000Z",
        durationMs: 500,
        providerTiming: { promptEvalMs: 300, generationMs: 250, serverTotalMs: 480 },
      },
    ],
  };

  const diagnosis = diagnoseSlowStage(multiCallRun);
  assert.equal(diagnosis?.modelSubstage, "prompt-eval");
  assert.equal(diagnosis?.modelSubstageMs, 600);
  assert.equal(diagnosis?.modelSubstageSharePercent, 40);
});


test("formats parent and provider-substage shares with explicit denominators", () => {
  const diagnosis = diagnoseSlowStage({
    ...run,
    totalMs: 1_000,
    spans: [{
      id: "slow-model",
      kind: "model",
      status: "completed",
      startedAt: "2026-09-23T00:00:00.000Z",
      durationMs: 980,
      providerTiming: { promptEvalMs: 450, generationMs: 300, serverTotalMs: 760 },
    }],
  });
  assert.ok(diagnosis);
  assert.equal(
    formatSlowStageDiagnosis(diagnosis),
    "slow-stage=model (98% of total); provider-substage=prompt-eval 450ms (45% of total)",
  );
});
