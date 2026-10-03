import type { AgentTraceRun } from "@dev-agent/agent-core";

export interface RunTimingSummary {
  readonly firstTokenMs?: number;
  readonly totalMs?: number;
  readonly queueMs?: number;
  readonly modelMs?: number;
  readonly toolMs?: number;
  readonly providerLoadMs?: number;
  readonly providerPromptEvalMs?: number;
  readonly providerGenerationMs?: number;
  readonly providerServerMs?: number;
  readonly providerOverheadMs?: number;
  readonly unaccountedMs?: number;
}

export interface SlowStageDiagnosis {
  readonly stage: "queue" | "model" | "tools" | "other";
  readonly modelSubstage?: "load" | "prompt-eval" | "generation" | "app-overhead";
  readonly modelSubstageMs?: number;
  readonly modelSubstageSharePercent?: number;
  readonly durationMs: number;
  readonly totalMs?: number;
  readonly sharePercent?: number;
  readonly longestSpan?: {
    readonly kind: "model" | "tool";
    readonly name?: string;
    readonly turn?: number;
    readonly durationMs: number;
  };
}

/** Reduces a metadata-only trace run to the timings shown by the CLI. */
export function summarizeRunTimings(run: AgentTraceRun | undefined): RunTimingSummary {
  if (!run) return {};

  const modelSpans = run.spans.filter((span) => span.kind === "model");
  const toolSpans = run.spans.filter((span) => span.kind === "tool");
  const modelMs = sumSpanDurations(modelSpans);
  const toolMs = sumSpanDurations(toolSpans);
  const providerSpans = modelSpans.filter((span) => span.providerTiming !== undefined);
  const providerLoadMs = sumProviderTiming(providerSpans, "loadMs");
  const providerPromptEvalMs = sumProviderTiming(providerSpans, "promptEvalMs");
  const providerGenerationMs = sumProviderTiming(providerSpans, "generationMs");
  const providerServerMs = sumProviderTiming(providerSpans, "serverTotalMs");
  const providerOverheadMs = providerSpans.reduce((total, span) => {
    const serverMs = span.providerTiming?.serverTotalMs;
    return total + (serverMs === undefined || span.durationMs === undefined
      ? 0
      : Math.max(0, span.durationMs - serverMs));
  }, 0);
  const totalMs = run.totalMs ?? run.durationMs;
  const accountedMs = (run.queueMs ?? 0) + modelMs + toolMs;

  return {
    ...(run.firstTokenMs === undefined ? {} : { firstTokenMs: run.firstTokenMs }),
    ...(totalMs === undefined ? {} : { totalMs }),
    ...(run.queueMs === undefined ? {} : { queueMs: run.queueMs }),
    ...(modelSpans.length === 0 ? {} : { modelMs }),
    ...(toolSpans.length === 0 ? {} : { toolMs }),
    ...(providerSpans.length === 0 ? {} : {
      ...(providerLoadMs === undefined ? {} : { providerLoadMs }),
      ...(providerPromptEvalMs === undefined ? {} : { providerPromptEvalMs }),
      ...(providerGenerationMs === undefined ? {} : { providerGenerationMs }),
      ...(providerServerMs === undefined ? {} : { providerServerMs }),
      ...(providerOverheadMs > 0 ? { providerOverheadMs } : {}),
    }),
    ...(totalMs === undefined ? {} : { unaccountedMs: Math.max(0, totalMs - accountedMs) }),
  };
}

/** Identifies the largest measured contributor without retaining user content. */
export function diagnoseSlowStage(run: AgentTraceRun | undefined): SlowStageDiagnosis | undefined {
  if (!run) return undefined;
  const timings = summarizeRunTimings(run);
  const candidates: { readonly stage: SlowStageDiagnosis["stage"]; readonly durationMs: number }[] = [];
  if (timings.queueMs !== undefined) candidates.push({ stage: "queue", durationMs: timings.queueMs });
  if (timings.modelMs !== undefined) candidates.push({ stage: "model", durationMs: timings.modelMs });
  if (timings.toolMs !== undefined) candidates.push({ stage: "tools", durationMs: timings.toolMs });
  if (timings.unaccountedMs !== undefined) candidates.push({ stage: "other", durationMs: timings.unaccountedMs });
  candidates.sort((left, right) => right.durationMs - left.durationMs);
  const slowest = candidates[0];
  if (!slowest || slowest.durationMs <= 0) return undefined;

  const longestSpan = [...run.spans]
    .filter((span) => span.durationMs !== undefined)
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))[0];
  const modelSubstage = slowest.stage === "model"
    ? diagnoseProviderSubstage(run.spans)
    : undefined;
  const modelSubstageMs = modelSubstage === undefined
    ? undefined
    : providerSubstageDuration(timings, modelSubstage);
  return {
    ...slowest,
    ...(modelSubstage === undefined ? {} : { modelSubstage }),
    ...(modelSubstageMs === undefined ? {} : { modelSubstageMs }),
    ...(modelSubstageMs === undefined || timings.totalMs === undefined || timings.totalMs <= 0
      ? {}
      : { modelSubstageSharePercent: Math.min(100, Math.round((modelSubstageMs / timings.totalMs) * 100)) }),
    ...(timings.totalMs === undefined ? {} : { totalMs: timings.totalMs }),
    ...(timings.totalMs === undefined || timings.totalMs <= 0
      ? {}
      : { sharePercent: Math.min(100, Math.round((slowest.durationMs / timings.totalMs) * 100)) }),
    ...(longestSpan?.durationMs === undefined
      ? {}
      : {
          longestSpan: {
            kind: longestSpan.kind,
            ...(longestSpan.name === undefined ? {} : { name: longestSpan.name }),
            ...(longestSpan.turn === undefined ? {} : { turn: longestSpan.turn }),
            durationMs: longestSpan.durationMs,
          },
        }),
  };
}


/** Renders the parent run share and provider substage share with unambiguous labels. */
export function formatSlowStageDiagnosis(diagnosis: SlowStageDiagnosis): string {
  const share = diagnosis.sharePercent === undefined
    ? ""
    : ` (${diagnosis.sharePercent}% of total)`;
  const substage = diagnosis.modelSubstage === undefined
    ? ""
    : `; provider-substage=${diagnosis.modelSubstage}${diagnosis.modelSubstageMs === undefined ? "" : ` ${Math.round(diagnosis.modelSubstageMs)}ms`}${diagnosis.modelSubstageSharePercent === undefined ? "" : ` (${diagnosis.modelSubstageSharePercent}% of total)`}`;
  return `slow-stage=${diagnosis.stage}${share}${substage}`;
}

function providerSubstageDuration(
  timings: RunTimingSummary,
  stage: NonNullable<SlowStageDiagnosis["modelSubstage"]>,
): number | undefined {
  switch (stage) {
    case "load": return timings.providerLoadMs;
    case "prompt-eval": return timings.providerPromptEvalMs;
    case "generation": return timings.providerGenerationMs;
    case "app-overhead": return timings.providerOverheadMs;
  }
}

function diagnoseProviderSubstage(
  spans: AgentTraceRun["spans"],
): SlowStageDiagnosis["modelSubstage"] {
  const totals = new Map<NonNullable<SlowStageDiagnosis["modelSubstage"]>, number>();
  const add = (name: NonNullable<SlowStageDiagnosis["modelSubstage"]>, ms: number) => {
    totals.set(name, (totals.get(name) ?? 0) + ms);
  };
  for (const span of spans) {
    if (span.kind !== "model" || span.providerTiming === undefined) continue;
    const timing = span.providerTiming;
    if (timing.loadMs !== undefined) add("load", timing.loadMs);
    if (timing.promptEvalMs !== undefined) add("prompt-eval", timing.promptEvalMs);
    if (timing.generationMs !== undefined) add("generation", timing.generationMs);
    if (timing.serverTotalMs !== undefined && span.durationMs !== undefined) {
      add("app-overhead", Math.max(0, span.durationMs - timing.serverTotalMs));
    }
  }
  const slowest = [...totals.entries()].sort((left, right) => right[1] - left[1])[0];
  return slowest !== undefined && slowest[1] > 0 ? slowest[0] : undefined;
}

function sumSpanDurations(spans: AgentTraceRun["spans"]): number {
  return spans.reduce((total, span) => total + (span.durationMs ?? 0), 0);
}

function sumProviderTiming(
  spans: AgentTraceRun["spans"],
  key: "loadMs" | "promptEvalMs" | "generationMs" | "serverTotalMs",
): number | undefined {
  const values = spans
    .map((span) => span.providerTiming?.[key])
    .filter((value): value is number => value !== undefined);
  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0);
}
