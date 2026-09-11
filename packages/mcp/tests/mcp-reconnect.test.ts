import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { McpServerSession, McpStdioClient } from "../dist/index.js";

const flakyServer = fileURLToPath(new URL("../tests/flaky-mcp-server.mjs", import.meta.url));
const fakeServer = fileURLToPath(new URL("../tests/fake-mcp-server.mjs", import.meta.url));

test("MCP session reconnects with backoff after server fails on first initialize", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "dev-agent-flaky-"));
  const stateFile = join(stateDir, "state.txt");
  writeFileSync(stateFile, "0", "utf8");

  const session = new McpServerSession({
    config: {
      command: process.execPath,
      args: [flakyServer],
      name: "flaky",
      env: { FLAKY_STATE_FILE: stateFile },
    },
  });

  try {
    const snapshot = await session.reconnect();
    assert.equal(snapshot.tools.length, 1);
    assert.equal(snapshot.tools[0].name, "ping");
    assert.equal(session.serverInfo?.name, "flaky");
  } finally {
    await session.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("MCP client reconnect preserves tool listing and server info", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({ command: process.execPath, args: [fakeServer], name: "fake" });
    assert.equal((await client.listTools()).length, 3);

    await client.reconnect();

    const tools = await client.listTools();
    assert.equal(tools.length, 3);
    assert.equal(client.getServerInfo()?.name, "fake");
  } finally {
    await client.close();
  }
});

test("MCP client reconnect throws when no previous configuration exists", async () => {
  const client = new McpStdioClient();
  await assert.rejects(() => client.reconnect(), /no previous configuration/);
});

test("a crashed server rejects pending calls after a client reconnect", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({ command: process.execPath, args: [fakeServer], name: "fake" });
    await client.reconnect();

    const outcome = await Promise.race([
      client.callTool("crash", {}).then(
        () => "resolved",
        (error) => error
      ),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 2000)),
    ]);

    assert.ok(outcome instanceof Error, `expected a rejection, got ${outcome}`);
    assert.match(outcome.message, /exited/);
  } finally {
    await client.close();
  }
});
