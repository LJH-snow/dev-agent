import type { DesktopStatusSnapshot } from "./status.js";
import {
  normalizeExecutionHistoryRecord,
  type ExecutionHistoryRecord,
} from "./execution-history.js";
import type {
  DesktopRunLiveState,
  DesktopRunStatus,
  DesktopRunSummary,
} from "./run-state.js";

export const EXECUTION_CENTER_SCHEMA_VERSION = 1 as const;
export const MAX_EXECUTION_CENTER_SESSIONS = 256;
export const MAX_EXECUTION_CENTER_SESSION_ID_CHARS = 96;
export const MAX_EXECUTION_CENTER_TITLE_CHARS = 96;
export const MAX_EXECUTION_CENTER_TOOL_CHARS = 128;
export const MAX_EXECUTION_CENTER_SEQUENCE = 10_000_000;
export const MAX_EXECUTION_CENTER_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_EXECUTION_CENTER_RESPONSE_BYTES = 256 * 1024;

export type ExecutionCenterStage =
  | "idle"
  | "model"
  | "tool"
  | "approval"
  | "done"
  | "failed"
  | "aborted";

export interface ExecutionCenterInput {
  readonly sessionId: string;
  readonly title?: string;
  readonly lastActiveAt?: string;
  readonly run: DesktopRunSummary;
  readonly live?: DesktopRunLiveState;
}

export interface ExecutionCenterTool {
  readonly name: string;
  readonly progress?: number;
  readonly total?: number;
}

export interface ExecutionCenterCard {
  readonly sessionId: string;
  readonly title: string;
  readonly status: DesktopRunStatus;
  readonly active: boolean;
  readonly stage: ExecutionCenterStage;
  readonly sequence: number;
  readonly runId?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly lastActiveAt?: string;
  readonly durationMs?: number;
  readonly tool?: ExecutionCenterTool;
  readonly approvalPending: boolean;
}

export interface ExecutionCenterRuntime {
  readonly executor: DesktopStatusSnapshot["executor"];
  readonly runtime: DesktopStatusSnapshot["runtime"];
  readonly approval: DesktopStatusSnapshot["approval"];
  readonly validation: DesktopStatusSnapshot["validation"];
}

export interface ExecutionCenterSnapshot {
  readonly schemaVersion: typeof EXECUTION_CENTER_SCHEMA_VERSION;
  readonly metadataOnly: true;
  readonly checkedAt: string;
  readonly currentSessionId?: string;
  readonly historySessionId?: string;
  readonly history: readonly ExecutionHistoryRecord[];
  readonly runtime?: ExecutionCenterRuntime;
  readonly total: number;
  readonly active: number;
  readonly running: number;
  readonly waiting: number;
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
  readonly sessions: readonly ExecutionCenterCard[];
}

const statuses: readonly DesktopRunStatus[] = ["idle", "running", "waiting", "done", "failed", "aborted"];
const stages: readonly ExecutionCenterStage[] = ["idle", "model", "tool", "approval", "done", "failed", "aborted"];
const executorModes: readonly DesktopStatusSnapshot["executor"]["mode"][] = [
  "local",
  "sandboxed-macos",
  "sandboxed-linux",
  "unsupported",
  "unknown",
];
const approvalModes: readonly DesktopStatusSnapshot["approval"]["mode"][] = [
  "allow",
  "deny-dangerous",
  "ask",
  "review-writes",
  "unknown",
];
const validationPolicies: readonly DesktopStatusSnapshot["validation"]["policy"][] = [
  "fast",
  "default",
  "strict",
  "unknown",
];
const validationResults: readonly DesktopStatusSnapshot["validation"]["lastResult"][] = [
  "passed",
  "failed",
  "skipped",
  "blocked",
  "unknown",
];

export function createExecutionCenterSnapshot(
  inputs: readonly ExecutionCenterInput[] = [],
  currentSessionId?: string,
  currentStatus?: DesktopStatusSnapshot,
  checkedAt = new Date().toISOString(),
): ExecutionCenterSnapshot {
  const normalized: ExecutionCenterCard[] = [];
  const seen = new Set<string>();
  for (const input of inputs.slice(0, MAX_EXECUTION_CENTER_SESSIONS)) {
    const card = normalizeInput(input, checkedAt);
    if (!card || seen.has(card.sessionId)) continue;
    seen.add(card.sessionId);
    normalized.push(card);
  }
  normalized.sort(compareCards);

  const active = normalized.filter((card) => card.active).length;
  const running = normalized.filter((card) => card.status === "running").length;
  const waiting = normalized.filter((card) => card.status === "waiting").length;
  const completed = normalized.filter((card) => card.status === "done").length;
  const failed = normalized.filter((card) => card.status === "failed").length;
  const aborted = normalized.filter((card) => card.status === "aborted").length;
  const normalizedCurrentSessionId = normalizeId(currentSessionId, MAX_EXECUTION_CENTER_SESSION_ID_CHARS);
  const runtime = normalizeRuntime(currentStatus);

  return {
    schemaVersion: EXECUTION_CENTER_SCHEMA_VERSION,
    metadataOnly: true,
    checkedAt: normalizeTimestamp(checkedAt) ?? new Date().toISOString(),
    ...(normalizedCurrentSessionId === undefined ? {} : { currentSessionId: normalizedCurrentSessionId }),
    history: [],
    ...(runtime === undefined ? {} : { runtime }),
    total: normalized.length,
    active,
    running,
    waiting,
    completed,
    failed,
    aborted,
    sessions: normalized,
  };
}

export function withExecutionHistory(
  snapshot: ExecutionCenterSnapshot,
  sessionId: string | undefined,
  history: readonly unknown[] = [],
): ExecutionCenterSnapshot {
  const normalizedSessionId = normalizeId(sessionId, MAX_EXECUTION_CENTER_SESSION_ID_CHARS);
  const normalizedHistory = history
    .slice(0, 50)
    .map(normalizeExecutionHistoryRecord)
    .filter((record): record is ExecutionHistoryRecord => record !== undefined)
    .filter((record) => normalizedSessionId === undefined || record.sessionId === normalizedSessionId);
  return {
    ...snapshot,
    ...(normalizedSessionId === undefined ? {} : { historySessionId: normalizedSessionId }),
    history: normalizedHistory,
  };
}

export function normalizeExecutionCenterSnapshot(value: unknown): ExecutionCenterSnapshot {
  if (!isRecord(value)) return createExecutionCenterSnapshot();
  const rawSessions = Array.isArray(value.sessions) ? value.sessions : [];
  const inputs: ExecutionCenterInput[] = [];
  for (const raw of rawSessions.slice(0, MAX_EXECUTION_CENTER_SESSIONS)) {
    if (!isRecord(raw) || typeof raw.sessionId !== "string") continue;
    const tool = normalizeTool(raw.tool);
    const approvalPending = raw.approvalPending === true;
    inputs.push({
      sessionId: raw.sessionId,
      ...(typeof raw.title === "string" ? { title: raw.title } : {}),
      ...(typeof raw.lastActiveAt === "string" ? { lastActiveAt: raw.lastActiveAt } : {}),
      run: {
        status: normalizeStatus(raw.status),
        active: raw.active === true,
        sequence: safeInteger(raw.sequence, 0, MAX_EXECUTION_CENTER_SEQUENCE),
        ...(typeof raw.runId === "string" ? { runId: raw.runId } : {}),
        ...(typeof raw.startedAt === "string" ? { startedAt: raw.startedAt } : {}),
        ...(typeof raw.finishedAt === "string" ? { finishedAt: raw.finishedAt } : {}),
      },
      live: {
        ...(tool === undefined ? {} : { tool }),
        ...(approvalPending ? { approval: { id: "approval", tool: "approval" } } : {}),
      },
    });
  }
  const checkedAt = typeof value.checkedAt === "string" ? value.checkedAt : undefined;
  const snapshot = createExecutionCenterSnapshot(
    inputs,
    typeof value.currentSessionId === "string" ? value.currentSessionId : undefined,
    undefined,
    checkedAt,
  );
  const runtime = normalizeRuntimeValue(value.runtime);
  const withRuntime = runtime === undefined ? snapshot : { ...snapshot, runtime };
  return withExecutionHistory(
    withRuntime,
    typeof value.historySessionId === "string" ? value.historySessionId : undefined,
    Array.isArray(value.history) ? value.history : [],
  );
}

function normalizeInput(input: ExecutionCenterInput, nowValue: string): ExecutionCenterCard | undefined {
  const sessionId = normalizeId(input.sessionId, MAX_EXECUTION_CENTER_SESSION_ID_CHARS);
  if (!sessionId) return undefined;
  const status = normalizeStatus(input.run?.status);
  const active = input.run?.active === true && (status === "running" || status === "waiting");
  const startedAt = normalizeTimestamp(input.run?.startedAt);
  const finishedAt = normalizeTimestamp(input.run?.finishedAt);
  const lastActiveAt = normalizeTimestamp(input.lastActiveAt);
  const title = normalizeTitle(input.title, sessionId);
  const runId = normalizeId(input.run?.runId, MAX_EXECUTION_CENTER_SESSION_ID_CHARS);
  const sequence = safeInteger(input.run?.sequence, 0, MAX_EXECUTION_CENTER_SEQUENCE);
  const tool = normalizeTool(input.live?.tool);
  const approvalPending = input.live?.approval !== undefined || status === "waiting";
  const durationMs = durationBetween(startedAt, finishedAt ?? normalizeTimestamp(nowValue));
  return {
    sessionId,
    title,
    status,
    active,
    stage: deriveStage(status, active, tool !== undefined, approvalPending),
    sequence,
    ...(runId === undefined ? {} : { runId }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(lastActiveAt === undefined ? {} : { lastActiveAt }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(tool === undefined ? {} : { tool }),
    approvalPending,
  };
}

function normalizeStatus(value: unknown): DesktopRunStatus {
  return typeof value === "string" && statuses.includes(value as DesktopRunStatus)
    ? value as DesktopRunStatus
    : "idle";
}

function deriveStage(
  status: DesktopRunStatus,
  active: boolean,
  hasTool: boolean,
  approvalPending: boolean,
): ExecutionCenterStage {
  if (!active) {
    if (status === "done" || status === "failed" || status === "aborted") return status;
    return "idle";
  }
  if (approvalPending) return "approval";
  if (hasTool) return "tool";
  return "model";
}

function normalizeTool(value: unknown): ExecutionCenterTool | undefined {
  if (!isRecord(value)) return undefined;
  const name = normalizeId(value.name, MAX_EXECUTION_CENTER_TOOL_CHARS);
  if (!name) return undefined;
  const progress = safeNumber(value.progress, 0, Number.MAX_SAFE_INTEGER);
  const total = safeNumber(value.total, 0, Number.MAX_SAFE_INTEGER);
  return {
    name,
    ...(progress === undefined ? {} : { progress }),
    ...(total === undefined ? {} : { total }),
  };
}

function normalizeRuntime(value: DesktopStatusSnapshot | undefined): ExecutionCenterRuntime | undefined {
  if (!value) return undefined;
  return {
    executor: { mode: normalizeAllowed(value.executor?.mode, executorModes, "unknown") },
    runtime: {
      kind: "node",
      version: normalizeRuntimeToken(value.runtime?.version, 64) ?? "unknown",
      platform: normalizeRuntimeToken(value.runtime?.platform, 32) ?? "unknown",
    },
    approval: {
      mode: normalizeAllowed(value.approval?.mode, approvalModes, "unknown"),
      guarded: value.approval?.guarded === true,
    },
    validation: {
      policy: normalizeAllowed(value.validation?.policy, validationPolicies, "unknown"),
      enabled: value.validation?.enabled === true,
      lastResult: normalizeAllowed(value.validation?.lastResult, validationResults, "unknown"),
    },
  };
}

function normalizeRuntimeValue(value: unknown): ExecutionCenterRuntime | undefined {
  if (!isRecord(value)) return undefined;
  const executor = isRecord(value.executor) ? value.executor : undefined;
  const runtime = isRecord(value.runtime) ? value.runtime : undefined;
  const approval = isRecord(value.approval) ? value.approval : undefined;
  const validation = isRecord(value.validation) ? value.validation : undefined;
  if (!executor && !runtime && !approval && !validation) return undefined;
  return {
    executor: { mode: normalizeAllowed(executor?.mode, executorModes, "unknown") },
    runtime: {
      kind: "node",
      version: normalizeRuntimeToken(runtime?.version, 64) ?? "unknown",
      platform: normalizeRuntimeToken(runtime?.platform, 32) ?? "unknown",
    },
    approval: {
      mode: normalizeAllowed(approval?.mode, approvalModes, "unknown"),
      guarded: approval?.guarded === true,
    },
    validation: {
      policy: normalizeAllowed(validation?.policy, validationPolicies, "unknown"),
      enabled: validation?.enabled === true,
      lastResult: normalizeAllowed(validation?.lastResult, validationResults, "unknown"),
    },
  };
}

function normalizeAllowed<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function normalizeTitle(value: unknown, fallback: string): string {
  const normalized = normalizeBoundedText(value, MAX_EXECUTION_CENTER_TITLE_CHARS);
  return normalized ?? fallback;
}

function normalizeBoundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeId(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (!normalized || normalized.length > maxLength || normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    return undefined;
  }
  return normalized;
}

function normalizeSafeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function normalizeRuntimeToken(value: unknown, maxLength: number): string | undefined {
  const normalized = normalizeSafeText(value, maxLength);
  if (
    normalized === undefined
    || normalized.includes("/")
    || normalized.includes("\\")
    || /(?:api[-_ ]?key|access[-_ ]?token|password|secret|bearer|sk-[a-z0-9])/i.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function durationBetween(startedAt?: string, finishedAt?: string): number | undefined {
  if (!startedAt || !finishedAt) return undefined;
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return undefined;
  return Math.min(MAX_EXECUTION_CENTER_DURATION_MS, Math.max(0, finish - start));
}

function compareCards(left: ExecutionCenterCard, right: ExecutionCenterCard): number {
  if (left.active !== right.active) return left.active ? -1 : 1;
  const leftTime = Date.parse(left.startedAt ?? left.lastActiveAt ?? "") || 0;
  const rightTime = Date.parse(right.startedAt ?? right.lastActiveAt ?? "") || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return left.sessionId.localeCompare(right.sessionId);
}

function safeInteger(value: unknown, min: number, max: number): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(max, Math.max(min, value))
    : min;
}

function safeNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
