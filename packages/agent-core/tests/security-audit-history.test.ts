import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createSecurityAuditErrorRecord,
  createSecurityAuditRecord,
  formatSecurityAuditHistory,
  MAX_SECURITY_AUDIT_BYTES,
  MAX_SECURITY_AUDIT_COUNTER,
  MAX_SECURITY_AUDIT_RECORDS,
  SecurityAuditHistoryStore,
  type SecurityAuditRecord,
} from "../dist/security-audit-history.js";
import type { SecurityScanResult } from "../dist/security-scan.js";

function sampleResult(overrides: Partial<SecurityScanResult> = {}): SecurityScanResult {
  return {
    status: "findings",
    findings: [
      { severity: "high", category: "secret", location: ".env", summary: "Secret-like material detected; OPENAI_API_KEY=super-secret-value" },
      { severity: "high", category: "secret", location: "notes.txt", summary: "Bearer super-secret-value in tracked file" },
      { severity: "medium", category: "sensitive-file", location: ".env", summary: "Sensitive-looking file should be excluded." },
      { severity: "medium", category: "mcp", location: "mcp[0]", summary: "MCP entry invokes a shell; args -c echo $TOKEN" },
    ],
    filesScanned: 42,
    bytesScanned: 2048,
    skippedEntries: 3,
    ...overrides,
  };
}

const STARTED_AT = "2026-10-05T00:00:00.000Z";
const FINISHED_AT = "2026-10-05T00:00:01.500Z";

test("audit record projection keeps only allowlisted aggregate metadata", () => {
  const record = createSecurityAuditRecord(sampleResult(), { scanId: "scan-test-1", startedAt: STARTED_AT, finishedAt: FINISHED_AT });
  assert.equal(record.status, "findings");
  assert.equal(record.findingCount, 4);
  assert.deepEqual(record.severityCounts, { high: 2, medium: 2, low: 0 });
  assert.deepEqual(record.categoryCounts, { secret: 2, "sensitive-file": 1, mcp: 1, "workspace-boundary": 0 });
  assert.equal(record.filesScanned, 42);
  assert.equal(record.bytesScanned, 2048);
  assert.equal(record.skippedEntries, 3);
  assert.equal(record.durationMs, 1500);
  assert.equal(record.startedAt, STARTED_AT);
  assert.equal(record.finishedAt, FINISHED_AT);
  assert.deepEqual(
    Object.keys(record).sort(),
    [
      "bytesScanned",
      "categoryCounts",
      "durationMs",
      "filesScanned",
      "findingCount",
      "finishedAt",
      "scanId",
      "schemaVersion",
      "severityCounts",
      "skippedEntries",
      "startedAt",
      "status",
    ],
  );
});

test("audit record serialization never contains finding locations, summaries, or secret values", () => {
  const record = createSecurityAuditRecord(sampleResult(), { scanId: "scan-test-2", startedAt: STARTED_AT, finishedAt: FINISHED_AT });
  const serialized = JSON.stringify(record);
  for (const forbidden of [
    "super-secret-value",
    ".env",
    "notes.txt",
    "mcp[0]",
    "Secret-like",
    "invokes a shell",
    "echo $TOKEN",
    "/tmp/",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `serialized record must not contain ${JSON.stringify(forbidden)}`);
  }
});

test("error projection records a fixed error status without any exception text", () => {
  const record = createSecurityAuditErrorRecord({ scanId: "scan-error-1", startedAt: STARTED_AT, finishedAt: FINISHED_AT });
  assert.equal(record.status, "error");
  assert.equal(record.findingCount, 0);
  assert.deepEqual(record.severityCounts, { high: 0, medium: 0, low: 0 });
  assert.deepEqual(record.categoryCounts, { secret: 0, "sensitive-file": 0, mcp: 0, "workspace-boundary": 0 });
  assert.equal(record.filesScanned, 0);
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes("EACCES"), false);
  assert.equal(serialized.includes("Error"), false);
});

test("store persists records atomically, reloads them newest-first, and strips forbidden fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-security-audit-"));
  try {
    const stateFile = join(root, "security-audit-history.json");
    const store = new SecurityAuditHistoryStore({ stateFile });
    await store.record(createSecurityAuditRecord(sampleResult(), { scanId: "scan-a", startedAt: STARTED_AT, finishedAt: FINISHED_AT }));
    await store.record(createSecurityAuditRecord(sampleResult(), { scanId: "scan-b", startedAt: FINISHED_AT, finishedAt: "2026-10-05T00:00:03.000Z" }));
    assert.deepEqual(store.list().map((record) => record.scanId), ["scan-b", "scan-a"]);
    const reloaded = new SecurityAuditHistoryStore({ stateFile });
    assert.deepEqual(reloaded.list().map((record) => record.scanId), ["scan-b", "scan-a"]);

    const raw: Record<string, unknown> = {
      schemaVersion: 1,
      scanId: "scan-raw",
      status: "findings",
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      durationMs: -5,
      filesScanned: -3,
      bytesScanned: Number.MAX_SAFE_INTEGER,
      skippedEntries: 1.5,
      findingCount: 2,
      severityCounts: { high: 1, medium: 1, low: 0 },
      categoryCounts: { secret: 1, "sensitive-file": 1, mcp: 0, "workspace-boundary": 0 },
      location: ".env",
      summary: "super-secret-value",
    };
    assert.equal(await store.record(raw), true);
    const stored = store.list()[0] as SecurityAuditRecord;
    assert.equal(stored.scanId, "scan-raw");
    assert.equal(stored.durationMs, 0);
    assert.equal(stored.filesScanned, 0);
    assert.equal(stored.bytesScanned, MAX_SECURITY_AUDIT_COUNTER);
    assert.equal(stored.skippedEntries, 0);
    const storedSerialized = JSON.stringify(stored);
    assert.equal(storedSerialized.includes("super-secret-value"), false);
    assert.equal(storedSerialized.includes(".env"), false);
    assert.equal("location" in stored, false);
    assert.equal("summary" in stored, false);

    assert.equal(await store.record({ ...raw, scanId: "../escape" }), false);
    assert.equal(await store.record({ ...raw, scanId: "scan-bad", startedAt: "not-a-date" }), false);
    assert.equal(await store.record({ nope: true }), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("store deduplicates scan ids by moving the newest entry to the front", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-security-audit-dedupe-"));
  try {
    const store = new SecurityAuditHistoryStore({});
    await store.record(createSecurityAuditRecord(sampleResult(), { scanId: "scan-a", startedAt: STARTED_AT, finishedAt: FINISHED_AT }));
    await store.record(createSecurityAuditRecord(sampleResult(), { scanId: "scan-b", startedAt: FINISHED_AT, finishedAt: "2026-10-05T00:00:03.000Z" }));
    await store.record(createSecurityAuditRecord(sampleResult(), { scanId: "scan-a", startedAt: "2026-10-05T00:00:04.000Z", finishedAt: "2026-10-05T00:00:05.000Z" }));
    const ids = store.list().map((record) => record.scanId);
    assert.deepEqual(ids, ["scan-a", "scan-b"]);
    assert.equal(store.list().length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("store clears persisted history and keeps accepting new records", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-security-audit-clear-"));
  try {
    const stateFile = join(root, "security-audit-history.json");
    const store = new SecurityAuditHistoryStore({ stateFile });
    await store.record(createSecurityAuditRecord(sampleResult(), { scanId: "scan-a", startedAt: STARTED_AT, finishedAt: FINISHED_AT }));
    assert.equal(store.list().length, 1);
    await store.clear();
    assert.equal(store.list().length, 0);
    const reloaded = new SecurityAuditHistoryStore({ stateFile });
    assert.equal(reloaded.list().length, 0);
    await reloaded.record(createSecurityAuditRecord(sampleResult(), { scanId: "scan-b", startedAt: STARTED_AT, finishedAt: FINISHED_AT }));
    assert.equal(reloaded.list().length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("store caps history length and drops the oldest records", async () => {  const store = new SecurityAuditHistoryStore({});
  for (let index = 0; index < MAX_SECURITY_AUDIT_RECORDS + 5; index++) {
    const startedAt = new Date(Date.parse(STARTED_AT) + index * 1000).toISOString();
    const finishedAt = new Date(Date.parse(startedAt) + 500).toISOString();
    await store.record(createSecurityAuditRecord(sampleResult(), { scanId: `scan-${index}`, startedAt, finishedAt }));
  }
  const records = store.list();
  assert.equal(records.length, MAX_SECURITY_AUDIT_RECORDS);
  assert.equal(records[0]?.scanId, `scan-${MAX_SECURITY_AUDIT_RECORDS + 4}`);
  assert.equal(records.at(-1)?.scanId, "scan-5");
});

test("store fails closed on malformed or oversized persisted state and keeps working", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-security-audit-failclosed-"));
  try {
    const stateFile = join(root, "security-audit-history.json");
    await writeFile(stateFile, "not-json{{{", "utf8");
    const malformed = new SecurityAuditHistoryStore({ stateFile });
    assert.equal(malformed.list().length, 0);
    await malformed.record(createSecurityAuditRecord(sampleResult(), { scanId: "scan-recover", startedAt: STARTED_AT, finishedAt: FINISHED_AT }));
    assert.equal(malformed.list().length, 1);

    const oversizedStateFile = join(root, "oversized.json");
    await writeFile(oversizedStateFile, "x".repeat(MAX_SECURITY_AUDIT_BYTES + 1), "utf8");
    const oversized = new SecurityAuditHistoryStore({ stateFile: oversizedStateFile });
    assert.equal(oversized.list().length, 0);

    const wrongVersionFile = join(root, "wrong-version.json");
    await writeFile(wrongVersionFile, JSON.stringify({ version: 99, records: [] }), "utf8");
    const wrongVersion = new SecurityAuditHistoryStore({ stateFile: wrongVersionFile });
    assert.equal(wrongVersion.list().length, 0);

    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(persisted.version, 1);
    assert.ok(Array.isArray(persisted.records));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("history formatter renders bounded metadata only and never renders locations or summaries", () => {
  const record = createSecurityAuditRecord(sampleResult(), { scanId: "scan-formatter", startedAt: STARTED_AT, finishedAt: FINISHED_AT });
  const output = formatSecurityAuditHistory([record]);
  assert.match(output, /metadata-only/i);
  assert.match(output, /scan-formatter/);
  assert.match(output, /findings/);
  assert.match(output, /high 2/u);
  assert.match(output, /files 42/u);
  for (const forbidden of ["super-secret-value", ".env", "notes.txt", "mcp[0]", "Secret-like", "invokes a shell"]) {
    assert.equal(output.includes(forbidden), false, `history output must not contain ${JSON.stringify(forbidden)}`);
  }
  assert.match(formatSecurityAuditHistory([]), /no (?:recorded )?security (?:scan )?(?:audit )?history/i);
});
