import assert from "node:assert/strict";
import test from "node:test";

import {
  createParallelRunsSnapshot,
  normalizeParallelRunsSnapshot,
} from "../dist/parallel-runs.js";
import { createDesktopServer } from "../dist/server.js";

function start(server: any): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as any;
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function close(server: any): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("parallel run snapshots expose bounded stage metadata only", () => {
  const snapshot = createParallelRunsSnapshot([
    {
      sessionId: "agent-a",
      run: {
        status: "running",
        active: true,
        runId: "run-a",
        sequence: 4,
        startedAt: "2026-09-25T08:00:00.000Z",
      },
      live: { tool: { name: "tests", progress: 2, total: 5 } },
    },
    {
      sessionId: "agent-b",
      run: {
        status: "waiting",
        active: true,
        runId: "run-b",
        sequence: 2,
        startedAt: "2026-09-25T08:01:00.000Z",
      },
      live: { approval: { id: "approval", tool: "filesystem", reason: "raw reason" } },
    },
    {
      sessionId: "agent-c",
      run: {
        status: "failed",
        active: false,
        sequence: 7,
        startedAt: "2026-09-25T07:00:00.000Z",
        finishedAt: "2026-09-25T07:02:00.000Z",
      },
    },
  ], "2026-09-25T08:02:00.000Z");

  assert.equal(snapshot.metadataOnly, true);
  assert.equal(snapshot.active, 2);
  assert.equal(snapshot.running, 1);
  assert.equal(snapshot.waiting, 1);
  assert.equal(snapshot.failed, 1);
  const toolRun = snapshot.runs.find((run) => run.sessionId === "agent-a");
  const approvalRun = snapshot.runs.find((run) => run.sessionId === "agent-b");
  const failedRun = snapshot.runs.find((run) => run.sessionId === "agent-c");
  assert.equal(toolRun?.stage, "tool");
  assert.deepEqual(toolRun?.tool, { name: "tests", progress: 2, total: 5 });
  assert.equal(approvalRun?.stage, "approval");
  assert.equal(approvalRun?.approvalPending, true);
  assert.equal(failedRun?.durationMs, 120_000);
  assert.doesNotMatch(JSON.stringify(snapshot), /raw reason|filesystem|secret|output|prompt/i);
});

test("parallel run normalization fails closed and stays bounded", () => {
  const snapshot = normalizeParallelRunsSnapshot({
    checkedAt: "not-a-date",
    runs: [
      { sessionId: "../private", status: "running", active: true },
      {
        sessionId: "safe",
        status: "running",
        active: true,
        sequence: 999999999999,
        tool: { name: "x".repeat(500), progress: -2 },
        approvalPending: false,
      },
    ],
  });
  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.runs[0]?.sessionId, "safe");
  assert.equal(snapshot.runs[0]?.sequence, 10_000_000);
  assert.equal(snapshot.runs[0]?.tool, undefined);
  assert.equal(snapshot.metadataOnly, true);
});

test("GET /api/parallel-runs returns a session-safe projection for concurrent runs", async () => {
  const server = createDesktopServer({
    session: { id: "default", async run() {} },
    createSession: (id) => ({ id, async run() {} }),
  });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/parallel-runs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const payload = await response.json() as any;
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.metadataOnly, true);
    assert.ok(Array.isArray(payload.runs));
    assert.ok(payload.runs.some((run: any) => run.sessionId === "default"));
    assert.doesNotMatch(JSON.stringify(payload), /prompt|output|command|args|env|private|secret/i);
  } finally {
    await close(server);
  }
});

test("Desktop exposes the parallel run panel and focus-safe refresh contract", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const html = await (await fetch(`${base}/`)).text();
    for (const id of [
      "parallel-runs-panel",
      "parallel-runs-status",
      "parallel-runs-summary",
      "parallel-runs-list",
      "parallel-runs-refresh",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /\/api\/parallel-runs/);
    assert.match(html, /parallelRun/);
    assert.match(html, /focusParallelRun/);
    assert.match(html, /textContent/);
  } finally {
    await close(server);
  }
});
