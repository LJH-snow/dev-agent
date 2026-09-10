import assert from "node:assert/strict";
import test from "node:test";

import { createMcpServer } from "../dist/index.js";

function echoTool() {
  return {
    name: "echo",
    description: "Echoes the text it receives.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    async execute(input) {
      return { echoed: input?.text ?? null };
    },
  };
}

function failingTool() {
  return {
    name: "boom",
    description: "Always fails.",
    async execute() {
      throw new Error("kaboom");
    },
  };
}

async function request(server, message) {
  const response = await server.handleMessage(JSON.stringify(message));
  return response === undefined ? undefined : JSON.parse(response);
}

test("initialize returns the protocol version, capabilities, and server info", async () => {
  const server = createMcpServer({ tools: [echoTool()], version: "9.9.9" });

  const response = await request(server, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, "2024-11-05");
  assert.equal(response.result.serverInfo.name, "dev-agent");
  assert.equal(response.result.serverInfo.version, "9.9.9");
  assert.ok(response.result.capabilities.tools);
});

test("tools/list lists the tools with their schemas", async () => {
  const server = createMcpServer({ tools: [echoTool(), failingTool()] });

  const response = await request(server, { jsonrpc: "2.0", id: 2, method: "tools/list" });

  assert.deepEqual(
    response.result.tools.map((tool) => tool.name),
    ["echo", "boom"]
  );
  assert.equal(response.result.tools[0].description, "Echoes the text it receives.");
  assert.equal(response.result.tools[0].inputSchema.properties.text.type, "string");
  // Tools without a schema still advertise an object schema.
  assert.equal(response.result.tools[1].inputSchema.type, "object");
});

test("tools/call executes a tool and returns its result", async () => {
  const server = createMcpServer({ tools: [echoTool()] });

  const response = await request(server, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "echo", arguments: { text: "hi" } },
  });

  assert.equal(response.result.isError, undefined);
  assert.deepEqual(response.result.structuredContent, { echoed: "hi" });
  assert.equal(response.result.content[0].type, "text");
  assert.equal(response.result.content[0].text, '{"echoed":"hi"}');
});

test("tools/call reports a failing tool as an error result", async () => {
  const server = createMcpServer({ tools: [failingTool()] });

  const response = await request(server, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "boom" },
  });

  assert.equal(response.result.isError, true);
  assert.equal(response.result.content[0].text, "kaboom");
});

test("calling an unknown tool is an invalid-params error", async () => {
  const server = createMcpServer({ tools: [echoTool()] });

  const response = await request(server, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "missing" },
  });

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /unknown tool: missing/);
});

test("unknown methods return a JSON-RPC error and notifications get no response", async () => {
  const server = createMcpServer({ tools: [echoTool()] });

  const unknown = await request(server, { jsonrpc: "2.0", id: 6, method: "nope" });
  assert.equal(unknown.error.code, -32601);

  const notification = await server.handleMessage(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
  );
  assert.equal(notification, undefined);
});
