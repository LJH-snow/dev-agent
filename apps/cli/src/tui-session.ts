import type { RuntimeEvent } from "@dev-agent/agent-core";

export type TuiRunState =
  | "ready"
  | "thinking"
  | "streaming"
  | "tool-running"
  | "waiting-approval"
  | "validating"
  | "done"
  | "error"
  | "interrupted";

export type CardStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "approval"
  | "validation"
  | "passed"
  | "blocked";

export interface ToolCard {
  readonly id: string;
  readonly kind: "tool" | "approval" | "validation";
  readonly name: string;
  readonly status: CardStatus;
  readonly input?: string;
  readonly output?: string;
  readonly diff?: string;
  readonly detail?: string;
  readonly progress?: {
    readonly progress: number;
    readonly total?: number;
  };
  readonly startedAt: number;
  readonly finishedAt?: number;
}

export interface UsageSummary {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface TuiTranscriptEntry {
  readonly id: string;
  readonly role: "user" | "assistant" | "reasoning";
  readonly runId?: string;
  text: string;
}

export interface TuiStateSnapshot {
  readonly state: TuiRunState;
  readonly cards: readonly ToolCard[];
  readonly transcript: readonly TuiTranscriptEntry[];
  readonly queuedPrompts: readonly string[];
  readonly activeRunId?: string;
  readonly usage?: UsageSummary;
  readonly error?: string;
}

export type TuiSessionListener = (snapshot: TuiStateSnapshot) => void;

export type TuiSessionEvent =
  | { readonly type: "turn-start" }
  | { readonly type: "assistant-token"; readonly text: string }
  | { readonly type: "tool-start"; readonly name: string; readonly input?: string }
  | {
      readonly type: "tool-progress";
      readonly id: string;
      readonly detail?: string;
      readonly progress?: number;
      readonly total?: number;
    }
  | { readonly type: "tool-finish"; readonly id: string; readonly output?: string }
  | { readonly type: "tool-error"; readonly id: string; readonly error: string }
  | { readonly type: "tool-cancel"; readonly id: string; readonly reason?: string }
  | {
      readonly type: "approval-request";
      readonly tool: string;
      readonly detail?: string;
      readonly diff?: string;
      readonly id?: string;
    }
  | {
      readonly type: "approval-resolved";
      readonly decision: string;
      readonly id?: string;
    }
  | {
      readonly type: "validation-start";
      readonly detail?: string;
      readonly id?: string;
    }
  | {
      readonly type: "validation-result";
      readonly status: "passed" | "failed" | "blocked";
      readonly detail?: string;
      readonly id?: string;
    }
  | { readonly type: "turn-complete"; readonly usage?: UsageSummary }
  | { readonly type: "turn-done" }
  | { readonly type: "turn-error"; readonly message: string }
  | { readonly type: "turn-interrupted"; readonly reason?: string }
  | { readonly type: "ready" };

function now(): number {
  return Date.now();
}

function isTerminalState(state: TuiRunState): boolean {
  return state === "done" || state === "error" || state === "interrupted";
}

export class TuiSessionModel {
  private state: TuiRunState = "ready";
  private cards: ToolCard[] = [];
  private usage: UsageSummary | undefined;
  private error: string | undefined;
  private closed = false;
  private sequence = 0;
  private transcript: TuiTranscriptEntry[] = [];
  private queuedPrompts: string[] = [];
  private activeRunId: string | undefined;
  private readonly listeners = new Set<TuiSessionListener>();
  private readonly runtimeRuns = new Map<
    string,
    { readonly assistantId: string; readonly reasoningId?: string }
  >();
  private readonly runtimeToolIds = new Map<string, string[]>();
  private readonly runtimeApprovalIds = new Map<string, string>();
  private readonly runtimeSandboxExpansionIds = new Map<string, string>();
  private readonly runtimeValidationIds = new Map<string, string>();
  private readonly lastRuntimeSequenceBySession = new Map<string, number>();

  dispatch(
    event: Extract<
      TuiSessionEvent,
      { readonly type: "tool-start" | "approval-request" | "validation-start" }
    >
  ): string;
  dispatch(
    event: Exclude<
      TuiSessionEvent,
      { readonly type: "tool-start" | "approval-request" | "validation-start" }
    >
  ): void;
  dispatch(event: TuiSessionEvent): string | void {
    const result = this.dispatchInternal(event);
    this.notify();
    return result;
  }

  subscribe(listener: TuiSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private dispatchInternal(event: TuiSessionEvent): string | void {
    switch (event.type) {
      case "turn-start":
        this.state = "thinking";
        this.error = undefined;
        this.closed = false;
        return;
      case "assistant-token":
        if (this.closed || !event.text) return;
        this.state = "streaming";
        return;
      case "tool-start": {
        if (this.closed) return;
        const id = `tool-${++this.sequence}`;
        this.cards.push({
          id,
          kind: "tool",
          name: event.name,
          status: "running",
          ...(event.input === undefined ? {} : { input: event.input }),
          startedAt: now(),
        });
        this.state = "tool-running";
        return id;
      }
      case "tool-progress":
        if (this.closed) return;
        this.updateCard(event.id, (card) => ({
          ...card,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
          ...(event.progress === undefined
            ? {}
            : { progress: normalizeToolProgress(event.progress, event.total) }),
        }));
        return;
      case "tool-finish":
        if (this.closed) return;
        this.updateCard(event.id, (card) => ({
          ...card,
          status: "completed",
          ...(event.output === undefined ? {} : { output: event.output }),
          finishedAt: now(),
        }));
        this.state = "streaming";
        return;
      case "tool-error":
        if (this.closed) return;
        this.updateCard(event.id, (card) => ({
          ...card,
          status: "failed",
          detail: event.error,
          finishedAt: now(),
        }));
        this.state = "streaming";
        return;
      case "tool-cancel":
        if (this.closed) return;
        this.updateCard(event.id, (card) => ({
          ...card,
          status: "cancelled",
          ...(event.reason === undefined ? {} : { detail: event.reason }),
          finishedAt: now(),
        }));
        this.state = "interrupted";
        this.closed = true;
        return;
      case "approval-request": {
        if (this.closed) return;
        const id = event.id ?? `approval-${++this.sequence}`;
        this.cards.push({
          id,
          kind: "approval",
          name: event.tool,
          status: "approval",
          ...(event.detail === undefined ? {} : { detail: event.detail }),
          ...(event.diff === undefined ? {} : { diff: event.diff }),
          startedAt: now(),
        });
        this.state = "waiting-approval";
        return id;
      }
      case "approval-resolved": {
        if (this.closed) return;
        const card = event.id === undefined
          ? this.findLatestCard("approval")
          : this.cards.find((candidate) => candidate.id === event.id);
        if (card) {
          this.updateCard(card.id, (current) => ({
            ...current,
            status: event.decision.toLowerCase().startsWith("allow")
              ? "completed"
              : "failed",
            detail: event.decision,
            finishedAt: now(),
          }));
        }
        this.state = "thinking";
        return;
      }
      case "validation-start": {
        if (this.closed) return;
        const id = event.id ?? `validation-${++this.sequence}`;
        this.cards.push({
          id,
          kind: "validation",
          name: "validation",
          status: "validation",
          ...(event.detail === undefined ? {} : { detail: event.detail }),
          startedAt: now(),
        });
        this.state = "validating";
        return id;
      }
      case "validation-result": {
        if (this.closed) return;
        const card = event.id === undefined
          ? this.findLatestCard("validation")
          : this.cards.find((candidate) => candidate.id === event.id);
        if (card) {
          this.updateCard(card.id, (current) => ({
            ...current,
            status: event.status,
            ...(event.detail === undefined ? {} : { detail: event.detail }),
            finishedAt: now(),
          }));
        }
        this.state = "streaming";
        return;
      }
      case "turn-complete":
        if (this.closed) return;
        this.usage = event.usage;
        this.state = "ready";
        this.closed = true;
        return;
      case "turn-done":
        if (this.closed) return;
        this.state = "done";
        this.closed = true;
        return;
      case "turn-error":
        if (this.closed) return;
        this.state = "error";
        this.error = event.message;
        this.closed = true;
        return;
      case "turn-interrupted":
        if (this.closed) return;
        this.cards = this.cards.map((card) => (
          card.status === "running" || card.status === "approval" || card.status === "validation"
            ? { ...card, status: "cancelled", finishedAt: now() }
            : card
        ));
        this.state = "interrupted";
        // User cancellation is a terminal state, not a model failure. Keep
        // the reason in the event stream/notice layer without rendering it as
        // an error banner.
        this.error = undefined;
        this.closed = true;
        return;
      case "ready":
        this.state = "ready";
        this.error = undefined;
        this.closed = false;
        return;
    }
  }

  snapshot(): TuiStateSnapshot {
    return {
      state: this.state,
      cards: this.cards.map((card) => ({ ...card })),
      transcript: this.transcript.map((entry) => ({ ...entry })),
      queuedPrompts: [...this.queuedPrompts],
      ...(this.activeRunId === undefined ? {} : { activeRunId: this.activeRunId }),
      ...(this.usage === undefined ? {} : { usage: this.usage }),
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  reset(): void {
    this.state = "ready";
    this.cards = [];
    this.usage = undefined;
    this.error = undefined;
    this.closed = false;
    this.sequence = 0;
    this.transcript = [];
    this.queuedPrompts = [];
    this.activeRunId = undefined;
    this.runtimeRuns.clear();
    this.runtimeToolIds.clear();
    this.runtimeApprovalIds.clear();
    this.runtimeSandboxExpansionIds.clear();
    this.runtimeValidationIds.clear();
    this.lastRuntimeSequenceBySession.clear();
    this.notify();
  }

  /**
   * Projects the shared runtime stream into the CLI's renderer-neutral model.
   * The renderer-neutral model remains available to line-oriented fallbacks.
   */
  applyRuntimeEvent(event: RuntimeEvent): void {
    this.applyRuntimeEventInternal(event);
    this.notify();
  }

  private applyRuntimeEventInternal(event: RuntimeEvent): void {
    const lastSequence = this.lastRuntimeSequenceBySession.get(event.sessionId);
    if (lastSequence !== undefined && event.sequence <= lastSequence) {
      return;
    }
    this.lastRuntimeSequenceBySession.set(event.sessionId, event.sequence);

    switch (event.type) {
      case "session.started":
      case "input.submitted":
        return;
      case "input.queued": {
        const index = Math.max(0, Math.min(this.queuedPrompts.length, event.data.position - 1));
        this.queuedPrompts.splice(index, 0, event.data.input);
        return;
      }
      case "run.started": {
        const runId = event.runId ?? `runtime-run-${event.sequence}`;
        const assistantId = `assistant-${runId}`;
        this.activeRunId = runId;
        this.closed = false;
        this.error = undefined;
        this.state = "thinking";
        this.runtimeRuns.set(runId, { assistantId });
        this.transcript.push(
          { id: `prompt-${runId}`, role: "user", runId, text: event.data.prompt },
          { id: assistantId, role: "assistant", runId, text: "" },
        );
        return;
      }
      case "run.status":
        if (this.closed && event.data.status !== "ready") return;
        this.state = event.data.status;
        return;
      case "assistant.delta": {
        const run = this.runtimeRuns.get(event.runId ?? this.activeRunId ?? "");
        if (!run || !event.data.text) return;
        if (event.data.channel === "answer") {
          this.appendTranscript(run.assistantId, event.data.text);
          this.state = "streaming";
          return;
        }
        const reasoningId = run.reasoningId ?? `reasoning-${event.runId ?? this.activeRunId}`;
        if (!run.reasoningId) {
          this.runtimeRuns.set(event.runId ?? this.activeRunId ?? "", {
            ...run,
            reasoningId,
          });
          this.transcript.push({
            id: reasoningId,
            role: "reasoning",
            runId: event.runId ?? this.activeRunId,
            text: "",
          });
        }
        this.appendTranscript(reasoningId, event.data.text);
        return;
      }
      case "assistant.completed": {
        const run = this.runtimeRuns.get(event.runId ?? this.activeRunId ?? "");
        if (!run) return;
        this.replaceTranscript(run.assistantId, event.data.text);
        return;
      }
      case "usage.reported":
        this.usage = {
          promptTokens: event.data.promptTokens,
          completionTokens: event.data.completionTokens,
          totalTokens: event.data.totalTokens,
        };
        return;
      case "tool.started": {
        const id = this.dispatch({
          type: "tool-start",
          name: event.data.tool,
          ...(event.data.input === undefined
            ? {}
            : { input: previewRuntimeValue(event.data.input) }),
        });
        this.pushRuntimeToolId(event.runId, event.data.tool, id);
        return;
      }
      case "tool.progress": {
        const id = this.latestRuntimeToolId(event.runId, event.data.tool);
        if (id) {
          this.dispatch({
            type: "tool-progress",
            id,
            detail: event.data.detail ?? formatToolProgress(event.data.progress, event.data.total),
            progress: event.data.progress,
            ...(event.data.total === undefined ? {} : { total: event.data.total }),
          });
        }
        return;
      }
      case "tool.completed": {
        const id = this.takeRuntimeToolId(event.runId, event.data.tool);
        if (id) {
          this.dispatch({
            type: "tool-finish",
            id,
            ...(event.data.output === undefined ? {} : { output: event.data.output }),
          });
        }
        return;
      }
      case "tool.failed": {
        const id = this.takeRuntimeToolId(event.runId, event.data.tool);
        if (id) {
          this.dispatch({ type: "tool-error", id, error: event.data.error });
        }
        return;
      }
      case "tool.approval-requested": {
        const diff = formatRuntimeReviewDiff(event.data.review);
        const id = this.dispatch({
          type: "approval-request",
          tool: event.data.tool,
          detail: event.data.reason,
          ...(diff === undefined ? {} : { diff }),
        });
        this.runtimeApprovalIds.set(runtimeToolKey(event.runId, event.data.tool), id);
        return;
      }
      case "tool.approval-resolved": {
        const key = runtimeToolKey(event.runId, event.data.tool);
        this.dispatch({
          type: "approval-resolved",
          decision: event.data.decision,
          id: this.runtimeApprovalIds.get(key),
        });
        this.runtimeApprovalIds.delete(key);
        return;
      }
      case "tool.sandbox-expansion-requested": {
        const id = this.dispatch({
          type: "approval-request",
          tool: event.data.tool,
          detail:
            `Sandbox expansion (${event.data.capability}): ${event.data.reason}`,
        });
        this.runtimeSandboxExpansionIds.set(runtimeSandboxKey(event.runId, event.data.tool), id);
        return;
      }
      case "tool.sandbox-expansion-resolved": {
        const key = runtimeSandboxKey(event.runId, event.data.tool);
        this.dispatch({
          type: "approval-resolved",
          decision: event.data.decision,
          id: this.runtimeSandboxExpansionIds.get(key),
        });
        this.runtimeSandboxExpansionIds.delete(key);
        return;
      }
      case "validation.started": {
        const id = this.dispatch({
          type: "validation-start",
          detail: event.data.detail,
          ...(event.data.validationId === undefined ? {} : { id: event.data.validationId }),
        });
        if (event.data.validationId) {
          this.runtimeValidationIds.set(event.data.validationId, id);
        }
        return;
      }
      case "validation.completed": {
        const id = event.data.validationId === undefined
          ? undefined
          : this.runtimeValidationIds.get(event.data.validationId);
        this.dispatch({
          type: "validation-result",
          status: event.data.status === "passed" || event.data.status === "failed" || event.data.status === "blocked"
            ? event.data.status
            : "failed",
          detail: event.data.detail,
          ...(id === undefined ? {} : { id }),
        });
        if (event.data.validationId) {
          this.runtimeValidationIds.delete(event.data.validationId);
        }
        return;
      }
      case "checkpoint.created":
        return;
      case "run.completed":
        this.state = "ready";
        this.activeRunId = undefined;
        this.closed = true;
        return;
      case "run.interrupted":
        this.dispatch({ type: "turn-interrupted", reason: event.data.reason });
        this.activeRunId = undefined;
        return;
      case "run.failed":
        this.dispatch({ type: "turn-error", message: event.data.error });
        this.activeRunId = undefined;
        return;
    }
  }

  private findLatestCard(kind: ToolCard["kind"]): ToolCard | undefined {
    return [...this.cards].reverse().find((card) => card.kind === kind);
  }

  private updateCard(id: string, update: (card: ToolCard) => ToolCard): void {
    const index = this.cards.findIndex((card) => card.id === id);
    const card = this.cards[index];
    if (index < 0 || card === undefined) return;
    this.cards[index] = update(card);
  }

  private appendTranscript(id: string, text: string): void {
    const entry = this.transcript.find((candidate) => candidate.id === id);
    if (entry) {
      entry.text += text;
    }
  }

  private replaceTranscript(id: string, text: string): void {
    const entry = this.transcript.find((candidate) => candidate.id === id);
    if (entry) {
      entry.text = text;
    }
  }

  private pushRuntimeToolId(runId: string | undefined, tool: string, id: string): void {
    const key = runtimeToolKey(runId, tool);
    const ids = this.runtimeToolIds.get(key) ?? [];
    ids.push(id);
    this.runtimeToolIds.set(key, ids);
  }

  private latestRuntimeToolId(runId: string | undefined, tool: string): string | undefined {
    return this.runtimeToolIds.get(runtimeToolKey(runId, tool))?.at(-1);
  }

  private takeRuntimeToolId(runId: string | undefined, tool: string): string | undefined {
    const key = runtimeToolKey(runId, tool);
    const ids = this.runtimeToolIds.get(key);
    const id = ids?.shift();
    if (ids?.length === 0) {
      this.runtimeToolIds.delete(key);
    }
    return id;
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export { renderToolCard } from "./tui-renderer.js";

function runtimeToolKey(runId: string | undefined, tool: string): string {
  return `${runId ?? "session"}:${tool}`;
}

function runtimeSandboxKey(runId: string | undefined, tool: string): string {
  return `${runtimeToolKey(runId, tool)}:sandbox`;
}

const MAX_RUNTIME_REVIEW_DIFF_CHARS = 24_000;

function formatRuntimeReviewDiff(review: unknown): string | undefined {
  if (typeof review === "string") {
    return review.slice(0, MAX_RUNTIME_REVIEW_DIFF_CHARS);
  }
  if (!isRecord(review) || !Array.isArray(review.files)) {
    return undefined;
  }

  const diffs = review.files
    .filter(isRecord)
    .map((file) => (typeof file.diff === "string" ? file.diff : ""))
    .filter((diff) => diff.length > 0);
  if (diffs.length === 0) return undefined;
  return diffs.join("\n").slice(0, MAX_RUNTIME_REVIEW_DIFF_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previewRuntimeValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatToolProgress(progress: number, total: number | undefined): string {
  return `${progress}${total === undefined ? "" : `/${total}`}`;
}

function normalizeToolProgress(
  progress: number,
  total: number | undefined,
): { readonly progress: number; readonly total?: number } {
  const safeTotal = total !== undefined && Number.isFinite(total) && total > 0
    ? total
    : undefined;
  const safeProgress = Number.isFinite(progress) ? Math.max(0, progress) : 0;
  return {
    progress: safeTotal === undefined
      ? safeProgress
      : Math.min(safeTotal, safeProgress),
    ...(safeTotal === undefined ? {} : { total: safeTotal }),
  };
}
