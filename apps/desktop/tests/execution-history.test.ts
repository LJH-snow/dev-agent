import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { ExecutionHistoryStore } from "../dist/execution-history.js";
import { DesktopRunState } from "../dist/run-state.js";
import { createDesktopServer } from "../dist/server.js";

function historyRecord(sessionId: string, index: number) {
  const startedAt = new Date(Date.UTC(2026, 8, 30, 10, index % 60, 0)).toISOString();
  const finishedAt = new Date(Date.parse(startedAt) + 1000 + index).toISOString();
  return {
    schemaVersion: 1 as const,
    sessionId,
    runId: "run-" + String(index),
    status: "done" as const,
    startedAt,
    finishedAt,
    durationMs: 1000 + index,
    sequence: index,
    toolCount: index % 4,
    approvalCount: index % 2,
    validationCount: index % 3,
  };
}

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

test("DesktopRunState produces terminal metadata without replay content", () => {
  const run = new DesktopRunState("desktop-default", "run-1", "2026-09-30T10:00:00.000Z");
  run.append({ type: "tool", data: { name: "filesystem.patch", input: "secret" } } as any);
  run.append({ type: "approval-request", data: { id: "approval-1", tool: "filesystem.patch" } } as any);
  run.append({ type: "validation", data: { status: "failed", output: "private output" } } as any);
  run.finish("failed");

  const record = run.historyRecord();
  assert.equal(record?.sessionId, "desktop-default");
  assert.equal(record?.runId, "run-1");
  assert.equal(record?.status, "failed");
  assert.equal(record?.toolCount, 1);
  assert.equal(record?.approvalCount, 1);
  assert.equal(record?.validationCount, 1);
  assert.doesNotMatch(JSON.stringify(record), /secret|private output|input|output/i);
});

test("execution history persists, reloads, and caps each session at 50 records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-execution-history-"));
  const stateFile = join(directory, "history.json");
  try {
    const store = new ExecutionHistoryStore({ stateFile });
    for (let index = 0; index < 52; index += 1) {
      assert.equal(await store.record(historyRecord("desktop-default", index)), true);
    }

    const reloaded = new ExecutionHistoryStore({ stateFile });
    const history = reloaded.list("desktop-default");
    assert.equal(history.length, 50);
    assert.equal(history[0]?.runId, "run-51");
    assert.equal(history.at(-1)?.runId, "run-2");
    assert.doesNotMatch(JSON.stringify(history), /prompt|output|command|secret|Users|home|tmp/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed or oversized execution history fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-execution-history-invalid-"));
  const stateFile = join(directory, "history.json");
  try {
    await writeFile(stateFile, "{not json", "utf8");
    assert.deepEqual(new ExecutionHistoryStore({ stateFile }).list("desktop-default"), []);
    await writeFile(stateFile, "x".repeat(1024 * 1024 + 1), "utf8");
    assert.deepEqual(new ExecutionHistoryStore({ stateFile }).list("desktop-default"), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("execution history follows session renames and clears deleted sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-execution-history-lifecycle-"));
  const stateFile = join(directory, "history.json");
  try {
    const store = new ExecutionHistoryStore({ stateFile });
    await store.record(historyRecord("old-session", 1));
    assert.equal(await store.move("old-session", "new-session"), true);
    assert.equal(store.list("old-session").length, 0);
    assert.equal(store.list("new-session").length, 1);
    assert.equal(await store.clear("new-session"), true);
    assert.equal(new ExecutionHistoryStore({ stateFile }).list("new-session").length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("closing the Desktop server preserves execution history for the next launch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-execution-history-shutdown-"));
  const stateFile = join(directory, "history.json");
  try {
    const store = new ExecutionHistoryStore({ stateFile });
    await store.record(historyRecord("desktop-default", 8));
    const server = createDesktopServer({
      executionHistoryStateFile: stateFile,
      session: { id: "desktop-default", async run() {} },
    });
    await start(server);
    await close(server);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const restored = new ExecutionHistoryStore({ stateFile });
    assert.deepEqual(restored.list("desktop-default").map((record) => record.runId), ["run-8"]);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("GET /api/execution-center returns persisted history and exposes the history panel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-execution-history-route-"));
  const stateFile = join(directory, "history.json");
  const store = new ExecutionHistoryStore({ stateFile });
  await store.record(historyRecord("desktop-default", 7));
  const server = createDesktopServer({
    executionHistoryStateFile: stateFile,
    session: { id: "desktop-default", async run() {} },
  });
  const base = await start(server);
  try {
    const response = await fetch(base + "/api/execution-center?historySessionId=desktop-default");
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.equal(payload.historySessionId, "desktop-default");
    assert.equal(payload.history.length, 1);
    assert.equal(payload.history[0].runId, "run-7");
    assert.doesNotMatch(JSON.stringify(payload), /prompt|output|command|secret|Users|home|tmp/i);

    const [html, moduleSource] = await Promise.all([
      fetch(base + "/").then((result) => result.text()),
      fetch(base + "/public/execution-center.js").then((result) => result.text()),
    ]);
    for (const id of ["execution-center-history", "execution-center-history-list", "execution-center-history-status"]) {
      assert.match(html, new RegExp("id=\\\"" + id + "\\\""));
    }
    assert.match(moduleSource, /historySessionId/);
    assert.match(moduleSource, /executionCenter\.history/);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});
