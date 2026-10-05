import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SecurityFindingCategory, SecurityFindingSeverity, SecurityScanResult } from "./security-center.js";

export const SECURITY_AUDIT_HISTORY_SCHEMA_VERSION = 1 as const;
export const MAX_SECURITY_AUDIT_RECORDS = 50;
export const MAX_SECURITY_AUDIT_BYTES = 256 * 1024;
export const MAX_SECURITY_AUDIT_VISIBLE = 20;
export const MAX_SECURITY_AUDIT_SCAN_ID_CHARS = 64;
export const MAX_SECURITY_AUDIT_COUNTER = 1_000_000;
export const MAX_SECURITY_AUDIT_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export type SecurityAuditStatus = "clean" | "findings" | "partial" | "error";

export interface SecurityAuditRecord {
  readonly schemaVersion: typeof SECURITY_AUDIT_HISTORY_SCHEMA_VERSION;
  readonly scanId: string;
  readonly status: SecurityAuditStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly filesScanned: number;
  readonly bytesScanned: number;
  readonly skippedEntries: number;
  readonly findingCount: number;
  readonly severityCounts: Readonly<Record<SecurityFindingSeverity, number>>;
  readonly categoryCounts: Readonly<Record<SecurityFindingCategory, number>>;
}

export interface SecurityAuditRecordOptions {
  readonly scanId?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

const SECURITY_AUDIT_STATUSES: readonly SecurityAuditStatus[] = ["clean", "findings", "partial", "error"];
const SECURITY_AUDIT_SEVERITIES: readonly SecurityFindingSeverity[] = ["high", "medium", "low"];
const SECURITY_AUDIT_CATEGORIES: readonly SecurityFindingCategory[] = ["secret", "sensitive-file", "mcp", "workspace-boundary"];

/**
 * Projects a transient scan result into a metadata-only audit record.
 * Finding locations and summaries are counted and then discarded; they are
 * never copied into the record, so persisted audit history stays free of
 * secrets, paths, commands, and scan content.
 */
export function createSecurityAuditRecord(
  result: SecurityScanResult,
  options: SecurityAuditRecordOptions = {},
): SecurityAuditRecord {
  const finishedAt = normalizeTimestamp(options.finishedAt) ?? new Date().toISOString();
  const startedAt = normalizeTimestamp(options.startedAt) ?? finishedAt;
  const severityCounts = countBy(result.findings, (finding) => finding.severity, SECURITY_AUDIT_SEVERITIES);
  const categoryCounts = countBy(result.findings, (finding) => finding.category, SECURITY_AUDIT_CATEGORIES);
  return {
    schemaVersion: SECURITY_AUDIT_HISTORY_SCHEMA_VERSION,
    scanId: normalizeScanId(options.scanId) ?? randomUUID(),
    status: isAuditStatus(result.status) ? result.status : "error",
    startedAt,
    finishedAt,
    durationMs: clampNumber(Date.parse(finishedAt) - Date.parse(startedAt), 0, MAX_SECURITY_AUDIT_DURATION_MS),
    filesScanned: clampInteger(result.filesScanned, 0, MAX_SECURITY_AUDIT_COUNTER),
    bytesScanned: clampInteger(result.bytesScanned, 0, MAX_SECURITY_AUDIT_COUNTER),
    skippedEntries: clampInteger(result.skippedEntries, 0, MAX_SECURITY_AUDIT_COUNTER),
    findingCount: clampInteger(result.findings.length, 0, MAX_SECURITY_AUDIT_COUNTER),
    severityCounts,
    categoryCounts,
  };
}

/**
 * Records a failed scan as a fixed "error" status with zeroed counters.
 * Deliberately accepts no error text: exception messages never enter audit history.
 */
export function createSecurityAuditErrorRecord(options: SecurityAuditRecordOptions = {}): SecurityAuditRecord {
  const finishedAt = normalizeTimestamp(options.finishedAt) ?? new Date().toISOString();
  const startedAt = normalizeTimestamp(options.startedAt) ?? finishedAt;
  return {
    schemaVersion: SECURITY_AUDIT_HISTORY_SCHEMA_VERSION,
    scanId: normalizeScanId(options.scanId) ?? randomUUID(),
    status: "error",
    startedAt,
    finishedAt,
    durationMs: clampNumber(Date.parse(finishedAt) - Date.parse(startedAt), 0, MAX_SECURITY_AUDIT_DURATION_MS),
    filesScanned: 0,
    bytesScanned: 0,
    skippedEntries: 0,
    findingCount: 0,
    severityCounts: { high: 0, medium: 0, low: 0 },
    categoryCounts: { secret: 0, "sensitive-file": 0, mcp: 0, "workspace-boundary": 0 },
  };
}

let activeHistoryStore: SecurityAuditHistoryStore | undefined;

/**
 * Registers the audit history store for the running interactive session. The
 * CLI hosts one interactive session per process, and command handlers use this
 * accessor as a fallback when the UI option was not injected explicitly.
 */
export function activateSecurityAuditHistory(store: SecurityAuditHistoryStore): void {
  activeHistoryStore = store;
}

export function activeSecurityAuditHistory(): SecurityAuditHistoryStore | undefined {
  return activeHistoryStore;
}

export class SecurityAuditHistoryStore {
  private readonly stateFile: string | undefined;
  private records: SecurityAuditRecord[] = [];
  private writeChain: Promise<boolean> = Promise.resolve(true);  constructor(options: { stateFile?: string }) {
    this.stateFile = options.stateFile;
    this.load();
  }

  list(): readonly SecurityAuditRecord[] {
    return [...this.records];
  }

  record(value: unknown): Promise<boolean> {
    const record = normalizeSecurityAuditRecord(value);
    if (!record) return Promise.resolve(false);
    const next = [record, ...this.records.filter((candidate) => candidate.scanId !== record.scanId)]
      .slice(0, MAX_SECURITY_AUDIT_RECORDS);
    return this.commit(next);
  }

  private commit(next: SecurityAuditRecord[]): Promise<boolean> {
    const payload = serializeRecords(next);
    if (Buffer.byteLength(payload, "utf8") > MAX_SECURITY_AUDIT_BYTES) return Promise.resolve(false);
    this.records = next;
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
    if (!raw || Buffer.byteLength(raw, "utf8") > MAX_SECURITY_AUDIT_BYTES) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
      || (parsed as Record<string, unknown>).version !== SECURITY_AUDIT_HISTORY_SCHEMA_VERSION
    ) {
      return;
    }
    const records = (parsed as Record<string, unknown>).records;
    if (!Array.isArray(records)) return;
    const seen = new Set<string>();
    const loaded: SecurityAuditRecord[] = [];
    for (const value of records.slice(0, MAX_SECURITY_AUDIT_RECORDS)) {
      const record = normalizeSecurityAuditRecord(value);
      if (!record || seen.has(record.scanId)) continue;
      seen.add(record.scanId);
      loaded.push(record);
    }
    this.records = loaded.slice(0, MAX_SECURITY_AUDIT_RECORDS);
  }
}

export function normalizeSecurityAuditRecord(value: unknown): SecurityAuditRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const scanId = normalizeScanId(raw.scanId);
  const startedAt = normalizeTimestamp(raw.startedAt);
  const finishedAt = normalizeTimestamp(raw.finishedAt);
  if (!scanId || !startedAt || !finishedAt) return undefined;
  const status = isAuditStatus(raw.status) ? raw.status : undefined;
  if (!status) return undefined;
  return {
    schemaVersion: SECURITY_AUDIT_HISTORY_SCHEMA_VERSION,
    scanId,
    status,
    startedAt,
    finishedAt,
    durationMs: clampNumber(raw.durationMs, 0, MAX_SECURITY_AUDIT_DURATION_MS),
    filesScanned: clampInteger(raw.filesScanned, 0, MAX_SECURITY_AUDIT_COUNTER),
    bytesScanned: clampInteger(raw.bytesScanned, 0, MAX_SECURITY_AUDIT_COUNTER),
    skippedEntries: clampInteger(raw.skippedEntries, 0, MAX_SECURITY_AUDIT_COUNTER),
    findingCount: clampInteger(raw.findingCount, 0, MAX_SECURITY_AUDIT_COUNTER),
    severityCounts: normalizeCounts(raw.severityCounts, SECURITY_AUDIT_SEVERITIES),
    categoryCounts: normalizeCounts(raw.categoryCounts, SECURITY_AUDIT_CATEGORIES),
  };
}

export function formatSecurityAuditHistory(records: readonly SecurityAuditRecord[]): string {
  if (records.length === 0) {
    return "No recorded security audit history yet. Run :security scan to create the first metadata-only entry.";
  }
  const lines = [
    `Security audit history · ${records.length} record(s) · metadata-only (no finding content, paths, or commands are stored)`,
  ];
  for (const [index, record] of records.entries()) {
    lines.push(
      `${index + 1}. ${record.scanId} · ${record.status} · ${record.startedAt} · ${record.durationMs}ms · `
      + `files ${record.filesScanned} · bytes ${record.bytesScanned} · skipped ${record.skippedEntries} · `
      + `findings ${record.findingCount} (high ${record.severityCounts.high} / medium ${record.severityCounts.medium} / low ${record.severityCounts.low}; `
      + `secret ${record.categoryCounts.secret}, sensitive-file ${record.categoryCounts["sensitive-file"]}, `
      + `mcp ${record.categoryCounts.mcp}, workspace-boundary ${record.categoryCounts["workspace-boundary"]})`,
    );
  }
  return lines.join("\n");
}

function countBy<T, K extends string>(
  values: readonly T[],
  key: (value: T) => K,
  allowed: readonly K[],
): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const name of allowed) counts[name] = 0;
  for (const value of values) {
    const name = key(value);
    if (counts[name] === undefined) continue;
    counts[name] = clampInteger(counts[name] + 1, 0, MAX_SECURITY_AUDIT_COUNTER);
  }
  return counts;
}

function normalizeCounts<K extends string>(value: unknown, allowed: readonly K[]): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const name of allowed) counts[name] = 0;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return counts;
  const raw = value as Record<string, unknown>;
  for (const name of allowed) counts[name] = clampInteger(raw[name], 0, MAX_SECURITY_AUDIT_COUNTER);
  return counts;
}

function isAuditStatus(value: unknown): value is SecurityAuditStatus {
  return SECURITY_AUDIT_STATUSES.includes(value as SecurityAuditStatus);
}

function normalizeScanId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (
    !normalized
    || normalized.length > MAX_SECURITY_AUDIT_SCAN_ID_CHARS
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

function serializeRecords(records: readonly SecurityAuditRecord[]): string {
  return JSON.stringify({ version: SECURITY_AUDIT_HISTORY_SCHEMA_VERSION, records });
}

async function persistPayload(stateFile: string | undefined, payload: string): Promise<boolean> {
  if (!stateFile) return true;
  let temporary: string | undefined;
  try {
    await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
    temporary = `${stateFile}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, stateFile);
    return true;
  } catch {
    if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
    return false;
  }
}
