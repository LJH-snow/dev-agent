import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  InMemoryMemory,
} from "../dist/index.js";

test("agent loop asks the model, runs tools, and finishes with a final answer", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "echo",
    description: "Echoes the input.",
    async execute(input) {
      return { echoed: input };
    },
  });

  let modelCalls = 0;
  let lastTools;
  const model = {
    id: "openai",
    model: "test-model",
    async chat(_messages, options) {
      modelCalls += 1;
      lastTools = options?.tools;
      if (modelCalls === 1) {
        return {
          content: "",
          toolCalls: [{ id: "call-1", name: "echo", input: { text: "hello" } }],
        };
      }
      return { content: "done", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-1", memory);
  const loop = new AgentLoop({ model, tools, maxTurns: 3 });

  const result = await loop.run(context, "please echo hello");

  assert.equal(result.state.status, "done");
  assert.equal(result.state.turns, 2);
  assert.equal(result.state.currentTask, "please echo hello");
  assert.equal(modelCalls, 2);
  assert.equal(lastTools?.[0]?.name, "echo");

  const entries = await memory.entries();
  assert.equal(entries.length, 4);
  assert.equal(entries[0].role, "user");
  assert.equal(entries[1].role, "assistant");
  assert.equal(entries[1].toolCalls?.length, 1);
  assert.equal(entries[2].role, "tool");
  assert.equal(entries[2].content, JSON.stringify({ echoed: { text: "hello" } }));
  assert.equal(entries[3].role, "assistant");
  assert.equal(entries[3].content, "done");
});

test("agent loop stops with an error state when maxTurns is reached", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "echo",
    description: "Echoes the input.",
    async execute(input) {
      return input;
    },
  });

  const model = {
    id: "openai",
    model: "test-model",
    async chat() {
      return { content: "", toolCalls: [{ id: "call-1", name: "echo", input: {} }] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-2", memory);
  const loop = new AgentLoop({ model, tools, maxTurns: 2 });

  const result = await loop.run(context, "keep going");

  assert.equal(result.state.status, "error");
  assert.equal(result.state.turns, 2);
});

test("agent loop passes runtime context to tools and system prompt", async () => {
  let capturedContext;
  let lastMessages;
  let modelCalls = 0;

  const tools = new AgentToolRegistry();
  tools.register({
    name: "capture-context",
    description: "Captures the tool execution context.",
    async execute(_input, context) {
      capturedContext = context;
      return { ok: true };
    },
  });

  const model = {
    id: "openai",
    model: "test-model",
    async chat(messages) {
      lastMessages = messages;
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: "",
          toolCalls: [{ id: "call-1", name: "capture-context", input: {} }],
        };
      }
      return { content: "done", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-ctx", memory, {
    sessionId: "session-1",
    workingDirectory: "/tmp/work",
    metadata: { provider: "openai" },
  });
  const loop = new AgentLoop({ model, tools, maxTurns: 3 });

  const result = await loop.run(context, "capture context");

  assert.equal(result.state.status, "done");
  assert.equal(capturedContext.sessionId, "session-1");
  assert.equal(capturedContext.workingDirectory, "/tmp/work");
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.workingDirectory, "/tmp/work");
  assert.match(lastMessages[0].content, /Working directory: \/tmp\/work/);
});

test("agent loop records an error when a requested tool is missing", async () => {
  const model = {
    id: "openai",
    model: "test-model",
    async chat() {
      return { content: "", toolCalls: [{ id: "call-1", name: "missing", input: {} }] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-3", memory);
  const loop = new AgentLoop({ model, tools: new AgentToolRegistry(), maxTurns: 2 });

  const result = await loop.run(context, "use missing tool");

  assert.equal(result.state.status, "error");
  assert.equal(result.state.currentTask, "use missing tool");
  assert.equal(result.state.lastError, "Tool not found: missing");
  const entries = await memory.entries();
  assert.match(entries.at(-1).content, /Tool not found: missing/);
});
