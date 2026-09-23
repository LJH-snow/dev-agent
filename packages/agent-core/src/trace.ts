import type { ChatUsage, ProviderTiming } from "@dev-agent/model";

import {
  AgentHookRegistry,
  type AgentHookContext,
  type RemoveAgentHook,
} from "./hooks.js";
import type { RuntimeEvent } from "@dev-agent/runtime-events";
import { addUsage } from "./usage.js";

export const AGENT_TRACE_SCHEMA_VERSION = 1 as const;

export type AgentTraceSpanKind = "model" | "tool";
export type AgentTraceSpeedMode = "fast" | "balanced" | "deep";
export type AgentTraceSpanStatus = "running" | "completed" | "failed";
export type AgentTraceRunStatus = "running" | "completed" | "failed" | "interrupted";

export interface AgentTraceSpan {
  readonly id: string;
  readonly kind: AgentTraceSpanKind;
  readonly name?: string;
  readonly status: AgentTraceSpanStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly turn?: number;
  readonly providerTiming?: ProviderTiming;
}

export interface AgentTraceRun {
  readonly runId: string;
  readonly status: AgentTraceRunStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  /** End-to-end elapsed time measured from CLI submission through completion. */
  readonly totalMs?: number;
  /** End-to-end time from CLI submission to the first answer-channel delta. */
  readonly firstTokenMs?: number;
  readonly queueMs?: number;
  readonly speedMode?: AgentTraceSpeedMode;
  readonly turns?: number;
  readonly usage?: ChatUsage;
  readonly spans: readonly AgentTraceSpan[];
  readonly droppedSpans?: number;
}

export interface AgentTraceSnapshot {
  readonly schemaVersion: typeof AGENT_TRACE_SCHEMA_VERSION;
  readonly metadataOnly: true;
  readonly runs: readonly AgentTraceRun[];
  readonly activeRunId?: string;
  readonly droppedRuns: number;
}

export interface AgentRunTraceOptions {
  readonly maxRuns?: number;
  readonly maxSpansPerRun?: number;
  readonly now?: () => Date;
  readonly nowMs?: () => number;
}

interface MutableTraceSpan {
  readonly id: string;
  readonly kind: AgentTraceSpanKind;
  readonly name?: string;
  readonly startedAt: string;
  readonly turn?: number;
  status: AgentTraceSpanStatus;
  completedAt?: string;
  durationMs?: number;
  providerTiming?: ProviderTiming;
}

interface MutableTraceRun {
  readonly runId: string;
  readonly startedAt: string;
  readonly spans: MutableTraceSpan[];
  readonly pendingSpans: Map<string, MutableTraceSpan>;
  status: AgentTraceRunStatus;
  completedAt?: string;
  durationMs?: number;
  totalMs?: number;
  firstTokenMs?: number;
  queueMs?: number;
  speedMode?: AgentTraceSpeedMode;
  submittedAtMs?: number;
  runtimeStartedAtMs?: number;
  turns?: number;
  usage?: ChatUsage;
  droppedSpans: number;
}

const DEFAULT_MAX_RUNS = 20;
const DEFAULT_MAX_SPANS_PER_RUN = 100;

/**
 * Collects bounded, metadata-only timings from Agent lifecycle Hooks.
 *
 * It is intentionally local and transport-agnostic. Callers can expose the
 * cloned snapshot in a CLI command or an HTTP endpoint without coupling the
 * runtime to a UI or telemetry vendor.
 */
export class AgentRunTrace {
  private readonly runs: MutableTraceRun[] = [];
  private readonly removeHooks: RemoveAgentHook[];
  private readonly maxRuns: number;
  private readonly maxSpansPerRun: number;
  private readonly now: () => Date;
  private readonly nowMs: () => number;
  private pendingRunContext:
    | { readonly submittedAtMs: number; readonly queueMs: number; readonly speedMode?: AgentTraceSpeedMode }
    | undefined;
  private activeRunId: string | undefined;
  private droppedRuns = 0;

  constructor(hooks: AgentHookRegistry, options: AgentRunTraceOptions = {}) {
    this.maxRuns = positiveLimit(options.maxRuns, DEFAULT_MAX_RUNS, "maxRuns");
    this.maxSpansPerRun = positiveLimit(
      options.maxSpansPerRun,
      DEFAULT_MAX_SPANS_PER_RUN,
      "maxSpansPerRun",
    );
    this.now = options.now ?? (() => new Date());
    this.nowMs = options.nowMs ?? (() => performance.now());
    this.removeHooks = [
      hooks.register("session.start", (context) => {
        this.startRun(context);
      }),
      hooks.register("before.model", (context) => {
        this.startSpan(context, "model");
      }),
      hooks.register("after.model", (context) => {
        this.finishSpan(context, "completed");
        if (context.usage) {
          this.addUsage(context.usage, context.runId);
        }
      }),
      hooks.register("before.tool", (context) => {
        this.startSpan(context, "tool");
      }),
      hooks.register("after.tool", (context) => {
        this.finishSpan(context, context.status === "error" ? "failed" : "completed");
      }),
      hooks.register("session.end", (context) => {
        this.finishRun(context);
      }),
    ];
  }

  snapshot(): AgentTraceSnapshot {
    return {
      schemaVersion: AGENT_TRACE_SCHEMA_VERSION,
      metadataOnly: true,
      runs: this.runs.map((run) => cloneRun(run)),
      ...(this.activeRunId === undefined ? {} : { activeRunId: this.activeRunId }),
      droppedRuns: this.droppedRuns,
    };
  }

  latest(): AgentTraceRun | undefined {
    const latest = this.runs.at(-1);
    return latest === undefined ? undefined : cloneRun(latest);
  }

  /** Supplies metadata for the next run without retaining its prompt text. */
  prepareNextRun(context: {
    readonly submittedAtMs: number;
    readonly queueMs: number;
    readonly speedMode?: AgentTraceSpeedMode;
  }): void {
    this.pendingRunContext = {
      submittedAtMs: finiteNonNegative(context.submittedAtMs, this.nowMs()),
      queueMs: finiteNonNegative(context.queueMs, 0),
      ...(context.speedMode === undefined ? {} : { speedMode: context.speedMode }),
    };
  }

  /**
   * Observes only event type, run id, timestamp, and answer/reasoning channel.
   * Prompt, answer, tool input, and output payloads are intentionally ignored.
   */
  recordRuntimeEvent(event: RuntimeEvent): void {
    const runId = event.runId;
    if (!runId) return;

    if (event.type === "run.started") {
      let run = this.runs.find((candidate) => candidate.runId === runId);
      if (!run) {
        run = {
          runId,
          startedAt: event.emittedAt,
          status: "running",
          spans: [],
          pendingSpans: new Map(),
          droppedSpans: 0,
        };
        this.runs.push(run);
        while (this.runs.length > this.maxRuns) {
          this.runs.shift();
          this.droppedRuns += 1;
        }
      }
      const pending = this.pendingRunContext;
      const current = this.nowMs();
      run.submittedAtMs = pending?.submittedAtMs ?? current;
      run.runtimeStartedAtMs = current;
      run.queueMs = pending?.queueMs ?? 0;
      run.speedMode = pending?.speedMode;
      this.pendingRunContext = undefined;
      this.activeRunId = runId;
      return;
    }

    const run = this.runs.find((candidate) => candidate.runId === runId);
    if (!run) return;
    if (event.type === "assistant.delta") {
      if (event.data.channel === "answer" && run.firstTokenMs === undefined) {
        run.firstTokenMs = elapsedSince(run.submittedAtMs, this.nowMs());
      }
      return;
    }

    if (
      event.type === "run.completed" ||
      event.type === "run.failed" ||
      event.type === "run.interrupted"
    ) {
      const finishedAt = this.nowMs();
      run.totalMs = elapsedSince(run.submittedAtMs, finishedAt);
      run.status = event.type === "run.completed"
        ? "completed"
        : event.type === "run.interrupted"
          ? "interrupted"
          : "failed";
      run.completedAt = event.emittedAt;
      if (event.type === "run.completed") {
        run.turns = event.data.turns;
      }
      if (this.activeRunId === runId) this.activeRunId = undefined;
    }
  }

  /**
   * Adds usage from an external adapter that does not attach it to
   * `after.model`. AgentLoop already attaches provider usage to that Hook, so
   * application adapters normally do not need to call this method.
   */
  recordUsage(usage: ChatUsage, runId = this.activeRunId): void {
    this.addUsage(usage, runId);
  }

  /** Detaches lifecycle observers while retaining the in-memory snapshot. */
  dispose(): void {
    for (const remove of this.removeHooks.splice(0)) {
      remove();
    }
  }

  private startRun(context: AgentHookContext): void {
    const runId = context.runId;
    if (!runId) {
      return;
    }
    const existing = this.runs.find((run) => run.runId === runId);
    if (existing) {
      this.activeRunId = runId;
      return;
    }
    const run: MutableTraceRun = {
      runId,
      startedAt: this.timestamp(context),
      status: "running",
      spans: [],
      pendingSpans: new Map(),
      droppedSpans: 0,
    };
    this.runs.push(run);
    while (this.runs.length > this.maxRuns) {
      this.runs.shift();
      this.droppedRuns += 1;
    }
    this.activeRunId = runId;
  }

  private startSpan(context: AgentHookContext, kind: AgentTraceSpanKind): void {
    const run = this.runFor(context);
    if (!run) {
      return;
    }
    const id = context.operationId ?? `${run.runId}:${kind}:${run.spans.length + 1}`;
    if (run.pendingSpans.has(id)) {
      return;
    }
    if (run.spans.length >= this.maxSpansPerRun) {
      run.droppedSpans += 1;
      return;
    }
    const span: MutableTraceSpan = {
      id: safeOperationId(id),
      kind,
      ...(kind === "tool" && context.toolName === undefined
        ? {}
        : kind === "tool"
          ? { name: safeToolName(context.toolName) }
          : {}),
      status: "running",
      startedAt: this.timestamp(context),
      ...(context.turn === undefined ? {} : { turn: context.turn }),
    };
    run.spans.push(span);
    run.pendingSpans.set(id, span);
    if (context.turn !== undefined) {
      run.turns = Math.max(run.turns ?? 0, context.turn);
    }
  }

  private finishSpan(
    context: AgentHookContext,
    status: AgentTraceSpanStatus,
  ): void {
    const run = this.runFor(context);
    if (!run) {
      return;
    }
    const id = context.operationId;
    if (!id) {
      return;
    }
    const span = run.pendingSpans.get(id);
    if (!span) {
      return;
    }
    const completedAt = this.timestamp(context);
    span.status = status;
    span.completedAt = completedAt;
    span.durationMs = elapsedMs(span.startedAt, completedAt);
    if (span.kind === "model" && context.providerTiming !== undefined) {
      span.providerTiming = sanitizeProviderTiming(context.providerTiming);
    }
    run.pendingSpans.delete(id);
  }

  private finishRun(context: AgentHookContext): void {
    const run = this.runFor(context);
    if (!run) {
      return;
    }
    const completedAt = this.timestamp(context);
    run.status = context.status === "interrupted"
      ? "interrupted"
      : context.status === "error"
        ? "failed"
        : "completed";
    run.completedAt = completedAt;
    run.durationMs = elapsedMs(run.startedAt, completedAt);
    run.totalMs ??= run.durationMs;
    if (context.turn !== undefined) {
      run.turns = Math.max(run.turns ?? 0, context.turn);
    }
    for (const span of run.pendingSpans.values()) {
      span.status = "failed";
      span.completedAt = completedAt;
      span.durationMs = elapsedMs(span.startedAt, completedAt);
    }
    run.pendingSpans.clear();
    if (this.activeRunId === run.runId) {
      this.activeRunId = undefined;
    }
  }

  private addUsage(usage: ChatUsage, runId: string | undefined): void {
    const run = runId === undefined
      ? this.runs.at(-1)
      : this.runs.find((candidate) => candidate.runId === runId);
    if (!run) {
      return;
    }
    run.usage = addUsage(run.usage, usage);
  }

  private runFor(context: AgentHookContext): MutableTraceRun | undefined {
    if (context.runId === undefined) {
      return undefined;
    }
    return this.runs.find((run) => run.runId === context.runId);
  }

  private timestamp(context: AgentHookContext): string {
    return context.occurredAt ?? this.now().toISOString();
  }
}

function cloneRun(run: MutableTraceRun): AgentTraceRun {
  return {
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    ...(run.durationMs === undefined ? {} : { durationMs: run.durationMs }),
    ...(run.totalMs === undefined ? {} : { totalMs: run.totalMs }),
    ...(run.firstTokenMs === undefined ? {} : { firstTokenMs: run.firstTokenMs }),
    ...(run.queueMs === undefined ? {} : { queueMs: run.queueMs }),
    ...(run.speedMode === undefined ? {} : { speedMode: run.speedMode }),
    ...(run.turns === undefined ? {} : { turns: run.turns }),
    ...(run.usage === undefined ? {} : { usage: { ...run.usage } }),
    spans: run.spans.map((span) => ({
      id: span.id,
      kind: span.kind,
      ...(span.name === undefined ? {} : { name: span.name }),
      status: span.status,
      startedAt: span.startedAt,
      ...(span.completedAt === undefined ? {} : { completedAt: span.completedAt }),
      ...(span.durationMs === undefined ? {} : { durationMs: span.durationMs }),
      ...(span.turn === undefined ? {} : { turn: span.turn }),
      ...(span.providerTiming === undefined
        ? {}
        : { providerTiming: { ...span.providerTiming } }),
    })),
    ...(run.droppedSpans === 0 ? {} : { droppedSpans: run.droppedSpans }),
  };
}

function sanitizeProviderTiming(timing: ProviderTiming): ProviderTiming {
  const sanitize = (value: number | undefined): number | undefined =>
    value === undefined || !Number.isFinite(value) || value < 0
      ? undefined
      : Math.min(86_400_000, value);
  const loadMs = sanitize(timing.loadMs);
  const promptEvalMs = sanitize(timing.promptEvalMs);
  const generationMs = sanitize(timing.generationMs);
  const serverTotalMs = sanitize(timing.serverTotalMs);
  return {
    ...(loadMs === undefined ? {} : { loadMs }),
    ...(promptEvalMs === undefined ? {} : { promptEvalMs }),
    ...(generationMs === undefined ? {} : { generationMs }),
    ...(serverTotalMs === undefined ? {} : { serverTotalMs }),
  };
}

function elapsedMs(startedAt: string, completedAt: string): number | undefined {
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) {
    return undefined;
  }
  return Math.max(0, completed - started);
}

function elapsedSince(startedAt: number | undefined, completedAt: number): number | undefined {
  if (startedAt === undefined || !Number.isFinite(startedAt) || !Number.isFinite(completedAt)) {
    return undefined;
  }
  return Math.max(0, completedAt - startedAt);
}

function finiteNonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function safeOperationId(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._:-]/g, "_");
  return normalized.slice(0, 96) || "operation";
}

function safeToolName(value: string | undefined): string {
  if (!value) {
    return "tool";
  }
  const normalized = value.trim().replace(/[^a-zA-Z0-9._:-]/g, "_");
  return normalized.slice(0, 64) || "tool";
}
