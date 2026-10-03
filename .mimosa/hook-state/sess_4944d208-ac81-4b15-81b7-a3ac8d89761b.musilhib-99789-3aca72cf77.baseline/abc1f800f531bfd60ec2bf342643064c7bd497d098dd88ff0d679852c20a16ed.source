import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const EXECUTION_HISTORY_SCHEMA_VERSION = 1 as const;
export const MAX_EXECUTION_HISTORY_PER_SESSION = 50;
export const MAX_EXECUTION_HISTORY_SESSIONS = 256;
export const MAX_EXECUTION_HISTORY_BYTES = 1024 * 1024;
export const MAX_EXECUTION_HISTORY_ID_CHARS = 96;
export const MAX_EXECUTION_HISTORY_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_EXECUTION_HISTORY_COUNTER = 1_000_000;

export type ExecutionHistoryStatus = "done" | "failed" | "aborted";
export type ExecutionHistoryValidationStatus = "passed" | "failed" | "skipped" | "blocked";

export interface ExecutionHistoryRecord {
  readonly schemaVersion: typeof EXECUTION_HISTORY_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly runId: string;
  readonly status: ExecutionHistoryStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly sequence: number;
  readonly toolCount: number;
  readonly approvalCount: number;
  readonly validationCount: number;
  readonly validationId?: string;
  readonly changeSetId?: string;
  readonly validationStatus?: ExecutionHistoryValidationStatus;
}

interface StoredExecutionHistoryState {
  readonly version: typeof EXECUTION_HISTORY_SCHEMA_VERSION;
  readonly histories: Readonly<Record<string, readonly ExecutionHistoryRecord[]>>;
}

export interface ExecutionHistoryStoreOptions {
  readonly stateFile?: string;
}

export class ExecutionHistoryStore {
  private readonly stateFile?: string;
  private readonly histories = new Map<string, ExecutionHistoryRecord[]>();
  private writeChain: Promise<boolean> = Promise.resolve(true);

  constructor(options: ExecutionHistoryStoreOptions) {
    this.stateFile = options.stateFile;
    this.load();
  }

  list(sessionId: string): readonly ExecutionHistoryRecord[] {
    return [...(this.histories.get(sessionId) ?? [])];
  }

  clear(sessionId: string): Promise<boolean> {
    const next = this.cloneHistories();
    next.delete(sessionId);
    return this.commit(next);
  }

  move(from: string, to: string): Promise<boolean> {
    if (from === to) return Promise.resolve(true);
    const next = this.cloneHistories();
    const source = next.get(from);
    if (!source) return Promise.resolve(true);
    const target = next.get(to) ?? [];
    next.set(to, [...source, ...target]
      .filter((record, index, records) => records.findIndex((candidate) => candidate.runId === record.runId) === index)
      .slice(0, MAX_EXECUTION_HISTORY_PER_SESSION));
    next.delete(from);
    return this.commit(next);
  }

  record(value: unknown): Promise<boolean> {
    const record = normalizeExecutionHistoryRecord(value);
    if (!record) return Promise.resolve(false);

    const next = this.cloneHistories();
    const records = [
      record,
      ...(next.get(record.sessionId) ?? []).filter((candidate) => candidate.runId !== record.runId),
    ].slice(0, MAX_EXECUTION_HISTORY_PER_SESSION);
    next.set(record.sessionId, records);
    return this.commit(next);
  }

  private cloneHistories(): Map<string, ExecutionHistoryRecord[]> {
    const next = new Map<string, ExecutionHistoryRecord[]>();
    for (const [sessionId, records] of this.histories) {
      next.set(sessionId, [...records]);
    }
    return next;
  }

  private commit(next: Map<string, ExecutionHistoryRecord[]>): Promise<boolean> {
    pruneHistories(next);
    const payload = serializeHistories(next);
    if (Buffer.byteLength(payload, "utf8") > MAX_EXECUTION_HISTORY_BYTES) return Promise.resolve(false);
    this.histories.clear();
    for (const [sessionId, records] of next) {
      this.histories.set(sessionId, [...records]);
    }
    const operation = this.writeChain.then(() => persistPayload(this.stateFile, payload));
    this.writeChain = operation.catch(() => false);
    return operation;
  }

  private load(): void {
    if (!this.stateFile) return;
    let raw: string;
    try {
      raw = readFileSync(this.stateFile, "utf8");
    } catch {
      return;
    }
    if (!raw || Buffer.byteLength(raw, "utf8") > MAX_EXECUTION_HISTORY_BYTES) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(parsed) || parsed.version !== EXECUTION_HISTORY_SCHEMA_VERSION || !isRecord(parsed.histories)) {
      return;
    }

    const entries = Object.entries(parsed.histories)
      .map(([sessionId, records]) => {
        const normalizedSessionId = normalizeId(sessionId);
        if (!normalizedSessionId || !Array.isArray(records)) return undefined;
        const normalized = records
          .slice(0, MAX_EXECUTION_HISTORY_PER_SESSION)
          .map(normalizeExecutionHistoryRecord)
          .filter((record): record is ExecutionHistoryRecord => record !== undefined)
          .filter((record) => record.sessionId === normalizedSessionId);
        return normalized.length === 0 ? undefined : [normalizedSessionId, normalized] as const;
      })
      .filter((entry): entry is readonly [string, ExecutionHistoryRecord[]] => entry !== undefined)
      .sort((left, right) => Date.parse(right[1][0]?.finishedAt ?? "") - Date.parse(left[1][0]?.finishedAt ?? ""))
      .slice(0, MAX_EXECUTION_HISTORY_SESSIONS);

    for (const [sessionId, records] of entries) {
      this.histories.set(sessionId, records);
    }
    pruneHistories(this.histories);
  }
}

export function normalizeExecutionHistoryRecord(value: unknown): ExecutionHistoryRecord | undefined {
  if (!isRecord(value)) return undefined;
  const sessionId = normalizeId(value.sessionId);
  const runId = normalizeId(value.runId);
  const status = value.status === "done" || value.status === "failed" || value.status === "aborted"
    ? value.status
    : undefined;
  const startedAt = normalizeTimestamp(value.startedAt);
  const finishedAt = normalizeTimestamp(value.finishedAt);
  if (!sessionId || !runId || !status || !startedAt || !finishedAt) return undefined;
  return {
    schemaVersion: EXECUTION_HISTORY_SCHEMA_VERSION,
    sessionId,
    runId,
    status,
    startedAt,
    finishedAt,
    durationMs: clampNumber(value.durationMs, 0, MAX_EXECUTION_HISTORY_DURATION_MS),
    sequence: clampInteger(value.sequence, 0, 10_000_000),
    toolCount: clampInteger(value.toolCount, 0, MAX_EXECUTION_HISTORY_COUNTER),
    approvalCount: clampInteger(value.approvalCount, 0, MAX_EXECUTION_HISTORY_COUNTER),
    validationCount: clampInteger(value.validationCount, 0, MAX_EXECUTION_HISTORY_COUNTER),
    ...(normalizeId(value.validationId) === undefined ? {} : { validationId: normalizeId(value.validationId) }),
    ...(normalizeId(value.changeSetId) === undefined ? {} : { changeSetId: normalizeId(value.changeSetId) }),
    ...(isExecutionHistoryValidationStatus(value.validationStatus)
      ? { validationStatus: value.validationStatus }
      : {}),
  };
}

export function normalizeExecutionHistoryId(value: unknown): string | undefined {
  return normalizeId(value);
}

function isExecutionHistoryValidationStatus(value: unknown): value is ExecutionHistoryValidationStatus {
  return value === "passed" || value === "failed" || value === "skipped" || value === "blocked";
}

function pruneHistories(histories: Map<string, ExecutionHistoryRecord[]>): void {
  const entries = [...histories.entries()]
    .sort((left, right) => Date.parse(right[1][0]?.finishedAt ?? "") - Date.parse(left[1][0]?.finishedAt ?? ""));
  histories.clear();
  for (const [sessionId, records] of entries.slice(0, MAX_EXECUTION_HISTORY_SESSIONS)) {
    histories.set(sessionId, records.slice(0, MAX_EXECUTION_HISTORY_PER_SESSION));
  }

  while (Buffer.byteLength(serializeHistories(histories), "utf8") > MAX_EXECUTION_HISTORY_BYTES) {
    let oldestSessionId: string | undefined;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [sessionId, records] of histories) {
      const candidate = records.at(-1);
      const time = Date.parse(candidate?.finishedAt ?? "") || 0;
      if (candidate && time < oldestTime) {
        oldestTime = time;
        oldestSessionId = sessionId;
      }
    }
    if (!oldestSessionId) break;
    const records = histories.get(oldestSessionId) ?? [];
    records.pop();
    if (records.length === 0) histories.delete(oldestSessionId);
  }
}

function serializeHistories(histories: Map<string, ExecutionHistoryRecord[]>): string {
  const state: StoredExecutionHistoryState = {
    version: EXECUTION_HISTORY_SCHEMA_VERSION,
    histories: Object.fromEntries(histories),
  };
  return JSON.stringify(state);
}

async function persistPayload(stateFile: string | undefined, payload: string): Promise<boolean> {
  if (!stateFile) return true;
  let temporary: string | undefined;
  try {
    await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
    temporary = stateFile + "." + randomBytes(6).toString("hex") + ".tmp";
    await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, stateFile);
    return true;
  } catch {
    if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
    return false;
  }
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (
    !normalized
    || normalized.length > MAX_EXECUTION_HISTORY_ID_CHARS
    || normalized.includes("/")
    || normalized.includes("\\")
    || normalized.includes("..")
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

function clampInteger(value: unknown, min: number, max: number): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(max, Math.max(min, value))
    : min;
}

function clampNumber(value: unknown, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : min;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
