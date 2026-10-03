import type { CiDiagnosisSnapshot } from "./github-ci-diagnosis.js";

export type RepairVerificationState = "passed" | "failed" | "pending" | "unknown";

export interface RepairVerificationRow {
  readonly key: string;
  readonly workflow: string;
  readonly name: string;
  readonly before: RepairVerificationState;
  readonly after: RepairVerificationState;
}

export interface RepairVerification {
  /** repaired: every failing check now passes and no new failure appeared. improved: some but not all resolved. unresolved: failures remain or new ones appeared. inconclusive: stale or uncomparable evidence. */
  readonly verdict: "repaired" | "improved" | "unresolved" | "inconclusive";
  readonly stale: boolean;
  readonly beforeHeadSha: string;
  readonly afterHeadSha: string;
  readonly before: { readonly failed: number; readonly total: number };
  readonly after: { readonly failed: number; readonly total: number };
  readonly rows: readonly RepairVerificationRow[];
}

const KEY_LIMIT = 200;
const ROWS_LIMIT = 64;

function clean(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ").slice(0, limit) : "";
}

function checkKey(workflow: unknown, name: unknown): string {
  return `${clean(workflow, 160).trim().toLowerCase()}/${clean(name, 160).trim().toLowerCase()}`;
}

function failedCount(snapshot: CiDiagnosisSnapshot): number {
  return snapshot.checks.filter((check) => check.state === "failed").length;
}

/**
 * Pure before/after comparison for the repair loop. `before` is the failing
 * diagnosis bound to the repaired head; `after` is a fresh read-only diagnosis
 * of the PR's current head. Stale or check-less evidence stays inconclusive.
 */
export function compareCiDiagnosis(before: CiDiagnosisSnapshot, after: CiDiagnosisSnapshot): RepairVerification {
  const beforeByKey = new Map<string, RepairVerificationState>();
  const beforeRowsByKey = new Map<string, { workflow: string; name: string }>();
  for (const check of before.checks.slice(0, ROWS_LIMIT)) {
    const key = checkKey(check.workflow, check.name);
    beforeByKey.set(key, check.state);
    beforeRowsByKey.set(key, { workflow: clean(check.workflow, 160), name: clean(check.name, 160) });
  }
  const rows: RepairVerificationRow[] = [];
  const afterByKey = new Map<string, RepairVerificationState>();
  for (const check of after.checks.slice(0, ROWS_LIMIT)) {
    const key = checkKey(check.workflow, check.name);
    afterByKey.set(key, check.state);
    rows.push({
      key,
      workflow: clean(check.workflow, 160),
      name: clean(check.name, 160),
      before: beforeByKey.get(key) ?? "unknown",
      after: check.state,
    });
  }
  for (const check of before.checks.slice(0, ROWS_LIMIT)) {
    const key = checkKey(check.workflow, check.name);
    if (afterByKey.has(key)) continue;
    rows.push({
      key,
      workflow: clean(check.workflow, 160),
      name: clean(check.name, 160),
      before: beforeByKey.get(key) ?? "unknown",
      after: "unknown",
    });
  }
  const beforeFailedKeys = new Set([...beforeByKey.entries()].filter(([, state]) => state === "failed").map(([key]) => key));
  let resolved = 0;
  let stillFailing = 0;
  let unknownOutcome = 0;
  for (const key of beforeFailedKeys) {
    const outcome = afterByKey.get(key);
    if (outcome === "passed") resolved += 1;
    else if (outcome === "failed") stillFailing += 1;
    else unknownOutcome += 1;
  }
  const newFailures = [...afterByKey.entries()]
    .filter(([key, state]) => state === "failed" && !beforeFailedKeys.has(key)).length;
  let verdict: RepairVerification["verdict"];
  if (after.stale || beforeFailedKeys.size === 0) verdict = "inconclusive";
  else if (stillFailing > 0) verdict = resolved > 0 ? "improved" : "unresolved";
  else if (unknownOutcome > 0) verdict = "inconclusive";
  else if (newFailures > 0) verdict = "unresolved";
  else verdict = "repaired";
  return {
    verdict,
    stale: after.stale === true,
    beforeHeadSha: before.headSha,
    afterHeadSha: after.headSha,
    before: { failed: failedCount(before), total: before.checks.length },
    after: { failed: failedCount(after), total: after.checks.length },
    rows: rows.slice(0, ROWS_LIMIT),
  };
}

export function normalizeRepairVerification(value: unknown): RepairVerification | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const verdict = candidate.verdict;
  const beforeHeadSha = candidate.beforeHeadSha;
  const afterHeadSha = candidate.afterHeadSha;
  const before = candidate.before;
  const after = candidate.after;
  const rows = candidate.rows;
  if (typeof verdict !== "string" || !["repaired", "improved", "unresolved", "inconclusive"].includes(verdict)
    || typeof beforeHeadSha !== "string" || typeof afterHeadSha !== "string"
    || typeof before !== "object" || before === null || typeof after !== "object" || after === null
    || !Array.isArray(rows) || rows.length > ROWS_LIMIT) return undefined;
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const count = (input: Record<string, unknown>): number | undefined =>
    typeof input.failed === "number" && Number.isSafeInteger(input.failed) && input.failed >= 0
    && typeof input.total === "number" && Number.isSafeInteger(input.total) && input.total >= 0 && input.failed <= input.total
      ? input.failed : undefined;
  const beforeFailed = count(beforeRecord);
  const afterFailed = count(afterRecord);
  if (beforeFailed === undefined || afterFailed === undefined) return undefined;
  const normalizedRows: RepairVerificationRow[] = [];
  for (const row of rows.slice(0, ROWS_LIMIT)) {
    if (typeof row !== "object" || row === null) return undefined;
    const record = row as Record<string, unknown>;
    const states = ["passed", "failed", "pending", "unknown"];
    if (typeof record.key !== "string" || record.key.length > KEY_LIMIT
      || typeof record.workflow !== "string" || typeof record.name !== "string"
      || typeof record.before !== "string" || !states.includes(record.before)
      || typeof record.after !== "string" || !states.includes(record.after)) return undefined;
    normalizedRows.push({
      key: record.key, workflow: clean(record.workflow, 160), name: clean(record.name, 160),
      before: record.before as RepairVerificationState, after: record.after as RepairVerificationState,
    });
  }
  return {
    verdict: verdict as RepairVerification["verdict"],
    stale: candidate.stale === true,
    beforeHeadSha: clean(beforeHeadSha, 64),
    afterHeadSha: clean(afterHeadSha, 64),
    before: { failed: beforeFailed, total: Number(beforeRecord.total) },
    after: { failed: afterFailed, total: Number(afterRecord.total) },
    rows: normalizedRows,
  };
}
