import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDesktopStatus } from "../dist/status.js";
import { createDesktopServer } from "../dist/server.js";
import { resolveTarget } from "@dev-agent/runtime-manager";

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

function expectedManagedRuntimeTarget(): string {
  const resolution = resolveTarget({
    platform: process.platform,
    arch: process.arch,
    libc: process.platform === "linux" ? "glibc" : "none",
  });
  if (!resolution.supported) {
    throw new Error("test environment must resolve a supported runtime target");
  }
  return resolution.target;
}

test("GET /api/status returns the metadata-only desktop status payload", async () => {
  const session = {
    executorMode: "sandboxed-macos" as const,
    getStatus: () => createDesktopStatus({
      sessionId: "desktop-default",
      executorMode: "sandboxed-macos",
      providerId: "openai",
      model: "gpt-4o-mini",
      approvalMode: "ask",
      validationPolicy: "default",
    }),
    async run() {},
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const payload = (await response.json()) as any;
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.metadataOnly, true);
    assert.deepEqual(payload.executor, { mode: "sandboxed-macos" });
    assert.deepEqual(payload.runtime.kind, "node");
    assert.deepEqual(payload.provider, { id: "openai", state: "ready" });
    assert.deepEqual(payload.model, { id: "gpt-4o-mini", state: "ready" });
    assert.deepEqual(payload.approval, { mode: "ask", guarded: true });
    assert.deepEqual(payload.validation, { policy: "default", enabled: true, lastResult: "unknown" });
    assert.equal(payload.session.running, false);
    assert.deepEqual(payload.managedRuntime?.state, "missing");
    assert.equal(payload.managedRuntime?.version, undefined);
    assert.equal(payload.managedRuntime?.target, expectedManagedRuntimeTarget());

    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /api[-_ ]?key|token|secret|Users|home|tmp|provider exploded/i);
  } finally {
    await close(server);
  }
});

test("GET /api/status rejects an unknown session without exposing internals", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status?sessionId=missing-session`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "unknown session" });
  } finally {
    await close(server);
  }
});

test("GET /api/status restores a persisted session selected from the session list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-status-session-"));
  const previousDirectory = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = directory;
  await writeFile(join(directory, "persisted.json"), "{}");
  let createdSessionId: string | undefined;
  const server = createDesktopServer({
    session: { async run() {} },
    createSession(sessionId) {
      createdSessionId = sessionId;
      return {
        id: sessionId,
        getStatus: () => createDesktopStatus({ sessionId }),
        async run() {},
      };
    },
  });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status?sessionId=persisted`);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as any;
    assert.equal(payload.session.id, "persisted");
    assert.equal(createdSessionId, "persisted");
  } finally {
    await close(server);
    if (previousDirectory === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousDirectory;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("GET /api/status turns an internal status failure into a stable 500", async () => {
  const server = createDesktopServer({
    session: {
      async run() {},
      getStatus() {
        throw new Error("secret error at /tmp/dev-agent with sk-test-secret");
      },
    },
  });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status`);
    assert.equal(response.status, 500);
    const body = (await response.json()) as any;
    assert.deepEqual(body, { error: "request failed" });
  } finally {
    await close(server);
  }
});

test("GET /api/status injects managed runtime metadata safely", async () => {
  const session = {
    getStatus: () => createDesktopStatus({ sessionId: "desktop-default" }),
    async run() {},
  };
  const server = createDesktopServer({
    session,
    managedRuntime: async () => ({
      state: "corrupt",
      version: "/Users/Admin/runtime/0.2.0",
      target: "/tmp/runtime" as unknown as "aarch64-apple-darwin",
      reason: "provider exploded at /Users/Admin/runtime/0.2.0",
    }),
  });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status`);
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.deepEqual(payload.managedRuntime, { state: "corrupt" });
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /api[-_ ]?key|token|secret|Users|home|tmp/i);
  } finally {
    await close(server);
  }
});

test("GET / exposes the runtime status panel", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    for (const id of [
      "desktop-status-panel",
      "desktop-status-executor",
      "desktop-status-runtime",
      "desktop-status-managed-runtime",
      "desktop-status-provider",
      "desktop-status-model",
      "desktop-status-approval",
      "desktop-status-validation",
      "desktop-status-refresh",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /\/api\/status\?sessionId/);
    assert.match(html, /Metadata only — no keys, paths, source, or raw errors are shown/);
  } finally {
    await close(server);
  }
});

test("GET / marks runtime status refresh state accessibly", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /desktopStatusRefreshButton\.setAttribute\("aria-busy", "true"\)/);
    assert.match(html, /desktopStatusRefreshButton\.setAttribute\("aria-busy", "false"\)/);
  } finally {
    await close(server);
  }
});

test("GET / guards desktop status responses against stale sessions", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /let desktopStatusRequestId = 0/);
    assert.match(html, /let desktopStatusController = null/);
    assert.match(html, /const requestId = \+\+desktopStatusRequestId/);
    assert.match(html, /desktopStatusController\?\.abort\(\)/);
    assert.match(html, /desktopStatusController = controller/);
    assert.match(html, /cache: "no-store", signal: controller\.signal/);
    assert.match(html, /requestId !== desktopStatusRequestId \|\| sessionId !== currentSessionId/);
  } finally {
    await close(server);
  }
});

test("GET / guards desktop session history responses against stale sessions", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /let desktopHistoryRequestId = 0/);
    assert.match(html, /let desktopHistoryController = null/);
    assert.match(html, /const requestId = \+\+desktopHistoryRequestId/);
    assert.match(html, /desktopHistoryController\?\.abort\(\)/);
    assert.match(html, /desktopHistoryController = controller/);
    assert.match(html, /cache: "no-store", signal: controller\.signal/);
    assert.match(html, /requestId !== desktopHistoryRequestId \|\| sessionId !== currentSessionId/);
  } finally {
    await close(server);
  }
});

test("GET /api/status keeps a legacy session executor unknown without internals", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status`);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as any;
    assert.deepEqual(payload.executor, { mode: "unknown" });
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /Users|home|tmp|raw error|stack/i);
  } finally {
    await close(server);
  }
});

test("GET / renders the status payload executor mode", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /id="desktop-status-executor"/);
    assert.match(
      html,
      /setDesktopStatusValue\(desktopStatusExecutor, desktopStatusExecutorState, payload\.executor\.mode, payload\.session\?\.running \? "running" : "idle"\)/
    );
    assert.match(html, /payload\.executor && payload\.runtime/);
  } finally {
    await close(server);
  }
});

test("GET /api/status exposes a safe workspace label", async () => {
  const session = {
    getStatus: () => createDesktopStatus({ sessionId: "desktop-default", workspaceLabel: "dev-agent" }),
    async run() {},
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status`);
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.deepEqual(payload.workspace, { label: "dev-agent" });
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /Users|home|tmp/i);
  } finally {
    await close(server);
  }
});

test("GET /api/status exposes a safe MCP summary", async () => {
  const session = {
    getStatus: () => createDesktopStatus({ sessionId: "desktop-default", mcpConfigured: 1, mcpConnected: 1 }),
    async run() {},
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status`);
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.deepEqual(payload.mcp, { configured: 1, connected: 1 });
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /command|args|env|Users|home|tmp/i);
  } finally {
    await close(server);
  }
});

test("GET / renders safe session evidence summaries", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /function formatSessionSummary\(summary\)/);
    assert.match(html, /summary\?\.entryCount/);
    assert.match(html, /evidence\?\.validations/);
    assert.match(html, /evidence\?\.changeSets/);
    assert.match(html, /evidence\?\.protectedChangeSets/);
    assert.match(html, /session\.sessionId \+ " \(" \+ summaryText \+ "\)"/);
  } finally {
    await close(server);
  }
});

test("GET / translates managed runtime states into safe next actions", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /id="desktop-status-managed-runtime-guidance"/);
    assert.match(html, /managedRuntimeGuidance\(payload\.managedRuntime\?\.state\)/);
    const guidance = new Map<string, string>([
      ["installed", "Ready to use."],
      ["missing", "Run `dev-agent runtime install` to set it up."],
      ["unsupported", "This platform or architecture is not supported."],
      ["corrupt", "Recheck status, then repair or reinstall if needed."],
      ["unavailable", "Refresh status; check runtime health if it stays unavailable."],
    ]);
    for (const [state, text] of guidance) {
      const pattern = new RegExp(`case "${state}":[\\s\\S]*?${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
      assert.match(html, pattern);
    }
  } finally {
    await close(server);
  }
});
