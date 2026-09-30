import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createMcpHealthSnapshot,
  normalizeMcpHealthSnapshot,
} from "../dist/mcp-health.js";
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

test("MCP health snapshots are bounded, metadata-only, and fail closed", () => {
  const snapshot = normalizeMcpHealthSnapshot({
    checkedAt: "2026-09-25T12:00:00.000Z",
    servers: [
      {
        name: "safe-server",
        state: "connected",
        tools: 12_345,
        resources: 9,
        prompts: 3,
        latencyMs: 99_999,
        lastCheckedAt: "2026-09-25T12:00:01.000Z",
        error: "raw secret error",
        command: "should-not-appear",
        env: { TOKEN: "secret" },
      },
      { name: "/private/path", state: "connected" },
      { name: "bad", state: "unknown" },
    ],
  });
  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    metadataOnly: true,
    configured: 1,
    connected: 1,
    degraded: 0,
    checkedAt: "2026-09-25T12:00:00.000Z",
    servers: [{
      name: "safe-server",
      state: "connected",
      tools: 10_000,
      resources: 9,
      prompts: 3,
      latencyMs: 60_000,
      lastCheckedAt: "2026-09-25T12:00:01.000Z",
    }],
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /command|TOKEN|secret|private/);
  assert.deepEqual(createMcpHealthSnapshot(), {
    schemaVersion: 1,
    metadataOnly: true,
    configured: 0,
    connected: 0,
    degraded: 0,
    servers: [],
  });
});

test("GET /api/mcp/health exposes only the session-bound MCP health projection", async () => {
  let checks = 0;
  const session = {
    id: "mcp-health-session",
    async checkMcpHealth() {
      checks += 1;
      return createMcpHealthSnapshot([
        {
          name: "docs",
          state: "degraded",
          tools: 2,
          resources: 1,
          prompts: 0,
          latencyMs: 2500,
          error: "ping-timeout",
          lastCheckedAt: "2026-09-25T12:00:00.000Z",
        },
      ], "2026-09-25T12:00:00.000Z");
    },
    async run() {},
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/mcp/health?sessionId=mcp-health-session`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const payload = await response.json() as any;
    assert.equal(checks, 1);
    assert.equal(payload.metadataOnly, true);
    assert.deepEqual(payload.servers, [{
      name: "docs",
      state: "degraded",
      tools: 2,
      resources: 1,
      prompts: 0,
      latencyMs: 2500,
      error: "ping-timeout",
      lastCheckedAt: "2026-09-25T12:00:00.000Z",
    }]);
    assert.equal(payload.configured, 1);
    assert.equal(payload.connected, 0);
    assert.equal(payload.degraded, 1);
    assert.doesNotMatch(JSON.stringify(payload), /command|args|env|TOKEN|secret|Users|home|tmp/i);
  } finally {
    await close(server);
  }
});

test("GET /api/mcp/health rejects unknown sessions without revealing internals", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/mcp/health?sessionId=missing-session`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "unknown session" });
  } finally {
    await close(server);
  }
});

test("Desktop exposes a refreshable bilingual MCP health panel without mutation controls", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="mcp-health-panel"|class="mcp-health-panel"/);
  assert.match(html, /id="mcp-health-summary"/);
  assert.match(html, /id="mcp-health-refresh"/);
  assert.match(html, /id="mcp-health-list"/);
  assert.match(html, /\/api\/mcp\/health\?sessionId=/);
  assert.match(html, /mcpHealth\.state\.connected/);
  assert.match(html, /mcpHealth\.state\.degraded/);
  assert.match(html, /mcpHealth\.state\.disconnected/);
  assert.match(styles, /\.mcp-health-list/);
  assert.match(styles, /\.mcp-health-server-state\[data-state="degraded"\]/);
  assert.doesNotMatch(html, /\/api\/mcp\/health[^\n]*method:\s*["'](?:POST|PUT|DELETE)/);
});
