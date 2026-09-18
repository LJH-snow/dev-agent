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

function sampleServer() {
  return createMcpServer({
    tools: [echoTool()],
    resources: [
      {
        uri: "dev-agent://session",
        name: "Session",
        description: "Session details.",
        mimeType: "text/plain",
        read: () => "session: test\nentries: 2",
      },
    ],
    prompts: [
      {
        name: "explain-codebase",
        description: "Explain the codebase.",
        arguments: [{ name: "focus", description: "Area to focus on" }],
        get: (args) => ({
          description: "Explain it.",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Explain the codebase${args?.focus ? ` (${args.focus})` : ""}`,
              },
            },
          ],
        }),
      },
    ],
  });
}

test("initialize advertises the resources and prompts capabilities", async () => {
  const server = sampleServer();

  const response = await request(server, { jsonrpc: "2.0", id: 10, method: "initialize" });

  assert.ok(response.result.capabilities.tools);
  assert.ok(response.result.capabilities.resources);
  assert.ok(response.result.capabilities.prompts);
});

test("resources/list lists the configured resources", async () => {
  const server = sampleServer();

  const response = await request(server, { jsonrpc: "2.0", id: 11, method: "resources/list" });

  assert.equal(response.result.resources.length, 1);
  assert.equal(response.result.resources[0].uri, "dev-agent://session");
  assert.equal(response.result.resources[0].name, "Session");
  assert.equal(response.result.resources[0].mimeType, "text/plain");
});

test("resources/read returns the resource contents", async () => {
  const server = sampleServer();

  const response = await request(server, {
    jsonrpc: "2.0",
    id: 12,
    method: "resources/read",
    params: { uri: "dev-agent://session" },
  });

  assert.equal(response.result.contents[0].uri, "dev-agent://session");
  assert.equal(response.result.contents[0].text, "session: test\nentries: 2");
});

test("resource reads receive a byte budget and reject oversized text before framing", async () => {
  let receivedBudget;
  const oversized = "é".repeat(81);
  const server = createMcpServer({
    tools: [echoTool()],
    maxFrameBytes: 160,
    resources: [
      {
        uri: "dev-agent://bounded",
        read: (context?) => {
          receivedBudget = context?.maxBytes;
          return `budget: ${context?.maxBytes}`;
        },
      },
      {
        uri: "dev-agent://oversized",
        read: () => oversized,
      },
    ],
  });

  const bounded = await request(server, {
    jsonrpc: "2.0",
    id: 17,
    method: "resources/read",
    params: { uri: "dev-agent://bounded" },
  });
  assert.equal(receivedBudget, 160);
  assert.equal(bounded.result.contents[0].text, "budget: 160");

  const rejected = await request(server, {
    jsonrpc: "2.0",
    id: 18,
    method: "resources/read",
    params: { uri: "dev-agent://oversized" },
  });
  assert.equal(rejected.error.code, -32002);
  assert.equal(
    rejected.error.message,
    `MCP frame exceeds maximum of 160 bytes (received ${Buffer.byteLength(oversized, "utf8")} bytes)`
  );
  assert.equal(rejected.result, undefined);
});

test("resource framing preserves tiny multi-byte budgets", async () => {
  const maxFrameBytes = 160;
  const boundedText = "漢字é".repeat(20);
  let receivedBudget;
  const server = createMcpServer({
    tools: [],
    maxFrameBytes,
    resources: [
      {
        uri: "dev-agent://unicode-bounded",
        read: (context?) => {
          receivedBudget = context?.maxBytes;
          assert.ok(Buffer.byteLength(boundedText, "utf8") <= (context?.maxBytes ?? 0));
          return boundedText;
        },
      },
    ],
  });

  const response = await request(server, {
    jsonrpc: "2.0",
    id: 19,
    method: "resources/read",
    params: { uri: "dev-agent://unicode-bounded" },
  });
  assert.equal(receivedBudget, maxFrameBytes);
  assert.equal(response.error.code, -32002);
});

test("reading an unknown resource is an invalid-params error", async () => {
  const server = sampleServer();

  const response = await request(server, {
    jsonrpc: "2.0",
    id: 13,
    method: "resources/read",
    params: { uri: "dev-agent://missing" },
  });

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /unknown resource/);
});

test("prompts/list exposes the prompt and its arguments", async () => {
  const server = sampleServer();

  const response = await request(server, { jsonrpc: "2.0", id: 14, method: "prompts/list" });

  assert.equal(response.result.prompts.length, 1);
  assert.equal(response.result.prompts[0].name, "explain-codebase");
  assert.equal(response.result.prompts[0].arguments[0].name, "focus");
});

test("prompts/get renders the prompt with its arguments", async () => {
  const server = sampleServer();

  const response = await request(server, {
    jsonrpc: "2.0",
    id: 15,
    method: "prompts/get",
    params: { name: "explain-codebase", arguments: { focus: "the executor" } },
  });

  assert.equal(response.result.messages[0].role, "user");
  assert.match(response.result.messages[0].content.text, /the executor/);

  const missing = await request(server, {
    jsonrpc: "2.0",
    id: 16,
    method: "prompts/get",
    params: { name: "nope" },
  });
  assert.equal(missing.error.code, -32602);
  assert.match(missing.error.message, /unknown prompt/);
});
