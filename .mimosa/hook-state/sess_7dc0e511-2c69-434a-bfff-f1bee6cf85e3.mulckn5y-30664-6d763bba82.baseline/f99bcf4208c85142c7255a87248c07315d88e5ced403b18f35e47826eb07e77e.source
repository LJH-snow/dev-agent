import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { McpRequestError, McpStdioClient } from "../dist/index.js";

// `import.meta.url` points at the compiled tests-dist/ copy.
const silentServer = fileURLToPath(new URL("../tests/silent-mcp-server.mjs", import.meta.url));
const slowServer = fileURLToPath(new URL("../tests/slow-mcp-server.mjs", import.meta.url));

test("a request to an unresponsive server times out instead of hanging", async () => {
  const client = new McpStdioClient();
  try {
    // initialize is answered, everything after it is not.
    await client.connect({
      command: process.execPath,
      args: [silentServer],
      name: "silent",
      env: { MOCK_MCP_ANSWER_INITIALIZE: "1" },
      timeoutMs: 250,
    });

    await assert.rejects(
      () => client.listTools(),
      (error: unknown) => {
        assert.ok(error instanceof McpRequestError);
        assert.equal(error.code, -32000);
        assert.match(error.message, /tools\/list/, "the message names the method");
        assert.match(error.message, /timed out after 250ms/);
        return true;
      }
    );
  } finally {
    await client.close();
  }
});

test("a timed-out request is removed from the pending set", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({
      command: process.execPath,
      args: [silentServer],
      name: "silent",
      env: { MOCK_MCP_ANSWER_INITIALIZE: "1" },
      timeoutMs: 200,
    });
    await client.listTools().catch(() => undefined);

    assert.equal(client.pendingRequestCount, 0, "a timed-out request must not linger");
  } finally {
    await client.close();
  }
});

test("initialize that never answers rejects rather than hanging", async () => {
  const client = new McpStdioClient();
  try {
    const started = Date.now();
    await assert.rejects(
      () =>
        client.connect({
          command: process.execPath,
          args: [silentServer],
          name: "silent",
          timeoutMs: 200,
        }),
      (error: unknown) => {
        assert.ok(error instanceof McpRequestError);
        assert.match(error.message, /timed out/);
        return true;
      }
    );
    assert.ok(Date.now() - started < 3000, "must fail fast, not wait for the server");
  } finally {
    await client.close();
  }
});

test("a slow but in-time response still succeeds", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({
      command: process.execPath,
      args: [slowServer],
      name: "slow",
      env: { MOCK_MCP_DELAY_MS: "250" },
      timeoutMs: 5000,
    });
    const tools = await client.listTools();

    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "slow-tool");
  } finally {
    await client.close();
  }
});
