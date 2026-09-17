import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMcpCommand,
  listMcpServers,
  statusMcpServers,
  testMcpServers,
  validateMcpServers,
  type McpCapabilitySummary,
  type McpManagementConfig,
} from "../dist/mcp-command.js";

const SECRET = "mcp-secret-value";
const ABSOLUTE_COMMAND = "/Users/Admin/.local/bin/untrusted-mcp-server";
const ABSOLUTE_PATH = "/Users/Admin/Desktop/private-project";

function json(value: unknown): string {
  return JSON.stringify(value);
}

const config: McpManagementConfig = {
  mcpServers: [
    {
      name: "filesystem",
      command: ABSOLUTE_COMMAND,
      args: ["--root", ABSOLUTE_PATH],
      env: { MCP_TOKEN: SECRET, HOME: ABSOLUTE_PATH },
      timeoutMs: 250,
    },
  ],
};

test("mcp list is metadata-only and redacts commands, args, env values, and absolute paths", () => {
  let hookCalls = 0;
  const result = listMcpServers({
    config,
    connector: async () => {
      hookCalls += 1;
      return {};
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.command, "mcp list");
  assert.equal(result.status, "ok");
  assert.equal(result.servers.length, 1);
  assert.equal(hookCalls, 0);
  assert.equal(result.servers[0]?.name, "filesystem");
  assert.equal(result.servers[0]?.commandConfigured, true);
  assert.equal(result.servers[0]?.argumentCount, 2);
  assert.equal(result.servers[0]?.environmentVariableCount, 2);
  assert.equal(result.servers[0]?.timeoutMs, 250);
  assert.doesNotMatch(json(result), /untrusted-mcp-server|mcp-secret-value|private-project|--root/);
  assert.doesNotMatch(json(result), /\/Users\/|[A-Za-z]:\\/);
});

test("mcp list and status return a stable no-server result without starting anything", async () => {
  const listed = listMcpServers({ config: {} });
  assert.equal(listed.ok, true);
  assert.equal(listed.status, "empty");
  assert.equal(listed.reason, "no_servers");
  assert.deepEqual(listed.servers, []);
  assert.deepEqual(listed.summary, {
    total: 0,
    ready: 0,
    configured: 0,
    invalid: 0,
    skipped: 0,
    failed: 0,
    timedOut: 0,
    changed: 0,
  });

  let probeCalls = 0;
  const status = await statusMcpServers({
    config: {},
    probe: async () => {
      probeCalls += 1;
      return { ok: true };
    },
  });
  assert.equal(status.ok, true);
  assert.equal(status.status, "empty");
  assert.equal(status.reason, "no_servers");
  assert.equal(probeCalls, 0);
});

test("mcp validate reports stable invalid configuration metadata without invoking a connector", () => {
  let connectorCalls = 0;
  const result = validateMcpServers({
    config: {
      mcpServers: [
        { name: "missing-command" } as never,
        { name: "bad-args", command: "node", args: ["ok", 42] as never },
        { name: "bad-env", command: "node", env: { TOKEN: SECRET, PORT: 3000 } as never },
        { name: "bad-timeout", command: "node", timeoutMs: 0 },
      ],
    },
    connector: async () => {
      connectorCalls += 1;
      return {};
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.command, "mcp validate");
  assert.equal(result.status, "invalid");
  assert.equal(result.reason, "invalid_config");
  assert.equal(result.summary.invalid, 4);
  assert.equal(connectorCalls, 0);
  assert.ok(result.servers.every((server) => server.state === "invalid"));
  assert.doesNotMatch(json(result), /mcp-secret-value|MCP_TOKEN|private-project|\/Users\//);
});

test("mcp status uses an injected probe and returns a capability summary without raw config", async () => {
  let receivedCommand = "";
  const result = await statusMcpServers({
    config,
    probe: async (context) => {
      receivedCommand = context.server.command;
      return {
        ok: true,
        snapshot: {
          serverInfo: { name: ABSOLUTE_PATH, version: "1.2.3" },
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: true },
            prompts: {},
            logging: {},
          },
          counts: { tools: 3, resources: 2, prompts: 1 },
        },
      };
    },
  });

  assert.equal(receivedCommand, ABSOLUTE_COMMAND);
  assert.equal(result.ok, true);
  assert.equal(result.status, "ok");
  assert.equal(result.reason, null);
  assert.equal(result.servers[0]?.state, "ready");
  assert.deepEqual(result.servers[0]?.capabilities, {
    tools: true,
    resources: true,
    prompts: true,
    logging: true,
    roots: false,
    sampling: false,
    experimental: false,
    toolCount: 3,
    resourceCount: 2,
    promptCount: 1,
  });
  assert.deepEqual(result.servers[0]?.serverInfo, {
    name: "<redacted-path>",
    version: "1.2.3",
  });
  assert.doesNotMatch(json(result), /untrusted-mcp-server|mcp-secret-value|private-project|\/Users\//);
});

test("mcp test supports an injected connector and reports a successful metadata-only result", async () => {
  let receivedTimeout = 0;
  let receivedSignal = false;
  const result = await testMcpServers({
    config,
    connector: async (context) => {
      receivedTimeout = context.timeoutMs;
      receivedSignal = context.signal instanceof AbortSignal;
      return {
        serverInfo: { name: "safe-server", version: "0.1.0" },
        capabilities: { tools: {}, resources: {} },
        counts: { tools: 1, resources: 0, prompts: 0 },
      };
    },
  });

  assert.equal(receivedTimeout, 250);
  assert.equal(receivedSignal, true);
  assert.equal(result.ok, true);
  assert.equal(result.command, "mcp test");
  assert.equal(result.servers[0]?.state, "ready");
  assert.equal(result.servers[0]?.latencyMs !== null, true);
  assert.equal(result.servers[0]?.capabilities?.toolCount, 1);
  assert.equal(result.servers[0]?.serverInfo?.name, "safe-server");
});

test("mcp test converts an unresponsive injected connector into a stable timeout result", async () => {
  const result = await testMcpServers({
    config: { mcpServers: [{ name: "slow", command: "node", timeoutMs: 10 }] },
    connector: () => new Promise(() => undefined),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "timeout");
  assert.equal(result.servers[0]?.state, "timeout");
  assert.equal(result.servers[0]?.reason, "timeout");
  assert.equal(result.servers[0]?.timeoutMs, 10);
  assert.equal(result.summary.timedOut, 1);
});

test("mcp test reports connection failures using a stable reason without leaking thrown details", async () => {
  const result = await testMcpServers({
    config,
    connector: async () => {
      throw new Error(`failed with ${SECRET} at ${ABSOLUTE_PATH}`);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "connection_failed");
  assert.equal(result.servers[0]?.state, "failed");
  assert.equal(result.servers[0]?.reason, "connection_failed");
  assert.doesNotMatch(json(result), /mcp-secret-value|private-project|failed with/);
});

const baseline: McpCapabilitySummary = {
  tools: true,
  resources: false,
  prompts: false,
  logging: false,
  roots: false,
  sampling: false,
  experimental: false,
  toolCount: 2,
  resourceCount: 0,
  promptCount: 0,
};

test("mcp status reports capability changes as a stable structured result", async () => {
  const result = await statusMcpServers({
    config,
    capabilityBaselines: { filesystem: baseline },
    probe: async () => ({
      ok: true,
      snapshot: {
        capabilities: { tools: {}, resources: {}, prompts: {} },
        counts: { tools: 3, resources: 0, prompts: 0 },
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "degraded");
  assert.equal(result.reason, "capability_changed");
  assert.equal(result.servers[0]?.state, "changed");
  assert.equal(result.servers[0]?.reason, "capability_changed");
  assert.deepEqual(result.servers[0]?.capabilityChange, {
    changed: true,
    fields: ["resources", "prompts", "toolCount"],
  });
});

test("executeMcpCommand dispatches all management actions and skips active probes by default", async () => {
  const commands = ["list", "status", "validate", "test"] as const;
  for (const action of commands) {
    const result = await executeMcpCommand(action, { config });
    assert.equal(result.command, `mcp ${action}`);
    if (action === "test" || action === "status") {
      assert.equal(result.status, "skipped");
      assert.equal(result.reason, "probe_not_configured");
    }
  }
});
