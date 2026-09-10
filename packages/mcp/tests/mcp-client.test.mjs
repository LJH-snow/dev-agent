import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { McpServerSession, McpStdioClient } from "../dist/index.js";

const fakeServer = fileURLToPath(new URL("./fake-mcp-server.mjs", import.meta.url));

test("MCP client connects, lists tools, calls a tool, and closes", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({
      command: process.execPath,
      args: [fakeServer],
      env: {
        DEV_AGENT_WORKING_DIRECTORY: "/tmp/work",
        DEV_AGENT_SESSION_ID: "session-1",
        MCP_TEST_ENV: "extra",
      },
    });

    const tools = await client.listTools();
    assert.equal(tools.length, 3);
    assert.equal(tools[0].name, "hello");

    const result = await tools[0].execute({ name: "dev-agent" });
    assert.match(JSON.stringify(result), /hello/);

    const envTool = tools.find((tool) => tool.name === "env");
    const envResult = await envTool.execute({});
    assert.match(JSON.stringify(envResult), /\/tmp\/work\|session-1\|extra/);

    const resources = await client.listResources();
    assert.equal(resources.length, 1);
    assert.equal(resources[0].info.name, "hello");

    const resource = await resources[0].read();
    assert.equal(resource.mimeType, "text/markdown");
    assert.match(String(resource.text), /Hello from resources/);

    const prompts = await client.listPrompts();
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].info.name, "summary");

    const promptResult = await prompts[0].get({ topic: "MCP" });
    assert.match(JSON.stringify(promptResult), /Summarize: MCP/);

    await client.ping();
  } finally {
    await client.close();
  }
});

test("MCP client captures server capabilities and server info from initialize", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({
      command: process.execPath,
      args: [fakeServer],
    });

    const info = client.getServerInfo();
    assert.ok(info);
    assert.equal(info.name, "fake");
    assert.equal(info.version, "0.0.1");

    const capabilities = client.getServerCapabilities();
    assert.ok(capabilities);
    assert.equal(capabilities.tools?.listChanged, true);
    assert.equal(capabilities.resources?.listChanged, true);
    assert.equal(capabilities.prompts?.listChanged, true);
  } finally {
    await client.close();
  }
});

test("MCP client reconnects with the same configuration", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({
      command: process.execPath,
      args: [fakeServer],
      env: { MCP_TEST_ENV: "first" },
    });
    assert.equal((await client.listTools()).length, 3);

    await client.reconnect();

    const tools = await client.listTools();
    assert.equal(tools.length, 3);
    const envTool = tools.find((tool) => tool.name === "env");
    const envResult = await envTool.execute({});
    assert.match(JSON.stringify(envResult), /first/);

    assert.equal(client.getServerInfo()?.name, "fake");
  } finally {
    await client.close();
  }
});

test("MCP client receives server notifications via onNotification", async () => {
  const client = new McpStdioClient();
  const received = [];
  client.onNotification((notification) => {
    received.push(notification);
  });

  try {
    await client.connect({
      command: process.execPath,
      args: [fakeServer],
    });

    const tools = await client.listTools();
    const notifyTool = tools.find((tool) => tool.name === "notify");
    assert.ok(notifyTool, "expected notify tool to be listed");
    await notifyTool.execute({});

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(
      received.some((n) => n.method === "tools/list_changed"),
      `expected tools/list_changed notification, got ${JSON.stringify(received)}`
    );
  } finally {
    await client.close();
  }
});

test("MCP server session re-registers tools when the server emits list_changed", async () => {
  const session = new McpServerSession({
    config: { command: process.execPath, args: [fakeServer], name: "fake" },
  });

  const snapshots = [];
  session.onChange((snapshot) => {
    snapshots.push(snapshot);
  });

  try {
    const initial = await session.connect();
    assert.equal(initial.tools.length, 3);
    assert.equal(snapshots.length, 1);

    const tools = await session.getClient().listTools();
    const notifyTool = tools.find((tool) => tool.name === "notify");
    assert.ok(notifyTool, "expected notify tool to exist");
    await notifyTool.execute({});

    await new Promise((resolve) => setTimeout(resolve, 700));

    const snapshot = session.getSnapshot();
    assert.equal(snapshot.tools.length, 3);
    assert.ok(
      snapshots.length >= 2,
      `expected at least 2 snapshots after list_changed, got ${snapshots.length}`
    );
  } finally {
    await session.close();
  }
});
