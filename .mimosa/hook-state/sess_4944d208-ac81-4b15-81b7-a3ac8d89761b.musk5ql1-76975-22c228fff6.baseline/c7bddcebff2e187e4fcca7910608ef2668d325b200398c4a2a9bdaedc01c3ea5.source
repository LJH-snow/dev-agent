import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { McpStdioClient, McpRequestError } from "../dist/index.js";

const fakeServer = fileURLToPath(new URL("../tests/fake-mcp-server.mjs", import.meta.url));

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
      () => (client as any).request("unknown/method", {}),
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

test("callTool includes descriptive server text in tool failures", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({
      command: process.execPath,
      args: [fakeServer],
      env: { MCP_INCLUDE_FAILURE_TOOLS: "1" },
    });
    await assert.rejects(
      () => client.callTool("failing", {}),
      (error) => {
        assert.ok(error instanceof McpRequestError);
        assert.equal(error.code, -32603);
        assert.equal(
          error.message,
          'MCP tool "failing" failed: permission denied: cannot read /etc/shadow (EACCES)'
        );
        return true;
      }
    );
  } finally {
    await client.close();
  }
});

test("callTool concatenates multiple server error text blocks in order", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({
      command: process.execPath,
      args: [fakeServer],
      env: { MCP_INCLUDE_FAILURE_TOOLS: "1" },
    });
    await assert.rejects(
      () => client.callTool("failing", { mode: "multi" }),
      (error) => {
        assert.ok(error instanceof McpRequestError);
        assert.match(
          error.message,
          /MCP tool "failing" failed: permission denied\ncannot read \/etc\/shadow \(EACCES\)/
        );
        return true;
      }
    );
  } finally {
    await client.close();
  }
});

test("callTool falls back to the generic message when a failure has no text", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({
      command: process.execPath,
      args: [fakeServer],
      env: { MCP_INCLUDE_FAILURE_TOOLS: "1" },
    });
    await assert.rejects(
      () => client.callTool("silent-failure", {}),
      (error) => {
        assert.ok(error instanceof McpRequestError);
        assert.equal(error.code, -32603);
        assert.equal(error.message, 'MCP tool "silent-failure" reported an error');
        return true;
      }
    );
  } finally {
    await client.close();
  }
});

test("callTool truncates an oversized server error detail", async () => {
  const client = new McpStdioClient();
  try {
    await client.connect({
      command: process.execPath,
      args: [fakeServer],
      env: { MCP_INCLUDE_FAILURE_TOOLS: "1" },
    });
    await assert.rejects(
      () => client.callTool("failing", { mode: "long" }),
      (error) => {
        assert.ok(error instanceof McpRequestError);
        assert.ok(error.message.endsWith("… (truncated)"));
        assert.equal(
          error.message.length,
          'MCP tool "failing" failed: '.length + 2000 + "… (truncated)".length
        );
        return true;
      }
    );
  } finally {
    await client.close();
  }
});
