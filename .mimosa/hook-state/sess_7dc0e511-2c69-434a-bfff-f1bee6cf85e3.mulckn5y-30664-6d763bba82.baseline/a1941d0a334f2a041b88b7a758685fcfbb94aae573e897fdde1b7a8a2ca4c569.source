import type { StreamEvent } from "./chat-session.js";

export type DesktopRunStatus =
  | "idle"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "aborted";

export interface DesktopRunEvent {
  readonly sequence: number;
  readonly type: StreamEvent["type"];
  readonly data: Record<string, unknown>;
}

export interface DesktopRunLiveTool {
  readonly name: string;
  readonly progress?: number;
  readonly total?: number;
}

export interface DesktopRunLiveApproval {
  readonly id: string;
  readonly tool: string;
  readonly reason?: string;
}

export interface DesktopRunLiveState {
  readonly assistant?: string;
  readonly reasoning?: string;
  readonly tool?: DesktopRunLiveTool;
  readonly approval?: DesktopRunLiveApproval;
}

export interface DesktopRunSnapshot {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly active: boolean;
  readonly status: DesktopRunStatus;
  readonly runId?: string;
  readonly sequence: number;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly truncated: boolean;
  readonly live: DesktopRunLiveState;
  readonly events: readonly DesktopRunEvent[];
}

export interface DesktopRunSummary {
  readonly status: DesktopRunStatus;
  readonly active: boolean;
  readonly runId?: string;
  readonly sequence: number;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

const maxRetainedEvents = 256;
const maxRetainedBytes = 256 * 1024;
const maxEventStringLength = 16 * 1024;
const maxLiveTextLength = 128 * 1024;
const maxToolNameLength = 128;
const maxApprovalReasonLength = 512;
const maxPlanReviewFiles = 256;
const maxPlanReviewPathLength = 4096;
const maxPlanReviewIdLength = 96;
const maxPlanReviewHashLength = 256;
const maxPlanReviewDiffLength = 256 * 1024;

export class DesktopRunState {
  readonly sessionId: string;
  readonly runId: string;
  readonly startedAt: string;

  private status: DesktopRunStatus = "running";
  private finishedAt?: string;
  private sequence = 0;
  private retainedBytes = 0;
  private truncated = false;
  private readonly events: DesktopRunEvent[] = [];
  private assistant = "";
  private reasoning = "";
  private tool?: DesktopRunLiveTool;
  private approval?: DesktopRunLiveApproval;

  constructor(sessionId: string, runId: string, startedAt = new Date().toISOString()) {
    this.sessionId = sessionId;
    this.runId = runId;
    this.startedAt = startedAt;
  }

  get active(): boolean {
    return this.status === "running" || this.status === "waiting";
  }

  append(event: StreamEvent): DesktopRunEvent {
    const replayEvent: DesktopRunEvent = {
      sequence: ++this.sequence,
      type: event.type,
      data: sanitizeEventData(event.type, event.data),
    };
    const serializedBytes = Buffer.byteLength(JSON.stringify(replayEvent), "utf8");
    if (serializedBytes <= maxRetainedBytes) {
      this.events.push(replayEvent);
      this.retainedBytes += serializedBytes;
      while (
        this.events.length > maxRetainedEvents ||
        this.retainedBytes > maxRetainedBytes
      ) {
        const removed = this.events.shift();
        if (!removed) break;
        this.retainedBytes -= Buffer.byteLength(JSON.stringify(removed), "utf8");
        this.truncated = true;
      }
    } else {
      this.truncated = true;
    }

    this.applyLiveEvent(event);
    return replayEvent;
  }

  finish(status: Exclude<DesktopRunStatus, "idle" | "running" | "waiting">): void {
    if (!this.active && this.finishedAt !== undefined) {
      return;
    }
    this.status = status;
    this.finishedAt = new Date().toISOString();
    this.assistant = "";
    this.reasoning = "";
    this.tool = undefined;
    this.approval = undefined;
  }

  snapshot(after = 0): DesktopRunSnapshot {
    const cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    return {
      schemaVersion: 1,
      sessionId: this.sessionId,
      active: this.active,
      status: this.status,
      runId: this.runId,
      sequence: this.sequence,
      startedAt: this.startedAt,
      ...(this.finishedAt === undefined ? {} : { finishedAt: this.finishedAt }),
      truncated: this.truncated,
      live: this.liveState(),
      events: this.events.filter((event) => event.sequence > cursor),
    };
  }

  summary(): DesktopRunSummary {
    return {
      status: this.status,
      active: this.active,
      runId: this.runId,
      sequence: this.sequence,
      startedAt: this.startedAt,
      ...(this.finishedAt === undefined ? {} : { finishedAt: this.finishedAt }),
    };
  }

  private liveState(): DesktopRunLiveState {
    return {
      ...(this.assistant ? { assistant: this.assistant } : {}),
      ...(this.reasoning ? { reasoning: this.reasoning } : {}),
      ...(this.tool === undefined ? {} : { tool: this.tool }),
      ...(this.approval === undefined ? {} : { approval: this.approval }),
    };
  }

  private applyLiveEvent(event: StreamEvent): void {
    switch (event.type) {
      case "token":
        this.status = "running";
        this.assistant = appendBounded(this.assistant, readString(event.data.token));
        break;
      case "reasoning":
        this.status = "running";
        this.reasoning = appendBounded(this.reasoning, readString(event.data.reasoning));
        break;
      case "turn":
        this.status = "running";
        this.assistant = "";
        this.reasoning = "";
        this.tool = undefined;
        this.approval = undefined;
        break;
      case "tool":
        this.status = "running";
        this.tool = { name: limitString(readString(event.data.name), maxToolNameLength) };
        break;
      case "tool-progress":
        this.status = "running";
        this.tool = {
          name: limitString(readString(event.data.name), maxToolNameLength),
          ...(typeof event.data.progress === "number" && Number.isFinite(event.data.progress)
            ? { progress: event.data.progress }
            : {}),
          ...(typeof event.data.total === "number" && Number.isFinite(event.data.total)
            ? { total: event.data.total }
            : {}),
        };
        break;
      case "tool-result":
        this.status = "running";
        this.tool = undefined;
        break;
      case "approval-request":
        this.status = "waiting";
        this.approval = {
          id: limitString(readString(event.data.id), maxToolNameLength),
          tool: limitString(readString(event.data.tool), maxToolNameLength),
          ...(typeof event.data.reason === "string"
            ? { reason: limitString(event.data.reason, maxApprovalReasonLength) }
            : {}),
        };
        break;
      case "plan-review":
        this.status = "waiting";
        this.tool = undefined;
        this.approval = undefined;
        break;
      case "approval":
        this.status = "running";
        this.approval = undefined;
        break;
      case "error":
        this.finish("failed");
        break;
      case "done":
        this.finish(doneStatus(event.data.status));
        break;
      default:
        break;
    }
  }
}

export class DesktopRunRegistry {
  private readonly runs = new Map<string, DesktopRunState>();

  start(sessionId: string, runId: string): DesktopRunState {
    const run = new DesktopRunState(sessionId, runId);
    this.runs.set(sessionId, run);
    return run;
  }

  get(sessionId: string): DesktopRunState | undefined {
    return this.runs.get(sessionId);
  }

  delete(sessionId: string): void {
    this.runs.delete(sessionId);
  }

  snapshot(sessionId: string, after = 0): DesktopRunSnapshot {
    const run = this.runs.get(sessionId);
    if (!run) {
      return {
        schemaVersion: 1,
        sessionId,
        active: false,
        status: "idle",
        sequence: 0,
        truncated: false,
        live: {},
        events: [],
      };
    }
    return run.snapshot(after);
  }

  summary(sessionId: string): DesktopRunSummary {
    return (
      this.runs.get(sessionId)?.summary() ?? {
        status: "idle",
        active: false,
        sequence: 0,
      }
    );
  }
}

function doneStatus(value: unknown): Exclude<DesktopRunStatus, "idle" | "running" | "waiting"> {
  if (value === "aborted") return "aborted";
  if (value === "error" || value === "failed") return "failed";
  return "done";
}

function appendBounded(current: string, next: string): string {
  if (!next) return current;
  const combined = current + next;
  return combined.length <= maxLiveTextLength
    ? combined
    : combined.slice(0, maxLiveTextLength);
}

function sanitizeEventData(
  type: StreamEvent["type"],
  data: Record<string, unknown>,
): Record<string, unknown> {
  switch (type) {
    case "token":
      return { token: limitString(readString(data.token), maxEventStringLength) };
    case "reasoning":
      return { reasoning: limitString(readString(data.reasoning), maxEventStringLength) };
    case "tool":
      return { name: limitString(readString(data.name), maxToolNameLength) };
    case "tool-progress":
      return {
        name: limitString(readString(data.name), maxToolNameLength),
        ...(typeof data.progress === "number" && Number.isFinite(data.progress)
          ? { progress: data.progress }
          : {}),
        ...(typeof data.total === "number" && Number.isFinite(data.total)
          ? { total: data.total }
          : {}),
      };
    case "tool-result":
      return { name: limitString(readString(data.name), maxToolNameLength) };
    case "approval-request":
      return {
        id: limitString(readString(data.id), maxToolNameLength),
        tool: limitString(readString(data.tool), maxToolNameLength),
        ...(typeof data.reason === "string"
          ? { reason: limitString(data.reason, maxApprovalReasonLength) }
          : {}),
      };
    case "plan-review": {
      const review = sanitizePlanReview(data.review);
      return review === undefined ? {} : { review };
    }
    case "approval":
      return {
        tool: limitString(readString(data.tool), maxToolNameLength),
        ...(typeof data.decision === "string"
          ? { decision: limitString(data.decision, 32) }
          : {}),
      };
    case "validation":
      return {
        ...(typeof data.status === "string" ? { status: limitString(data.status, 32) } : {}),
        ...(typeof data.validationId === "string"
          ? { validationId: limitString(data.validationId, 96) }
          : {}),
        ...(typeof data.changeSetId === "string"
          ? { changeSetId: limitString(data.changeSetId, 96) }
          : {}),
        ...(typeof data.checks === "object" && Array.isArray(data.checks)
          ? { checkCount: data.checks.length }
          : {}),
      };
    case "usage":
      return {
        ...(typeof data.totalTokens === "number" ? { totalTokens: data.totalTokens } : {}),
        ...(typeof data.promptTokens === "number" ? { promptTokens: data.promptTokens } : {}),
        ...(typeof data.completionTokens === "number"
          ? { completionTokens: data.completionTokens }
          : {}),
      };
    case "turn":
      return typeof data.turn === "number" ? { turn: data.turn } : {};
    case "done":
      return {
        ...(typeof data.status === "string" ? { status: limitString(data.status, 32) } : {}),
        ...(typeof data.turns === "number" ? { turns: data.turns } : {}),
      };
    case "runtime": {
      const runtime = data.event;
      if (!runtime || typeof runtime !== "object") return {};
      const runtimeRecord = runtime as Record<string, unknown>;
      return {
        event: {
          ...(typeof runtimeRecord.type === "string"
            ? { type: limitString(runtimeRecord.type, 64) }
            : {}),
          ...(typeof runtimeRecord.sequence === "number"
            ? { sequence: runtimeRecord.sequence }
            : {}),
        },
      };
    }
    case "error":
      return {};
    default:
      return {};
  }
}

function sanitizePlanReview(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const changeSetId = readString(candidate.changeSetId);
  const createdAt = readString(candidate.createdAt);
  const additions = candidate.additions;
  const deletions = candidate.deletions;
  const rawFiles = candidate.files;
  if (
    !changeSetId
    || changeSetId.length > maxPlanReviewIdLength
    || !createdAt
    || createdAt.length > 96
    || !Number.isSafeInteger(additions)
    || !Number.isSafeInteger(deletions)
    || (additions as number) < 0
    || (deletions as number) < 0
    || !Array.isArray(rawFiles)
    || rawFiles.length > maxPlanReviewFiles
  ) {
    return undefined;
  }

  const files: Record<string, unknown>[] = [];
  for (const rawFile of rawFiles) {
    if (!rawFile || typeof rawFile !== "object") return undefined;
    const file = rawFile as Record<string, unknown>;
    const path = readString(file.path);
    const kind = file.kind === "directory" ? "directory" : file.kind === "file" ? "file" : "";
    const afterHash = readString(file.afterHash);
    const diff = readString(file.diff);
    const fileAdditions = file.additions;
    const fileDeletions = file.deletions;
    if (
      !path
      || path.length > maxPlanReviewPathLength
      || !kind
      || !afterHash
      || afterHash.length > maxPlanReviewHashLength
      || diff.length > maxPlanReviewDiffLength
      || !Number.isSafeInteger(fileAdditions)
      || !Number.isSafeInteger(fileDeletions)
      || (fileAdditions as number) < 0
      || (fileDeletions as number) < 0
      || typeof file.beforeExists !== "boolean"
      || typeof file.afterExists !== "boolean"
    ) {
      return undefined;
    }
    files.push({
      path,
      kind,
      ...(typeof file.beforeHash === "string"
        ? { beforeHash: file.beforeHash.slice(0, maxPlanReviewHashLength) }
        : {}),
      afterHash,
      diff,
      additions: fileAdditions,
      deletions: fileDeletions,
      beforeExists: file.beforeExists,
      afterExists: file.afterExists,
    });
  }

  const review = {
    changeSetId,
    createdAt,
    additions,
    deletions,
    files,
  };
  return Buffer.byteLength(JSON.stringify(review), "utf8") <= maxPlanReviewDiffLength
    ? review
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function limitString(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
