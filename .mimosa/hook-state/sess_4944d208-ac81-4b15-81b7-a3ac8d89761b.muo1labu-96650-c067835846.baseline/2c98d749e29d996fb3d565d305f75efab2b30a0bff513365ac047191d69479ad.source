import type {
  DesktopRunLiveState,
  DesktopRunStatus,
  DesktopRunSummary,
} from "./run-state.js";

export const PARALLEL_RUNS_SCHEMA_VERSION = 1 as const;
export const MAX_PARALLEL_RUNS = 256;
export const MAX_PARALLEL_RUN_SESSION_ID_CHARS = 96;
export const MAX_PARALLEL_RUN_ID_CHARS = 96;
export const MAX_PARALLEL_RUN_TOOL_CHARS = 128;
export const MAX_PARALLEL_RUN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export type ParallelRunStage = "idle" | "model" | "tool" | "approval" | "done" | "failed" | "aborted";

export interface ParallelRunInput {
  readonly sessionId: string;
  readonly run: DesktopRunSummary;
  readonly live?: DesktopRunLiveState;
}

export interface ParallelRunCard {
  readonly sessionId: string;
  readonly status: DesktopRunStatus;
  readonly active: boolean;
  readonly stage: ParallelRunStage;
  readonly sequence: number;
  readonly runId?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly tool?: {
    readonly name: string;
    readonly progress?: number;
    readonly total?: number;
  };
  readonly approvalPending: boolean;
}

export interface ParallelRunsSnapshot {
  readonly schemaVersion: typeof PARALLEL_RUNS_SCHEMA_VERSION;
  readonly metadataOnly: true;
  readonly checkedAt: string;
  readonly total: number;
  readonly active: number;
  readonly running: number;
  readonly waiting: number;
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
  readonly runs: readonly ParallelRunCard[];
}

const statuses: readonly DesktopRunStatus[] = ["idle", "running", "waiting", "done", "failed", "aborted"];
const stages: readonly ParallelRunStage[] = ["idle", "model", "tool", "approval", "done", "failed", "aborted"];

export function createParallelRunsSnapshot(
  inputs: readonly ParallelRunInput[] = [],
  checkedAt = new Date().toISOString(),
): ParallelRunsSnapshot {
  const normalized = inputs
    .slice(0, MAX_PARALLEL_RUNS)
    .map((input) => normalizeCard(input, checkedAt))
    .filter((card): card is ParallelRunCard => card !== undefined);
  normalized.sort(compareCards);
  const active = normalized.filter((run) => run.active).length;
  const running = normalized.filter((run) => run.status === "running").length;
  const waiting = normalized.filter((run) => run.status === "waiting").length;
  const completed = normalized.filter((run) => run.status === "done").length;
  const failed = normalized.filter((run) => run.status === "failed").length;
  const aborted = normalized.filter((run) => run.status === "aborted").length;
  return {
    schemaVersion: PARALLEL_RUNS_SCHEMA_VERSION,
    metadataOnly: true,
    checkedAt: normalizeTimestamp(checkedAt) ?? new Date().toISOString(),
    total: normalized.length,
    active,
    running,
    waiting,
    completed,
    failed,
    aborted,
    runs: normalized,
  };
}

export function normalizeParallelRunsSnapshot(value: unknown): ParallelRunsSnapshot {
  if (!isRecord(value)) return createParallelRunsSnapshot();
  const rawRuns = Array.isArray(value.runs) ? value.runs : [];
  const runs: ParallelRunCard[] = [];
  const seen = new Set<string>();
  for (const raw of rawRuns.slice(0, MAX_PARALLEL_RUNS)) {
    if (!isRecord(raw) || typeof raw.sessionId !== "string" || seen.has(raw.sessionId)) continue;
    const rawTool = normalizeTool(raw.tool);
    const card = normalizeCard({
      sessionId: raw.sessionId,
      run: {
        status: normalizeStatus(raw.status),
        active: raw.active === true,
        sequence: safeInteger(raw.sequence, 0, 10_000_000),
        ...(typeof raw.runId === "string" ? { runId: raw.runId } : {}),
        ...(typeof raw.startedAt === "string" ? { startedAt: raw.startedAt } : {}),
        ...(typeof raw.finishedAt === "string" ? { finishedAt: raw.finishedAt } : {}),
      },
      live: {
        ...(rawTool === undefined ? {} : { tool: rawTool }),
        ...(raw.approvalPending === true ? { approval: { id: "approval", tool: "approval" } } : {}),
      },
    }, typeof value.checkedAt === "string" ? value.checkedAt : new Date().toISOString());
    if (!card) continue;
    seen.add(card.sessionId);
    runs.push(card);
  }
  return createParallelRunsSnapshot(runs.map((run) => ({
    sessionId: run.sessionId,
    run,
    live: {
      ...(run.tool === undefined ? {} : { tool: run.tool }),
      ...(run.approvalPending ? { approval: { id: "approval", tool: "approval" } } : {}),
    },
  })), typeof value.checkedAt === "string" ? value.checkedAt : undefined);
}

function normalizeCard(input: ParallelRunInput, nowValue: string): ParallelRunCard | undefined {
  const sessionId = normalizeId(input.sessionId, MAX_PARALLEL_RUN_SESSION_ID_CHARS);
  if (!sessionId) return undefined;
  const status = normalizeStatus(input.run?.status);
  const active = input.run?.active === true && (status === "running" || status === "waiting");
  const startedAt = normalizeTimestamp(input.run?.startedAt);
  const finishedAt = normalizeTimestamp(input.run?.finishedAt);
  const durationMs = durationBetween(startedAt, finishedAt ?? normalizeTimestamp(nowValue));
  const runId = normalizeId(input.run?.runId, MAX_PARALLEL_RUN_ID_CHARS);
  const sequence = safeInteger(input.run?.sequence, 0, 10_000_000);
  const tool = normalizeTool(input.live?.tool);
  const approvalPending = input.live?.approval !== undefined || status === "waiting";
  const stage = deriveStage(status, active, tool !== undefined, approvalPending);
  return {
    sessionId,
    status,
    active,
    stage,
    sequence,
    ...(runId === undefined ? {} : { runId }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
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
): ParallelRunStage {
  if (!active) {
    if (status === "done" || status === "failed" || status === "aborted") return status;
    return "idle";
  }
  if (approvalPending) return "approval";
  if (hasTool) return "tool";
  return "model";
}

function normalizeTool(value: unknown): ParallelRunCard["tool"] | undefined {
  if (!isRecord(value)) return undefined;
  const name = normalizeId(value.name, MAX_PARALLEL_RUN_TOOL_CHARS);
  if (!name) return undefined;
  const progress = safeNumber(value.progress, 0, Number.MAX_SAFE_INTEGER);
  const total = safeNumber(value.total, 0, Number.MAX_SAFE_INTEGER);
  return {
    name,
    ...(progress === undefined ? {} : { progress }),
    ...(total === undefined ? {} : { total }),
  };
}

function compareCards(left: ParallelRunCard, right: ParallelRunCard): number {
  if (left.active !== right.active) return left.active ? -1 : 1;
  const leftTime = Date.parse(left.startedAt ?? "") || 0;
  const rightTime = Date.parse(right.startedAt ?? "") || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return left.sessionId.localeCompare(right.sessionId);
}

function durationBetween(startedAt?: string, finishedAt?: string): number | undefined {
  if (!startedAt || !finishedAt) return undefined;
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return undefined;
  return Math.min(MAX_PARALLEL_RUN_DURATION_MS, Math.max(0, finish - start));
}

function normalizeId(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (!normalized || normalized.length > maxLength || normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    return undefined;
  }
  return normalized;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function safeInteger(value: unknown, min: number, max: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value)) : min;
}

function safeNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
