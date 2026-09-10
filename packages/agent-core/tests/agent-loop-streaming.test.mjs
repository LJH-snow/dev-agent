import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  InMemoryMemory,
} from "../dist/index.js";

test("agent loop invokes onToken callback when model provides streamChat", async () => {
  const tokens = [];
  const toolCalls = [];
  const toolResults = [];

  const tools = new AgentToolRegistry();
  tools.register({
    name: "echo",
    description: "Echoes input.",
    async execute(input) {
      return { echoed: input };
    },
  });

  let callCount = 0;
  const model = {
    id: "openai",
    model: "test-model",
    async chat() {
      return { content: "should not be called", toolCalls: [] };
    },
    async streamChat(_messages, options) {
      callCount += 1;
      if (callCount === 1) {
        options.onToken?.("Hello ");
        options.onToken?.("world");
        return {
          content: "Hello world",
          toolCalls: [{ id: "call-1", name: "echo", input: { text: "hi" } }],
        };
      }
      options.onToken?.("done");
      return { content: "done", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-stream", memory);
  const loop = new AgentLoop({
    model,
    tools,
    maxTurns: 3,
    onToken: (token) => tokens.push(token),
    onToolCall: (call) => toolCalls.push(call.name),
    onToolResult: (result) => toolResults.push(result.name),
  });

  const result = await loop.run(context, "stream test");

  assert.equal(result.state.status, "done");
  assert.deepEqual(tokens, ["Hello ", "world", "done"]);
  assert.deepEqual(toolCalls, ["echo"]);
  assert.deepEqual(toolResults, ["echo"]);
});

test("agent loop falls back to chat when onToken is not provided", async () => {
  const tokens = [];
  let streamChatCalled = false;
  let chatCalled = false;

  const model = {
    id: "openai",
    model: "test-model",
    async chat() {
      chatCalled = true;
      return { content: "response", toolCalls: [] };
    },
    async streamChat() {
      streamChatCalled = true;
      return { content: "stream response", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-fallback", memory);
  const loop = new AgentLoop({ model, maxTurns: 2 });

  const result = await loop.run(context, "fallback test");

  assert.equal(result.state.status, "done");
  assert.equal(chatCalled, true);
  assert.equal(streamChatCalled, false);
  assert.equal(tokens.length, 0);
});

test("agent loop emits onToolCall then onToolResult for each tool invocation", async () => {
  const events = [];

  const tools = new AgentToolRegistry();
  tools.register({
    name: "add",
    description: "Adds two numbers.",
    async execute(input) {
      const { a, b } = input;
      return { sum: a + b };
    },
  });
  tools.register({
    name: "multiply",
    description: "Multiplies two numbers.",
    async execute(input) {
      const { a, b } = input;
      return { product: a * b };
    },
  });

  let callCount = 0;
  const model = {
    id: "openai",
    model: "test-model",
    async chat() {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: "",
          toolCalls: [
            { id: "c1", name: "add", input: { a: 2, b: 3 } },
            { id: "c2", name: "multiply", input: { a: 4, b: 5 } },
          ],
        };
      }
      return { content: "done", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-events", memory);
  const loop = new AgentLoop({
    model,
    tools,
    maxTurns: 3,
    onToolCall: (call) => events.push(`call:${call.name}`),
    onToolResult: (result) => events.push(`result:${result.name}`),
  });

  await loop.run(context, "multi-tool test");

  assert.deepEqual(events, ["call:add", "result:add", "call:multiply", "result:multiply"]);
});
