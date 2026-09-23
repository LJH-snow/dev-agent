import type {
  CollaborationExecutionEvent,
  CollaborationExecutionResult,
  CollaborationTask,
  CollaborationTaskResult,
  PlanReview,
  RuntimeEvent,
  RuntimeRunStatus,
} from "@dev-agent/agent-core";

import {
  TuiSessionModel,
  type TuiTranscriptEntry,
  type UsageSummary,
  type TuiStateSnapshot,
} from "../tui-session.js";
import type { McpManagementResult } from "../mcp-command.js";

export interface InkRunSummary {
  readonly status: string;
  readonly turns: number;
  readonly firstTokenMs?: number;
  readonly totalMs?: number;
  readonly queueMs?: number;
  readonly modelMs?: number;
  readonly toolMs?: number;
  readonly usage?: UsageSummary;
  readonly cost?: number;
}

export interface InkThoughtSnapshot {
  readonly active: boolean;
  readonly startedAt?: string;
  readonly elapsedMs?: number;
  readonly steps: readonly string[];
  readonly summary?: string;
}

export interface InkHistoryView {
  readonly title: string;
  readonly rows: readonly string[];
}

export interface InkSessionPicker {
  readonly title: string;
  readonly rows: readonly string[];
  readonly selectedIndex: number;
}

export interface InkRetryState {
  readonly prompt: string;
  readonly error: string;
}

export interface InkPlanState {
  readonly prompt: string;
  readonly review: PlanReview;
  readonly status: "ready" | "applying";
}

export interface InkCollaborationTask {
  readonly id: string;
  readonly title: string;
  readonly role?: string;
  readonly dependsOn: readonly string[];
  readonly status: CollaborationTaskResult["status"];
  readonly attempts: number;
  readonly durationMs: number;
  readonly error?: string;
  readonly changedFiles: readonly string[];
  readonly additions: number;
  readonly deletions: number;
}

export interface InkCollaborationReview {
  readonly mergeable: boolean;
  readonly changedFiles: readonly string[];
  readonly additions: number;
  readonly deletions: number;
  readonly conflicts: readonly string[];
}

export interface InkCollaborationSnapshot {
  readonly status: "running" | "review" | "merged" | "failed" | "cancelled";
  readonly tasks: readonly InkCollaborationTask[];
  readonly review?: InkCollaborationReview;
}

export type InkMcpServerState =
  | "disabled"
  | "configured"
  | "connecting"
  | "reconnecting"
  | "ready"
  | "timeout"
  | "failed"
  | "changed"
  | "invalid"
  | "skipped";

export interface InkMcpServerSnapshot {
  readonly name: string;
  readonly state: InkMcpServerState;
  readonly reason?: string;
  readonly latencyMs?: number;
  readonly reconnectAttempt?: number;
  readonly tools: number;
  readonly resources: number;
  readonly prompts: number;
  readonly serverInfo?: string;
}

export interface InkMcpSnapshot {
  readonly status: "idle" | "loading" | "ready" | "degraded" | "disabled";
  readonly servers: readonly InkMcpServerSnapshot[];
  readonly totals: {
    readonly servers: number;
    readonly tools: number;
    readonly resources: number;
    readonly prompts: number;
  };
  readonly updatedAt?: string;
}

export interface InkRuntimeSnapshot extends TuiStateSnapshot {
  readonly notices: readonly string[];
  readonly summary?: InkRunSummary;
  readonly speedMode: "fast" | "balanced" | "deep";
  readonly committedTranscript: readonly TuiTranscriptEntry[];
  readonly thought: InkThoughtSnapshot;
  readonly historyView?: InkHistoryView;
  readonly sessionPicker?: InkSessionPicker;
  readonly retry?: InkRetryState;
  readonly plan?: InkPlanState;
  readonly collaboration?: InkCollaborationSnapshot;
  readonly mcp?: InkMcpSnapshot;
}

export class InkRuntimeStore {
  private readonly model = new TuiSessionModel();
  private queuedPrompts: string[] = [];
  private notices: string[] = [];
  private summary: InkRunSummary | undefined;
  private speedMode: InkRuntimeSnapshot["speedMode"] = "balanced";
  private historyView: InkHistoryView | undefined;
  private sessionPicker: InkSessionPicker | undefined;
  private committedTranscript: TuiTranscriptEntry[] = [];
  private thoughtRunId: string | undefined;
  private thoughtStartedAt: string | undefined;
  private thoughtElapsedMs: number | undefined;
  private thoughtSteps: string[] = [];
  private thoughtSummary: string | undefined;
  private retry: InkRetryState | undefined;
  private plan: InkPlanState | undefined;
  private collaboration: InkCollaborationSnapshot | undefined;
  private mcp: InkMcpSnapshot | undefined;
  private readonly lastThoughtSequenceBySession = new Map<string, number>();
  private snapshotValue: InkRuntimeSnapshot = this.buildSnapshot();
  private readonly listeners = new Set<() => void>();
  private applyingRuntimeEvent = false;

  constructor() {
    this.model.subscribe(() => {
      if (!this.applyingRuntimeEvent) {
        this.publish();
      }
    });
  }

  getSnapshot = (): InkRuntimeSnapshot => this.snapshotValue;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  apply(event: RuntimeEvent): void {
    const shouldProjectThought = this.shouldProjectThoughtEvent(event);
    this.applyingRuntimeEvent = true;
    try {
      this.model.applyRuntimeEvent(event);
    } finally {
      this.applyingRuntimeEvent = false;
    }
    if (event.type === "run.started") {
      this.commitPromptTranscript(event.runId);
    }
    if (
      event.type === "run.completed" ||
      event.type === "run.interrupted" ||
      event.type === "run.failed"
    ) {
      this.commitTranscript(event.runId);
    }
    if (shouldProjectThought) {
      this.applyThoughtEvent(event);
    }
    this.publish();
  }

  setQueuedPrompts(prompts: readonly string[]): void {
    this.queuedPrompts = [...prompts];
    this.publish();
  }

  addNotice(notice: string): void {
    if (notice.trim() === "") return;
    this.notices = [...this.notices, notice];
    this.publish();
  }

  clearNotices(): void {
    this.notices = [];
    this.publish();
  }

  setSummary(summary: InkRunSummary | undefined): void {
    this.summary = summary;
    this.publish();
  }

  setSpeedMode(mode: InkRuntimeSnapshot["speedMode"]): void {
    this.speedMode = mode;
    this.publish();
  }

  setHistoryView(view: InkHistoryView | undefined): void {
    this.historyView = view === undefined
      ? undefined
      : {
          title: view.title,
          rows: [...view.rows],
        };
    this.publish();
  }

  clearHistoryView(): void {
    this.setHistoryView(undefined);
  }

  setSessionPicker(picker: InkSessionPicker | undefined): void {
    this.sessionPicker = picker === undefined
      ? undefined
      : {
          title: picker.title,
          rows: [...picker.rows],
          selectedIndex: clampPickerIndex(picker.selectedIndex, picker.rows.length),
        };
    this.publish();
  }

  setSessionPickerIndex(index: number): void {
    if (this.sessionPicker === undefined) return;
    this.sessionPicker = {
      ...this.sessionPicker,
      selectedIndex: clampPickerIndex(index, this.sessionPicker.rows.length),
    };
    this.publish();
  }

  setRetry(retry: InkRetryState | undefined): void {
    this.retry = retry === undefined ? undefined : { ...retry };
    this.publish();
  }

  setPlan(plan: InkPlanState | undefined): void {
    this.plan = plan === undefined
      ? undefined
      : {
          prompt: plan.prompt,
          status: plan.status,
          review: clonePlanReview(plan.review),
        };
    this.publish();
  }

  setPlanStatus(status: InkPlanState["status"]): void {
    if (this.plan === undefined) return;
    this.plan = { ...this.plan, status };
    this.publish();
  }

  applyCollaborationEvent(event: CollaborationExecutionEvent): void {
    switch (event.type) {
      case "execution.started":
        this.collaboration = {
          status: "running",
          tasks: this.collaboration?.tasks ?? [],
        };
        break;
      case "plan.ready":
        this.collaboration = {
          status: "running",
          tasks: event.tasks.map(toInkCollaborationTask),
        };
        break;
      case "task.queued":
        this.updateCollaborationTask(event.taskId, (task) => ({
          ...task,
          status: "queued",
        }));
        break;
      case "task.started":
        this.updateCollaborationTask(event.taskId, (task) => ({
          ...task,
          status: "running",
          attempts: event.attempt,
        }));
        break;
      case "task.retrying":
        this.updateCollaborationTask(event.taskId, (task) => ({
          ...task,
          status: "retrying",
          attempts: event.attempt,
          error: sanitizeCollaborationText(event.error),
        }));
        break;
      case "task.completed":
        this.updateCollaborationTaskFromResult(event.result);
        break;
      case "task.failed":
        this.updateCollaborationTaskFromResult(event.result);
        break;
      case "task.blocked":
        this.updateCollaborationTask(event.taskId, (task) => ({
          ...task,
          status: "blocked",
          error: sanitizeCollaborationText(event.detail),
        }));
        break;
      case "task.cancelled":
        this.updateCollaborationTask(event.taskId, (task) => ({
          ...task,
          status: "cancelled",
          error: sanitizeCollaborationText(event.detail),
        }));
        break;
      case "review.ready":
        this.collaboration = {
          status: this.collaboration?.status ?? "running",
          tasks: this.collaboration?.tasks ?? event.review.tasks.map(toInkTaskFromResult),
          review: toInkCollaborationReview(event.review),
        };
        break;
      case "execution.completed":
        this.collaboration = {
          status: event.status,
          tasks: this.collaboration?.tasks ?? [],
          ...(this.collaboration?.review === undefined
            ? {}
            : { review: this.collaboration.review }),
        };
        break;
    }
    this.publish();
  }

  setCollaborationResult(result: CollaborationExecutionResult): void {
    this.collaboration = {
      status: result.status,
      tasks: result.tasks.map(toInkTaskFromResult),
      review: toInkCollaborationReview(result.review),
    };
    this.publish();
  }

  setCollaborationStatus(status: InkCollaborationSnapshot["status"]): void {
    if (this.collaboration === undefined) return;
    this.collaboration = { ...this.collaboration, status };
    this.publish();
  }

  setMcpSnapshot(snapshot: InkMcpSnapshot | undefined): void {
    this.mcp = snapshot === undefined ? undefined : cloneMcpSnapshot(snapshot);
    this.publish();
  }

  setMcpManagementResult(result: McpManagementResult): void {
    this.setMcpSnapshot(mcpSnapshotFromResult(result));
  }

  applyMcpLifecycleEvent(event: {
    readonly name: string;
    readonly state: InkMcpServerState;
    readonly reason?: string;
    readonly reconnectAttempt?: number;
    readonly latencyMs?: number;
    readonly tools?: number;
    readonly resources?: number;
    readonly prompts?: number;
  }): void {
    const existing = this.mcp?.servers.find((server) => server.name === event.name);
    const nextServer: InkMcpServerSnapshot = {
      name: sanitizeMcpText(event.name, 80),
      state: event.state,
      ...(event.reason === undefined ? {} : { reason: sanitizeMcpText(event.reason, 120) }),
      ...(event.latencyMs === undefined ? {} : { latencyMs: Math.max(0, event.latencyMs) }),
      ...(event.reconnectAttempt === undefined ? {} : { reconnectAttempt: event.reconnectAttempt }),
      tools: event.tools ?? existing?.tools ?? 0,
      resources: event.resources ?? existing?.resources ?? 0,
      prompts: event.prompts ?? existing?.prompts ?? 0,
      ...(existing?.serverInfo === undefined ? {} : { serverInfo: existing.serverInfo }),
    };
    const servers = existing === undefined
      ? [...(this.mcp?.servers ?? []), nextServer]
      : (this.mcp?.servers ?? []).map((server) =>
          server.name === event.name ? nextServer : server
        );
    this.mcp = buildMcpSnapshot(
      this.mcp?.status === "disabled" ? "degraded" : lifecycleStatus(servers),
      servers,
    );
    this.publish();
  }

  clearCollaboration(): void {
    if (this.collaboration === undefined) return;
    this.collaboration = undefined;
    this.mcp = undefined;
    this.publish();
  }

  reset(): void {
    this.model.reset();
    this.queuedPrompts = [];
    this.notices = [];
    this.summary = undefined;
    this.historyView = undefined;
    this.sessionPicker = undefined;
    this.committedTranscript = [];
    this.thoughtRunId = undefined;
    this.thoughtStartedAt = undefined;
    this.thoughtElapsedMs = undefined;
    this.thoughtSteps = [];
    this.thoughtSummary = undefined;
    this.retry = undefined;
    this.plan = undefined;
    this.collaboration = undefined;
    this.lastThoughtSequenceBySession.clear();
    this.snapshotValue = this.buildSnapshot();
    this.publish();
  }

  private buildSnapshot(): InkRuntimeSnapshot {
    return {
      ...this.model.snapshot(),
      queuedPrompts: [...this.queuedPrompts],
      notices: [...this.notices],
      speedMode: this.speedMode,
      committedTranscript: this.committedTranscript.map((entry) => ({ ...entry })),
      thought: {
        active: this.thoughtRunId !== undefined,
        ...(this.thoughtStartedAt === undefined ? {} : { startedAt: this.thoughtStartedAt }),
        ...(this.thoughtElapsedMs === undefined ? {} : { elapsedMs: this.thoughtElapsedMs }),
        steps: [...this.thoughtSteps],
        ...(this.thoughtSummary === undefined ? {} : { summary: this.thoughtSummary }),
      },
      ...(this.historyView === undefined
        ? {}
        : {
            historyView: {
              title: this.historyView.title,
              rows: [...this.historyView.rows],
            },
          }),
      ...(this.sessionPicker === undefined
        ? {}
        : {
            sessionPicker: {
              title: this.sessionPicker.title,
              rows: [...this.sessionPicker.rows],
              selectedIndex: this.sessionPicker.selectedIndex,
            },
          }),
      ...(this.retry === undefined ? {} : { retry: { ...this.retry } }),
      ...(this.plan === undefined
        ? {}
        : {
            plan: {
              prompt: this.plan.prompt,
              status: this.plan.status,
              review: clonePlanReview(this.plan.review),
            },
          }),
      ...(this.collaboration === undefined
        ? {}
        : {
            collaboration: cloneCollaborationSnapshot(this.collaboration),
          }),
      ...(this.mcp === undefined ? {} : { mcp: cloneMcpSnapshot(this.mcp) }),
      ...(this.summary === undefined ? {} : { summary: this.summary }),
    };
  }

  private shouldProjectThoughtEvent(event: RuntimeEvent): boolean {
    const lastSequence = this.lastThoughtSequenceBySession.get(event.sessionId);
    if (lastSequence !== undefined && event.sequence <= lastSequence) {
      return false;
    }
    this.lastThoughtSequenceBySession.set(event.sessionId, event.sequence);
    return true;
  }

  private applyThoughtEvent(event: RuntimeEvent): void {
    switch (event.type) {
      case "run.started": {
        const runId = event.runId ?? `runtime-run-${event.sequence}`;
        this.thoughtRunId = runId;
        this.thoughtStartedAt = event.emittedAt;
        this.thoughtElapsedMs = undefined;
        this.thoughtSteps = [];
        this.thoughtSummary = undefined;
        return;
      }
      case "run.status":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep(publicStatusStep(event.data.status, event.data.detail));
        return;
      case "assistant.delta":
        if (!this.isCurrentThoughtRun(event.runId) || event.data.channel !== "reasoning") {
          return;
        }
        this.addThoughtStep("Model is reasoning");
        return;
      case "tool.started":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep(`Calling ${event.data.tool}`);
        return;
      case "tool.completed":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep(`Finished ${event.data.tool}`);
        return;
      case "tool.failed":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep(`Failed ${event.data.tool}`);
        return;
      case "tool.approval-requested":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep(`Waiting for approval · ${event.data.tool}`);
        return;
      case "tool.approval-resolved":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep(`Approval ${event.data.decision} · ${event.data.tool}`);
        return;
      case "tool.sandbox-expansion-requested":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep(`Waiting for sandbox approval · ${event.data.tool}`);
        return;
      case "tool.sandbox-expansion-resolved":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep(`Sandbox ${event.data.decision} · ${event.data.tool}`);
        return;
      case "validation.started":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep("Validating changes");
        return;
      case "validation.completed":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep(`Validation ${event.data.status}`);
        return;
      case "run.completed":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.finishThought(event.emittedAt);
        return;
      case "run.interrupted":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep("Run interrupted");
        this.finishThought(event.emittedAt);
        return;
      case "run.failed":
        if (!this.isCurrentThoughtRun(event.runId)) return;
        this.addThoughtStep("Run failed");
        this.finishThought(event.emittedAt);
        return;
      default:
        return;
    }
  }

  private isCurrentThoughtRun(runId: string | undefined): boolean {
    return this.thoughtRunId !== undefined &&
      (runId === undefined || runId === this.thoughtRunId);
  }

  private addThoughtStep(step: string): void {
    if (step.trim() === "" || this.thoughtSteps.at(-1) === step) return;
    this.thoughtSteps = [...this.thoughtSteps.slice(-4), step];
  }

  private finishThought(emittedAt: string): void {
    const startedTime = this.thoughtStartedAt === undefined
      ? Number.NaN
      : Date.parse(this.thoughtStartedAt);
    const emittedTime = Date.parse(emittedAt);
    const elapsedMs = Number.isFinite(startedTime) && Number.isFinite(emittedTime)
      ? Math.max(0, emittedTime - startedTime)
      : 0;
    this.thoughtElapsedMs = elapsedMs;
    this.thoughtSummary = `Thought for ${formatThoughtElapsed(elapsedMs)}`;
    this.thoughtRunId = undefined;
  }

  private commitTranscript(runId: string | undefined): void {
    const committedIds = new Set(this.committedTranscript.map((entry) => entry.id));
    const entries = this.model.snapshot().transcript.filter((entry) =>
      runId === undefined || entry.runId === runId
    );
    for (const entry of entries) {
      if (committedIds.has(entry.id)) continue;
      this.committedTranscript.push({ ...entry });
    }
  }

  private commitPromptTranscript(runId: string | undefined): void {
    const snapshot = this.model.snapshot();
    const targetRunId = runId ?? snapshot.activeRunId;
    const committedIds = new Set(this.committedTranscript.map((entry) => entry.id));
    const prompt = snapshot.transcript.find((entry) =>
      entry.role === "user" &&
      entry.runId === targetRunId &&
      !committedIds.has(entry.id)
    );
    if (prompt) {
      this.committedTranscript.push({ ...prompt });
    }
  }

  private publish(): void {
    this.snapshotValue = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private updateCollaborationTask(
    taskId: string,
    update: (task: InkCollaborationTask) => InkCollaborationTask,
  ): void {
    if (this.collaboration === undefined) return;
    this.collaboration = {
      ...this.collaboration,
      tasks: this.collaboration.tasks.map((task) =>
        task.id === taskId ? update(task) : task
      ),
    };
  }

  private updateCollaborationTaskFromResult(result: CollaborationTaskResult): void {
    if (this.collaboration === undefined) {
      this.collaboration = {
        status: "running",
        tasks: [toInkTaskFromResult(result)],
      };
      return;
    }
    this.updateCollaborationTask(result.id, () => toInkTaskFromResult(result));
  }
}

function clampPickerIndex(index: number, rowCount: number): number {
  if (rowCount <= 0 || !Number.isSafeInteger(index)) return 0;
  return Math.min(Math.max(0, index), rowCount - 1);
}

function clonePlanReview(review: PlanReview): PlanReview {
  return {
    changeSetId: review.changeSetId,
    additions: review.additions,
    deletions: review.deletions,
    createdAt: review.createdAt,
    files: review.files.map((file) => ({ ...file })),
  };
}

function toInkCollaborationTask(task: CollaborationTask): InkCollaborationTask {
  return {
    id: safeCollaborationText(task.id, 80),
    title: safeCollaborationText(task.title, 120),
    ...(task.role === undefined ? {} : { role: safeCollaborationText(task.role, 40) }),
    dependsOn: (task.dependsOn ?? []).map((dependency) =>
      safeCollaborationText(dependency, 80)
    ),
    status: "queued",
    attempts: 0,
    durationMs: 0,
    changedFiles: [],
    additions: 0,
    deletions: 0,
  };
}

function toInkTaskFromResult(result: CollaborationTaskResult): InkCollaborationTask {
  return {
    id: safeCollaborationText(result.id, 80),
    title: safeCollaborationText(result.title, 120),
    ...(result.role === undefined ? {} : { role: safeCollaborationText(result.role, 40) }),
    dependsOn: result.dependsOn.map((dependency) =>
      safeCollaborationText(dependency, 80)
    ),
    status: result.status,
    attempts: result.attempts,
    durationMs: result.durationMs,
    ...(result.error === undefined
      ? {}
      : { error: sanitizeCollaborationText(result.error) }),
    changedFiles: (result.diff?.changedFiles ?? []).map((file) =>
      sanitizeCollaborationText(file, 160)
    ),
    additions: result.diff?.additions ?? 0,
    deletions: result.diff?.deletions ?? 0,
  };
}

function toInkCollaborationReview(
  review: CollaborationExecutionResult["review"],
): InkCollaborationReview {
  return {
    mergeable: review.mergeable,
    changedFiles: review.changedFiles.map((file) => sanitizeCollaborationText(file, 160)),
    additions: review.additions,
    deletions: review.deletions,
    conflicts: review.conflicts.map((conflict) => sanitizeCollaborationText(conflict, 160)),
  };
}

function cloneCollaborationSnapshot(
  collaboration: InkCollaborationSnapshot,
): InkCollaborationSnapshot {
  return {
    status: collaboration.status,
    tasks: collaboration.tasks.map((task) => ({
      ...task,
      dependsOn: [...task.dependsOn],
      changedFiles: [...task.changedFiles],
    })),
    ...(collaboration.review === undefined
      ? {}
      : {
          review: {
            ...collaboration.review,
            changedFiles: [...collaboration.review.changedFiles],
            conflicts: [...collaboration.review.conflicts],
          },
        }),
  };
}

function mcpSnapshotFromResult(result: McpManagementResult): InkMcpSnapshot {
  const servers = result.servers.map((server): InkMcpServerSnapshot => ({
    name: sanitizeMcpText(server.name, 80),
    state: server.state,
    ...(server.reason === null ? {} : { reason: server.reason }),
    ...(server.latencyMs === null ? {} : { latencyMs: server.latencyMs }),
    tools: server.capabilities?.toolCount ?? 0,
    resources: server.capabilities?.resourceCount ?? 0,
    prompts: server.capabilities?.promptCount ?? 0,
    ...(server.serverInfo?.name === null || server.serverInfo === null
      ? {}
      : { serverInfo: sanitizeMcpText(server.serverInfo.name, 100) }),
  }));
  const status = result.summary.total === 0
    ? "idle"
    : result.summary.disabled === result.summary.total
      ? "disabled"
      : result.ok
        ? "ready"
        : "degraded";
  return buildMcpSnapshot(status, servers);
}

function buildMcpSnapshot(
  status: InkMcpSnapshot["status"],
  servers: readonly InkMcpServerSnapshot[],
): InkMcpSnapshot {
  return {
    status,
    servers: servers.map((server) => ({
      ...server,
      ...(server.reason === undefined ? {} : { reason: sanitizeMcpText(server.reason, 120) }),
    })),
    totals: {
      servers: servers.length,
      tools: servers.reduce((total, server) => total + server.tools, 0),
      resources: servers.reduce((total, server) => total + server.resources, 0),
      prompts: servers.reduce((total, server) => total + server.prompts, 0),
    },
    updatedAt: new Date().toISOString(),
  };
}

function cloneMcpSnapshot(snapshot: InkMcpSnapshot): InkMcpSnapshot {
  return {
    status: snapshot.status,
    servers: snapshot.servers.map((server) => ({ ...server })),
    totals: { ...snapshot.totals },
    ...(snapshot.updatedAt === undefined ? {} : { updatedAt: snapshot.updatedAt }),
  };
}

function lifecycleStatus(
  servers: readonly InkMcpServerSnapshot[],
): InkMcpSnapshot["status"] {
  if (servers.length === 0) return "idle";
  if (servers.every((server) => server.state === "disabled")) return "disabled";
  return servers.some((server) =>
    server.state === "failed" ||
    server.state === "timeout" ||
    server.state === "changed" ||
    server.state === "reconnecting" ||
    server.state === "invalid"
  ) ? "degraded" : "ready";
}

function sanitizeMcpText(value: string, maxChars: number): string {
  return value
    .replace(/(?:^|\s)(?:\/|[A-Za-z]:[\\/])\S+/g, " [path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function safeCollaborationText(value: string, maxChars = 240): string {
  return sanitizeCollaborationText(value, maxChars);
}

function sanitizeCollaborationText(value: string | undefined, maxChars = 240): string {
  if (value === undefined) return "";
  return value
    .replace(/(?:^|\s)(?:\/|[A-Za-z]:[\\/])\S+/g, " [path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function publicStatusStep(status: RuntimeRunStatus, detail?: string): string {
  const label = status === "streaming"
    ? "Generating response"
    : status === "tool-running"
      ? "Working with tools"
      : status === "waiting-approval"
        ? "Waiting for approval"
        : status === "validating"
          ? "Validating changes"
          : status === "thinking"
            ? "Thinking"
            : status === "ready"
              ? "Ready"
              : status[0]?.toUpperCase() + status.slice(1);
  return detail === undefined ? label : `${label} · ${detail}`;
}

function formatThoughtElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 100) / 10);
  return `${seconds.toFixed(1)}s`;
}
