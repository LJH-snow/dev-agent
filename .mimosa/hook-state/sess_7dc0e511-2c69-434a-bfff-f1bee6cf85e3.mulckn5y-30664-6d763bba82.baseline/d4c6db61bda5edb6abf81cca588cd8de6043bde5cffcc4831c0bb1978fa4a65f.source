import assert from "node:assert/strict";
import { Agent, request as httpRequest } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatSession } from "../dist/chat-session.js";
import { createDesktopServer } from "../dist/server.js";

function start(server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as any;
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

async function close(server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function requestText(
  url: string,
  options: { method: string; body?: string }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const agent = new Agent({ keepAlive: false, maxSockets: Infinity });
    const request = httpRequest(
      url,
      {
        method: options.method,
        agent,
        ...(options.body === undefined
          ? {}
          : { headers: { "content-type": "application/json" } }),
      },
      (response) => {
        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          agent.destroy();
          resolve({ status: response.statusCode ?? 0, body });
        });
      }
    );
    request.on("error", (error) => {
      agent.destroy();
      reject(error);
    });
    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

function fakeSession() {
  return {
    async run(_message, emit) {
      emit({ type: "token", data: { token: "hello " } });
      emit({ type: "token", data: { token: "world" } });
      emit({ type: "tool", data: { name: "echo", input: { x: 1 } } });
      emit({ type: "tool-progress", data: { name: "echo", progress: 4, total: 10 } });
      emit({ type: "tool-progress", data: { name: "echo", progress: 5 } });
      emit({ type: "tool-result", data: { name: "echo", output: "ok" } });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  };
}

const review = {
  changeSetId: "change-set-server-1",
  files: [
    {
      path: "/workspace/example.txt",
      kind: "file",
      beforeHash: "before",
      afterHash: "after",
      diff: "--- a/example.txt\n+++ b/example.txt\n@@\n-old\n+new\n",
      additions: 1,
      deletions: 1,
      beforeExists: true,
      afterExists: true,
    },
  ],
  additions: 1,
  deletions: 1,
  createdAt: "2026-09-13T00:00:00.000Z",
};

function parseSseBlock(block) {
  let type = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) type = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  return data ? { type, data: JSON.parse(data) } : undefined;
}

async function readSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const event = parseSseBlock(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
      if (event) {
        events.push(event);
        await onEvent?.(event);
      }
    }
  }
  return events;
}

test("GET /health returns ok", async () => {
  const previousRustBinary = process.env.DEV_AGENT_RUST_BINARY;
  delete process.env.DEV_AGENT_RUST_BINARY;
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.deepEqual(body, { status: "ok", executorMode: "local" });
  } finally {
    await close(server);
    if (previousRustBinary === undefined) {
      delete process.env.DEV_AGENT_RUST_BINARY;
    } else {
      process.env.DEV_AGENT_RUST_BINARY = previousRustBinary;
    }
  }
});

test("ChatSession exposes its actual executor mode", async () => {
  const previousRustBinary = process.env.DEV_AGENT_RUST_BINARY;
  delete process.env.DEV_AGENT_RUST_BINARY;
  const session = new ChatSession();
  try {
    assert.equal(session.executorMode, "local");
  } finally {
    await session.close();
    if (previousRustBinary === undefined) {
      delete process.env.DEV_AGENT_RUST_BINARY;
    } else {
      process.env.DEV_AGENT_RUST_BINARY = previousRustBinary;
    }
  }
});

test("GET /health reports unknown for injected sessions without executor metadata", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", executorMode: "unknown" });
  } finally {
    await close(server);
  }
});

test("GET /health reports executor metadata from injected sessions", async () => {
  const server = createDesktopServer({
    session: { executorMode: "sandboxed-linux", async run() {} },
  });
  const base = await start(server);
  try {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", executorMode: "sandboxed-linux" });
  } finally {
    await close(server);
  }
});

test("GET / serves the chat UI", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const contentType = res.headers.get("content-type") || "";
    assert.match(contentType, /text\/html/);
    const html = await res.text();
    assert.match(html, /dev-agent/);
    assert.match(html, /class="workbench"/);
    assert.match(html, /class="session-rail"/);
    assert.match(html, /class="inspector-shell"/);
    assert.match(html, /id="toggle-inspector"/);
    assert.match(html, /id="runtime-inspector"/);
    assert.match(html, /id="theme-toggle"/);
    assert.match(html, /data-theme/);
    assert.match(html, /\/public\/styles\.css/);
    assert.match(html, /rel="icon" href="\/public\/signal-loom\.svg"/);
    assert.match(html, /src="\/public\/signal-loom\.svg"/);
    assert.match(html, /aria-label="dev-agent Signal Loom workbench"/);
    assert.match(html, /tool-progress/);
    assert.match(html, /changesets\/rollback/);
    assert.match(html, /createElement\("pre"\)/);
    const asset = await requestText(`${base}/public/signal-loom.svg`, { method: "GET" });
    assert.equal(asset.status, 200);
    assert.match(asset.body, /<svg[\s>]/);
    assert.match(asset.body, /#58d6d1/);
  } finally {
    await close(server);
  }
});

test("GET / exposes a metadata-only evidence preview control", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /id="preview-evidence"/);
    assert.match(html, /title="Preview evidence summary"/);
    assert.match(html, /id="evidence-preview"/);
    assert.match(html, /id="evidence-preview-status"/);
    assert.match(html, /id="evidence-preview-validations"/);
    assert.match(html, /id="evidence-preview-change-sets"/);
    assert.match(html, /id="evidence-preview-files"/);
    assert.match(html, /id="evidence-preview-bytes"/);
    assert.match(html, /\/evidence\/preview/);
    assert.match(html, /new AbortController\(\)/);
    assert.match(html, /Session evidence changed — refresh to update\./);
    assert.match(html, /function evidencePreviewFailureMessage\(status\)/);
    assert.match(html, /case 404:[\s\S]*?Unknown session\./);
    assert.match(html, /case 413:[\s\S]*?Evidence preview is too large\./);
    assert.match(html, /case 400:[\s\S]*?Evidence preview request is invalid\./);
    assert.match(html, /default:[\s\S]*?Evidence preview unavailable\./);
    assert.match(html, /validationCount/);
    assert.match(html, /changeSetCount/);
    assert.match(html, /fileCount/);
    assert.match(html, /serializedBytes/);
    assert.match(html, /Evidence summary/);
    assert.match(html, /Estimated export size/);
    assert.match(html, /id="evidence-preview-retention-note"/);
    assert.match(html, /Applied change-set guards stay for validation\./);
    assert.match(html, /id="desktop-status-workspace"/);
    assert.match(html, /payload\.workspace\?\.label \|\| "—"/);
    assert.match(html, /id="desktop-status-mcp"/);
    assert.match(html, /payload\.mcp\?\.configured/);
    assert.match(html, /payload\.mcp\?\.connected/);
  } finally {
    await close(server);
  }
});

test("GET / exposes keyboard focus and async status semantics", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /button:focus-visible/);
    assert.match(html, /select:focus-visible/);
    assert.match(html, /id="session"[^>]*aria-label="Session"/);
    assert.match(html, /id="new-session"[^>]*aria-label="New session"/);
    assert.match(html, /id="usage"[^>]*aria-label="Usage"/);
    assert.match(html, /id="status"[^>]*role="status"/);
    assert.match(html, /id="status"[^>]*aria-live="polite"/);
    assert.match(html, /id="status"[^>]*aria-atomic="true"/);
    assert.match(html, /id="input"[^>]*aria-label="Message"/);
    assert.match(html, /id="evidence-preview"[^>]*aria-busy="false"/);
    assert.match(html, /setAttribute\("aria-busy", "true"\)/);
    assert.match(html, /setAttribute\("aria-busy", "false"\)/);
  } finally {
    await close(server);
  }
});

test("GET /api/sessions/:id/trace returns bounded metadata-only trace", async () => {
  const trace = {
    schemaVersion: 1,
    metadataOnly: true,
    droppedRuns: 0,
    runs: [
      {
        runId: "run-1",
        status: "completed",
        startedAt: "2026-09-20T10:00:00.000Z",
        completedAt: "2026-09-20T10:00:00.100Z",
        durationMs: 100,
        turns: 1,
        usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
        spans: [],
      },
    ],
  } as const;
  const server = createDesktopServer({
    session: {
      getTraceSnapshot() {
        return trace;
      },
      async run() {},
    },
  });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/sessions/desktop-default/trace`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), trace);
    assert.doesNotMatch(JSON.stringify(trace), /prompt text|tool output|Users|secret/i);
  } finally {
    await close(server);
  }
});

test("POST /api/sessions/:id/trace/lifecycle stores only allowlisted lifecycle metadata", async () => {
  const lifecycle = [];
  const session = {
    async run() {},
    recordTraceLifecycle(kind, status) {
      lifecycle.push({ kind, status });
    },
    getTraceSnapshot() {
      return { schemaVersion: 1 as const, metadataOnly: true as const, droppedRuns: 0, runs: [], lifecycle };
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/sessions/desktop-default/trace/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "preview", status: "loaded", url: "/Users/private/secret" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(lifecycle, [{ kind: "preview", status: "loaded" }]);

    const invalid = await fetch(`${base}/api/sessions/desktop-default/trace/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "preview", status: "opened" }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(lifecycle, [{ kind: "preview", status: "loaded" }]);

    const trace = await fetch(`${base}/api/sessions/desktop-default/trace`);
    assert.equal(trace.status, 200);
    const tracePayload = await trace.json() as { readonly lifecycle?: unknown };
    assert.deepEqual(tracePayload.lifecycle, [{ kind: "preview", status: "loaded" }]);
    assert.doesNotMatch(JSON.stringify(lifecycle), /Users|secret|url/i);
  } finally {
    await close(server);
  }
});

test("GET /api/sessions/:id/trace stays stable for legacy sessions", async () => {
  const server = createDesktopServer({
    session: { async run() {} },
  });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/sessions/desktop-default/trace`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "trace unavailable" });
  } finally {
    await close(server);
  }
});

test("review approval SSE includes the change-set review", async () => {
  let rollbackCalls = [];
  const session = {
    async run(_message, emit, options) {
      const decision = await options.requestApproval({
        tool: "filesystem",
        input: { action: "write", path: review.files[0].path, content: "new\n" },
        review,
      });
      emit({ type: "approval", data: { tool: "filesystem", decision, review } });
      emit({ type: "tool-result", data: { name: "filesystem", output: { ok: true } } });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
    async rollbackChangeSet(changeSetId) {
      rollbackCalls.push(changeSetId);
      return { ok: true, changeSetId, files: [], additions: 0, deletions: 0 };
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "review this change" }),
    });
    const events = await readSse(response, async (event) => {
      if (event.type !== "approval-request") return;
      assert.deepEqual(event.data.review, review);
      const approval = await fetch(`${base}/api/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: event.data.id, decision: "allow" }),
      });
      assert.equal(approval.status, 200);
    });

    const requestIndex = events.findIndex((event) => event.type === "approval-request");
    const approvalIndex = events.findIndex((event) => event.type === "approval");
    const resultIndex = events.findIndex((event) => event.type === "tool-result");
    assert.ok(requestIndex >= 0);
    assert.ok(approvalIndex > requestIndex);
    assert.ok(resultIndex > approvalIndex);
    assert.deepEqual(events[approvalIndex].data.review, review);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("POST /api/changesets/rollback delegates to the session", async () => {
  const calls = [];
  const session = {
    async run() {},
    async rollbackChangeSet(changeSetId) {
      calls.push(changeSetId);
      return { ok: true, changeSetId, files: [], additions: 0, deletions: 0 };
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/changesets/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeSetId: review.changeSetId }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      changeSetId: review.changeSetId,
      files: [],
      additions: 0,
      deletions: 0,
    });
    assert.deepEqual(calls, [review.changeSetId]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("POST /api/changesets/cleanup delegates metadata-only evidence cleanup", async () => {
  let received;
  const result = {
    validationsRemoved: 2,
    changeSetsRemoved: 1,
    protectedChangeSets: 1,
    remainingValidations: 3,
    remainingChangeSets: 1,
  };
  const evidenceSummary = {
    validations: 3,
    changeSets: 1,
    protectedChangeSets: 1,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
  };
  const session = {
    id: "default",
    async run() {},
    async pruneEvidence(options) {
      received = options;
      return result;
    },
    async evidenceSummary() {
      return evidenceSummary;
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/changesets/cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        maxValidations: 3,
        maxChangeSets: 2,
        removeRolledBack: true,
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sessionId: "default",
      ...result,
      evidenceSummary,
    });
    assert.deepEqual(received, {
      maxValidations: 3,
      maxChangeSets: 2,
      removeRolledBack: true,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("POST /api/changesets/cleanup rejects invalid bodies and limits", async () => {
  const server = createDesktopServer({
    session: {
      id: "default",
      async run() {},
      async pruneEvidence() {
        throw new Error("must not run");
      },
    },
  });
  const base = await start(server);
  try {
    const nullBody = await fetch(`${base}/api/changesets/cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    assert.equal(nullBody.status, 400);

    const invalidLimit = await fetch(`${base}/api/changesets/cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxValidations: 0 }),
    });
    assert.equal(invalidLimit.status, 400);
    assert.match(((await invalidLimit.json()) as any).error, /maxValidations/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("POST /api/changesets/cleanup distinguishes unknown and unsupported sessions", async () => {
  const server = createDesktopServer({
    session: { id: "default", async run() {} },
  });
  const base = await start(server);
  try {
    const unknown = await fetch(`${base}/api/changesets/cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "missing" }),
    });
    assert.equal(unknown.status, 404);

    const unsupported = await fetch(`${base}/api/changesets/cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(unsupported.status, 501);
    assert.match(((await unsupported.json()) as any).error, /unavailable/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("POST /api/changesets/rollback maps a postimage conflict to 409", async () => {
  const session = {
    async run() {},
    async rollbackChangeSet(changeSetId) {
      throw new Error(`filesystem change set ${changeSetId} postimage hash conflict at /workspace/example.txt`);
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/changesets/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeSetId: review.changeSetId }),
    });
    assert.equal(response.status, 409);
    const body: any = await response.json();
    assert.match(body.error, /postimage hash conflict/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("POST /api/changesets/rollback returns 409 while the session is running", async () => {
  let release;
  let started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  const session = {
    async run(_message, emit) {
      emit({ type: "turn", data: { turn: 1 } });
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
    async rollbackChangeSet() {
      throw new Error("rollback should not run while chat is active");
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "keep running" }),
    });
    await running;
    const response = await fetch(`${base}/api/changesets/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeSetId: review.changeSetId }),
    });
    assert.equal(response.status, 409);
    release();
    await chat.text();
  } finally {
    release?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("concurrent rollback returns 409 and releases after the first request", async () => {
  const calls = [];
  let started;
  const active = new Promise((resolve) => {
    started = resolve;
  });
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const session = {
    async run() {},
    async rollbackChangeSet(changeSetId) {
      calls.push(changeSetId);
      started();
      await blocked;
      return { ok: true, changeSetId, files: [], additions: 0, deletions: 0 };
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const rollback = requestText(`${base}/api/changesets/rollback`, {
      method: "POST",
      body: JSON.stringify({ changeSetId: review.changeSetId }),
    });
    await active;
    const conflict = requestText(`${base}/api/changesets/rollback`, {
      method: "POST",
      body: JSON.stringify({ changeSetId: review.changeSetId }),
    });
    const conflictResponse = await conflict;
    assert.equal(conflictResponse.status, 409);
    assert.match((JSON.parse(conflictResponse.body) as any).error, /rollback/);
    release();
    const rollbackResponse = await rollback;
    assert.deepEqual(JSON.parse(rollbackResponse.body) as any, {
      ok: true,
      changeSetId: review.changeSetId,
      files: [],
      additions: 0,
      deletions: 0,
    });
    assert.deepEqual(calls, [review.changeSetId]);
    const next = requestText(`${base}/api/changesets/rollback`, {
      method: "POST",
      body: JSON.stringify({ changeSetId: review.changeSetId }),
    });
    assert.equal((await next).status, 200);
    assert.deepEqual(calls, [
      review.changeSetId,
      review.changeSetId,
    ]);
  } finally {
    release?.();
    await close(server);
  }
});

test("DELETE and rename return 409 while a rollback is active", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-lifecycle-"));
  const previousSessionDir = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = directory;
  await writeFile(
    join(directory, "desktop-default.json"),
    JSON.stringify({ version: 1, entries: [] }),
    "utf8"
  );
  let started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const session = {
    async run() {},
    async rollbackChangeSet(changeSetId) {
      started();
      await blocked;
      return { ok: true, changeSetId, files: [], additions: 0, deletions: 0 };
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const rollback = requestText(`${base}/api/changesets/rollback`, {
      method: "POST",
      body: JSON.stringify({ changeSetId: review.changeSetId }),
    });
    await running;
    const deleted = requestText(`${base}/api/sessions/desktop-default`, {
      method: "DELETE",
    });
    const renamed = requestText(`${base}/api/sessions/desktop-default/rename`, {
      method: "POST",
      body: JSON.stringify({ sessionId: "renamed-rollback" }),
    });
    const [deletedResponse, renamedResponse] = await Promise.all([
      deleted,
      renamed,
    ]);
    assert.equal(deletedResponse.status, 409);
    assert.match((JSON.parse(deletedResponse.body) as any).error, /rollback/);
    assert.equal(renamedResponse.status, 409);
    assert.match((JSON.parse(renamedResponse.body) as any).error, /rollback/);
    release();
    assert.equal((await rollback).status, 200);
  } finally {
    release?.();
    if (previousSessionDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousSessionDir;
    }
    await rm(directory, { recursive: true, force: true });
    await close(server);
  }
});

test("POST /api/chat rejects empty message", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close(server);
  }
});

test("POST /api/chat rejects an oversized JSON body", async () => {
  const calls: string[] = [];
  const session = {
    async run(message: string) {
      calls.push(message);
      return;
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await requestText(`${base}/api/chat`, {
      method: "POST",
      body: "x".repeat(1024 * 1024 + 1),
    });
    assert.equal(response.status, 413);
    assert.match(
      (JSON.parse(response.body) as any).error,
      /request body exceeds the 1 MiB limit/
    );
    assert.deepEqual(calls, []);
  } finally {
    await close(server);
  }
});

test("POST /api/chat rejects a new session after the registry limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-session-limit-"));
  const previousSessionDir = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = directory;
  let createdSessions = 0;
  const server = createDesktopServer({
    createSession() {
      createdSessions += 1;
      return {
        async run(_message: string, emit: any) {
          emit({ type: "turn", data: { turn: 1 } });
          emit({ type: "done", data: { status: "done", turns: 1 } });
        },
      };
    },
  });
  const base = await start(server);
  try {
    for (let index = 0; index < 255; index += 1) {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "fill registry", sessionId: `bounded-${index}` }),
      });
      assert.equal(response.status, 200);
      await response.text();
    }
    assert.equal(createdSessions, 255);

    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "one too many", sessionId: "bounded-over" }),
    });
    const body: any = await response.json();
    assert.equal(response.status, 429);
    assert.match(body.error, /registry limit/);
    assert.equal(createdSessions, 255);

    const existingResponse = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "still available" }),
    });
    assert.equal(existingResponse.status, 200);
    assert.equal(createdSessions, 255);
  } finally {
    if (previousSessionDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousSessionDir;
    }
    await rm(directory, { recursive: true, force: true });
    await close(server);
  }
});

test("Desktop always-allow registry stays within its entry limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-approval-limit-"));
  const previousSessionDir = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = directory;
  const server = createDesktopServer({ session: {
    async run(_message: string, emit: any, options: any = {}) {
      const requestApproval = options.requestApproval;
      for (let index = 0; index < 256; index += 1) {
        await requestApproval({
          tool: "shell",
          input: { command: `command-${index}` },
          key: `approval-key-${index}`,
        });
      }
      await requestApproval({
        tool: "shell",
        input: { command: "command-0" },
        key: "approval-key-0",
      });
      await requestApproval({
        tool: "shell",
        input: { command: "command-over" },
        key: "approval-key-over",
      });
      await requestApproval({
        tool: "shell",
        input: { command: "command-over" },
        key: "approval-key-over",
      });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  }});
  const base = await start(server);
  try {
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "bound approval memory" }),
    });
    let approvalRequests = 0;
    await readSse(chat, async (event) => {
      if (event.type !== "approval-request") return;
      approvalRequests += 1;
      await fetch(`${base}/api/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: event.data.id, decision: "allow-always" }),
      });
    });
    assert.equal(approvalRequests, 258);
  } finally {
    if (previousSessionDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousSessionDir;
    }
    await rm(directory, { recursive: true, force: true });
    await close(server);
  }
});

test("Desktop oversized always-allow keys are not remembered", async () => {
  const server = createDesktopServer({ session: {
    async run(_message: string, emit: any, options: any = {}) {
      const requestApproval = options.requestApproval;
      await requestApproval({
        tool: "shell",
        input: { command: "large-command" },
        key: "k".repeat(513),
      });
      await requestApproval({
        tool: "shell",
        input: { command: "large-command" },
        key: "k".repeat(513),
      });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  }});
  const base = await start(server);
  try {
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "large approval key" }),
    });
    let approvalRequests = 0;
    await readSse(chat, async (event) => {
      if (event.type !== "approval-request") return;
      approvalRequests += 1;
      await fetch(`${base}/api/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: event.data.id, decision: "allow-always" }),
      });
    });
    assert.equal(approvalRequests, 2);
  } finally {
    await close(server);
  }
});

test("POST /api/chat streams SSE events", async () => {
  const server = createDesktopServer({ session: fakeSession() });
  const base = await start(server);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    assert.equal(res.status, 200);
    const contentType = res.headers.get("content-type") || "";
    assert.match(contentType, /text\/event-stream/);
    const text = await res.text();
    const lines = text.split("\n");
    assert.ok(lines.includes("event: token"), "should have token event");
    assert.ok(lines.includes('data: {"token":"hello "}'), "should have hello token");
    assert.ok(lines.includes('data: {"token":"world"}'), "should have world token");
    assert.ok(lines.includes("event: tool"), "should have tool event");
    assert.ok(lines.includes("event: tool-progress"), "should have tool-progress event");
    assert.ok(lines.includes('data: {"name":"echo","progress":4,"total":10}'));
    assert.ok(lines.includes('data: {"name":"echo","progress":5}'));
    assert.ok(lines.includes("event: tool-result"), "should have tool-result event");
    const toolIndex = text.indexOf("event: tool\n");
    const progressIndex = text.indexOf("event: tool-progress\n");
    const resultIndex = text.indexOf("event: tool-result\n");
    assert.ok(toolIndex < progressIndex && progressIndex < resultIndex, "progress must stay between tool and result");
    assert.ok(lines.includes("event: done"), "should have done event");
  } finally {
    await close(server);
  }
});

test("unknown route returns 404", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  } finally {
    await close(server);
  }
});

test("DELETE an active Desktop session returns 409 without ending the chat", async () => {
  let release;
  let started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  const session = {
    async run(_message, emit) {
      emit({ type: "turn", data: { turn: 1 } });
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "keep running" }),
    });
    await running;
    const response = await fetch(`${base}/api/sessions/desktop-default`, {
      method: "DELETE",
    });
    assert.equal(response.status, 409);
    const body: any = await response.json();
    assert.match(body.error, /already running/);
    release();
    await chat.text();
  } finally {
    release?.();
    await close(server);
  }
});

test("rename an active Desktop session returns 409 without ending the chat", async () => {
  let release;
  let started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  const session = {
    async run(_message, emit) {
      emit({ type: "turn", data: { turn: 1 } });
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "keep running" }),
    });
    await running;
    const response = await fetch(`${base}/api/sessions/desktop-default/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "renamed-active" }),
    });
    assert.equal(response.status, 409);
    const body: any = await response.json();
    assert.match(body.error, /already running/);
    release();
    await chat.text();
  } finally {
    release?.();
    await close(server);
  }
});
