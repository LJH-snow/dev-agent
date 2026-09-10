import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { McpStdioClient, McpRequestError } from "../dist/index.js";

const fakeServer = fileURLToPath(new URL("./fake-mcp-server.mjs", import.meta.url));

test("callTool surfaces server error code via McpRequestError", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({ command: process.execPath, args: [fakeServer] });
    await assert.rejects(
      () => client.callTool("unknown-tool", {}),
      (error) => {
        assert.ok(error instanceof McpRequestError, "expected McpRequestError");
        assert.equal(error.code, -32602);
        assert.match(error.message, /Unknown tool/);
        return true;
      }
    );
  } finally {
    await client.close();
  }
});

test("McpRequestError preserves code and message", () => {
  const error = new McpRequestError(-32601, "Method not found");
  assert.equal(error.code, -32601);
  assert.equal(error.message, "Method not found");
  assert.equal(error.name, "McpRequestError");
});

test("request rejects with McpRequestError on JSON-RPC error", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({ command: process.execPath, args: [fakeServer] });
    await assert.rejects(
      () => client.request("unknown/method", {}),
      (error) => {
        assert.ok(error instanceof McpRequestError);
        assert.equal(error.code, -32601);
        return true;
      }
    );
  } finally {
    await client.close();
  }
});
