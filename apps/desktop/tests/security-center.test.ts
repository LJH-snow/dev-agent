import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createSecurityCenterSnapshot,
  normalizeSecurityCenterSnapshot,
  SECURITY_CENTER_SCHEMA_VERSION,
} from "../dist/security-center.js";
import { createDesktopServer } from "../dist/server.js";

function start(server: any): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as any;
      resolve("http://" + address.address + ":" + address.port);
    });
  });
}

function close(server: any): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function sampleRecord(scanId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    scanId,
    status: "findings",
    startedAt: "2026-10-05T00:00:00.000Z",
    finishedAt: "2026-10-05T00:00:01.500Z",
    durationMs: 1500,
    filesScanned: 42,
    bytesScanned: 2048,
    skippedEntries: 3,
    findingCount: 2,
    severityCounts: { high: 1, medium: 1, low: 0 },
    categoryCounts: { secret: 1, "sensitive-file": 1, mcp: 0, "workspace-boundary": 0 },
  };
}

test("security center snapshot is bounded, metadata-only, and fails closed", () => {
  const snapshot = createSecurityCenterSnapshot({
    generatedAt: "2026-10-05T05:00:00.000Z",
    history: [
      sampleRecord("scan-b"),
      { ...sampleRecord("scan-a"), scanId: "scan-a", status: "clean" },
      "../escape",
      { ...sampleRecord("scan-b") },
    ],
  });
  assert.equal(snapshot.schemaVersion, SECURITY_CENTER_SCHEMA_VERSION);
  assert.equal(snapshot.metadataOnly, true);
  assert.equal(snapshot.generatedAt, "2026-10-05T05:00:00.000Z");
  assert.equal(snapshot.lastScan?.scanId, "scan-b");
  assert.equal(snapshot.history.length, 2);
  assert.deepEqual(snapshot.history.map((record) => record.scanId), ["scan-b", "scan-a"]);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /super-secret|\/Users\/|\/tmp\/|\.env|notes\.txt|mcp\[0\]|invokes a shell/i);

  assert.equal(normalizeSecurityCenterSnapshot({ schemaVersion: 99, metadataOnly: true }), undefined);
  assert.equal(normalizeSecurityCenterSnapshot({ schemaVersion: 1, metadataOnly: false }), undefined);
  assert.equal(normalizeSecurityCenterSnapshot("nope"), undefined);
  const normalized = normalizeSecurityCenterSnapshot({
    schemaVersion: 1,
    metadataOnly: true,
    generatedAt: "not-a-date",
    history: [{ ...sampleRecord("scan-x"), findingCount: 10_000_000, scanId: "../../etc" }, sampleRecord("scan-y")],
  });
  assert.ok(normalized);
  assert.notEqual(normalized.generatedAt, "not-a-date");
  assert.equal(normalized.history.length, 1);
  assert.equal(normalized.history[0]?.scanId, "scan-y");
});

test("GET /api/security-center is loopback-gated and serves a metadata-only snapshot", async () => {
  const server = createDesktopServer({
    session: { id: "desktop-default", async run() {} },
    securityHistoryStateFile: join(await mkdtemp(join(tmpdir(), "dev-agent-security-center-")), "history.json"),
  });
  const base = await start(server);
  try {
    const hostile = await fetch(base + "/api/security-center", {
      headers: { origin: "https://attacker.example" },
    });
    assert.equal(hostile.status, 403);
    assert.match(await hostile.text(), /trusted loopback requests/);

    const response = await fetch(base + "/api/security-center");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const payload = await response.json() as any;
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.metadataOnly, true);
    assert.deepEqual(payload.history, []);
    assert.equal(payload.lastScan, undefined);
  } finally { await close(server); }
});

test("POST /api/security-scan is capability-gated and records metadata-only history", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-security-center-scan-"));
  const stateFile = join(root, "history.json");
  const server = createDesktopServer({
    session: { id: "desktop-default", async run() {} },
    capabilityToken: "security-center-test-token",
    requireCapabilityToken: true,
    securityHistoryStateFile: stateFile,
  });
  const base = await start(server);
  try {
    const missingToken = await fetch(base + "/api/security-scan", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(missingToken.status, 403);
    assert.deepEqual(await missingToken.json() as any, {
      error: "desktop capability token is required",
      code: "desktop-capability-required",
    });

    const wrongToken = await fetch(base + "/api/security-scan", {
      method: "POST",
      headers: { "x-dev-agent-capability": "wrong-token" },
      body: JSON.stringify({}),
    });
    assert.equal(wrongToken.status, 403);

    const malformed = await fetch(base + "/api/security-scan", {
      method: "POST",
      headers: { "x-dev-agent-capability": "security-center-test-token" },
      body: "{not-json",
    });
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json() as any).error, /valid JSON/);

    const nonObject = await fetch(base + "/api/security-scan", {
      method: "POST",
      headers: { "x-dev-agent-capability": "security-center-test-token" },
      body: JSON.stringify([1, 2]),
    });
    assert.equal(nonObject.status, 400);

    const badSessionId = await fetch(base + "/api/security-scan", {
      method: "POST",
      headers: { "x-dev-agent-capability": "security-center-test-token" },
      body: JSON.stringify({ sessionId: "x".repeat(200) }),
    });
    assert.equal(badSessionId.status, 400);
    assert.match((await badSessionId.json() as any).error, /sessionId is too long/);

    const unknownSession = await fetch(base + "/api/security-scan", {
      method: "POST",
      headers: { "x-dev-agent-capability": "security-center-test-token" },
      body: JSON.stringify({ sessionId: "desktop-default" }),
    });
    assert.equal(unknownSession.status, 404);
    assert.match((await unknownSession.json() as any).error, /unknown session/);

    const scan = await fetch(base + "/api/security-scan", {
      method: "POST",
      headers: { "x-dev-agent-capability": "security-center-test-token" },
      body: JSON.stringify({}),
    });
    assert.equal(scan.status, 200);
    assert.match(scan.headers.get("cache-control") ?? "", /no-store/);
    const payload = await scan.json() as any;
    assert.equal(payload.schemaVersion, 1);
    assert.ok(["clean", "findings", "partial"].includes(payload.status));
    assert.equal(typeof payload.filesScanned, "number");
    assert.equal(typeof payload.findings, "object");
    assert.equal(payload.record.scanId.length > 0, true);
    assert.equal(payload.record.findingCount, Array.isArray(payload.findings) ? payload.findings.length : payload.record.findingCount);

    const listing = await fetch(base + "/api/security-center");
    const listingPayload = await listing.json() as any;
    assert.equal(listingPayload.history.length, 1);
    assert.equal(listingPayload.lastScan?.scanId, payload.record.scanId);
    const historySerialized = JSON.stringify(listingPayload.history);
    assert.doesNotMatch(historySerialized, /super-secret|\/Users\/|\/tmp\/|\.env|notes\.txt|mcp\[0\]|invokes a shell/i);

    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.records.length, 1);

    const deleteWithoutToken = await fetch(base + "/api/security-center", { method: "DELETE" });
    assert.equal(deleteWithoutToken.status, 403);
    assert.deepEqual(await deleteWithoutToken.json() as any, {
      error: "desktop capability token is required",
      code: "desktop-capability-required",
    });

    const wrongTokenDelete = await fetch(base + "/api/security-center", {
      method: "DELETE",
      headers: { "x-dev-agent-capability": "wrong-token" },
    });
    assert.equal(wrongTokenDelete.status, 403);

    const clear = await fetch(base + "/api/security-center", {
      method: "DELETE",
      headers: { "x-dev-agent-capability": "security-center-test-token" },
    });
    assert.equal(clear.status, 200);
    assert.match(clear.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(await clear.json() as any, { schemaVersion: 1, cleared: true });

    const afterClear = await fetch(base + "/api/security-center");
    assert.deepEqual((await afterClear.json() as any).history, []);
    const persistedAfterClear = JSON.parse(await readFile(stateFile, "utf8"));
    assert.deepEqual(persistedAfterClear.records, []);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("security center panel contract stays wired into the workbench", async () => {
  const server = createDesktopServer({
    session: { id: "desktop-default", async run() {} },
  });
  const base = await start(server);
  try {
    const page = await (await fetch(base + "/")).text();
    for (const id of [
      "security-center-panel",
      "security-center-title",
      "security-center-status",
      "security-center-summary",
      "security-center-list",
      "security-center-run-scan",
      "security-center-clear",
      "security-center-clear-status",
      "security-center-refresh",
      "security-center-findings",
      "security-center-findings-title",
      "security-center-findings-list",
      "security-center-note",
    ]) {
      assert.ok(page.includes(`id="${id}"`), `workbench should declare #${id}`);
    }
    assert.ok(page.includes('data-i18n="securityCenter.title"'));
    assert.ok(page.includes('"securityCenter.metadataNote"'), "en dictionary should define securityCenter keys");
    assert.ok(page.includes('"securityCenter.title": "安全中心"'), "zh dictionary should define securityCenter keys");
    assert.ok(page.includes("createSecurityCenterUI"));

    const module = await (await fetch(base + "/public/security-center.js")).text();
    for (const symbol of ["createSecurityCenterUI", "/api/security-center", "/api/security-scan", "textContent"]) {
      assert.ok(module.includes(symbol), `security-center.js should reference ${symbol}`);
    }
    assert.ok(module.includes("securityCenter.clearConfirm"), "clear action must confirm before deleting");
    assert.equal(module.includes("innerHTML"), false, "panel must render with textContent only");
  } finally { await close(server); }
});
