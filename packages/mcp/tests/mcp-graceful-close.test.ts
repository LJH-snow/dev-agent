import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { McpStdioClient } from "../dist/index.js";

const fakeServer = fileURLToPath(new URL("../tests/fake-mcp-server.mjs", import.meta.url));

test("close is idempotent and does not throw on already-exited server", async () => {
  const client = new McpStdioClient();
  await client.connect({ command: process.execPath, args: [fakeServer] });
  await client.close();
  await client.close();
  assert.equal(client.isConnected(), false);
});

test("operations after close report not-connected state", async () => {
  const client = new McpStdioClient();
  await client.connect({ command: process.execPath, args: [fakeServer] });
  await client.close();
  assert.equal(client.isConnected(), false);
  assert.equal(client.pendingRequestCount, 0);
});

test("server exit does not reject pending requests after close", async () => {
  const client = new McpStdioClient();
  await client.connect({ command: process.execPath, args: [fakeServer] });
  const tools = await client.listTools();
  assert.equal(tools.length, 3);
  await client.close();
});
