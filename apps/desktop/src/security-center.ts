import {
  MAX_SECURITY_AUDIT_VISIBLE,
  normalizeSecurityAuditRecord,
  SECURITY_AUDIT_HISTORY_SCHEMA_VERSION,
  type SecurityAuditRecord,
} from "@dev-agent/agent-core";

export const SECURITY_CENTER_SCHEMA_VERSION = 1 as const;
export const MAX_SECURITY_CENTER_RESPONSE_BYTES = 256 * 1024;
export const MAX_SECURITY_CENTER_HISTORY = MAX_SECURITY_AUDIT_VISIBLE;

export interface SecurityCenterSnapshot {
  readonly schemaVersion: typeof SECURITY_CENTER_SCHEMA_VERSION;
  readonly metadataOnly: true;
  readonly generatedAt: string;
  readonly lastScan?: SecurityAuditRecord;
  readonly history: readonly SecurityAuditRecord[];
}

export interface SecurityCenterSnapshotInput {
  readonly generatedAt?: string;
  readonly history?: readonly unknown[];
}

/**
 * Builds the bounded, metadata-only Security Center snapshot. History records
 * carry aggregate counters only; finding locations, summaries, commands,
 * environment values, and paths never enter this payload.
 */
export function createSecurityCenterSnapshot(input: SecurityCenterSnapshotInput = {}): SecurityCenterSnapshot {
  const history = normalizeHistory(input.history);
  return {
    schemaVersion: SECURITY_CENTER_SCHEMA_VERSION,
    metadataOnly: true,
    generatedAt: normalizeTimestamp(input.generatedAt) ?? new Date().toISOString(),
    ...(history[0] === undefined ? {} : { lastScan: history[0] }),
    history,
  };
}

/** Fail-closed rebuild from untrusted data; drops everything not allowlisted. */
export function normalizeSecurityCenterSnapshot(value: unknown): SecurityCenterSnapshot | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== SECURITY_CENTER_SCHEMA_VERSION || raw.metadataOnly !== true) return undefined;
  return createSecurityCenterSnapshot({
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : undefined,
    history: Array.isArray(raw.history) ? raw.history : [],
  });
}

export { SECURITY_AUDIT_HISTORY_SCHEMA_VERSION };

function normalizeHistory(records: readonly unknown[] | undefined): readonly SecurityAuditRecord[] {
  if (!records) return [];
  const seen = new Set<string>();
  const normalized: SecurityAuditRecord[] = [];
  for (const value of records.slice(0, MAX_SECURITY_CENTER_HISTORY)) {
    const record = normalizeSecurityAuditRecord(value);
    if (!record || seen.has(record.scanId)) continue;
    seen.add(record.scanId);
    normalized.push(record);
  }
  return normalized;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
