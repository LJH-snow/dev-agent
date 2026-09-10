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

test("agent loop rejects without calling the model when already aborted", async () => {
  let modelCalls = 0;
  const model = {
    id: "openai",
    model: "test-model",
    async chat() {
      modelCalls += 1;
      return { content: "done", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-abort", memory);
  const loop = new AgentLoop({ model });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => loop.run(context, "hello", { signal: controller.signal }),
    /abort/i
  );
  assert.equal(modelCalls, 0);
});

test("agent loop stops before running a tool when the signal aborts mid-turn", async () => {
  const controller = new AbortController();
  let toolRuns = 0;

  const tools = new AgentToolRegistry();
  tools.register({
    name: "echo",
    description: "Echoes the input.",
    async execute() {
      toolRuns += 1;
      return { ok: true };
    },
  });

  const model = {
    id: "openai",
    model: "test-model",
    async chat() {
      controller.abort();
      return { content: "", toolCalls: [{ id: "call-1", name: "echo", input: {} }] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-abort-2", memory);
  const loop = new AgentLoop({ model, tools, maxTurns: 2 });

  await assert.rejects(
    () => loop.run(context, "hello", { signal: controller.signal }),
    /abort/i
  );
  assert.equal(toolRuns, 0);
});

test("agent loop passes the run signal into tool execution contexts", async () => {
  let capturedContext;
  let modelCalls = 0;

  const tools = new AgentToolRegistry();
  tools.register({
    name: "capture",
    description: "Captures its execution context.",
    async execute(_input, context) {
      capturedContext = context;
      return { ok: true };
    },
  });

  const model = {
    id: "openai",
    model: "test-model",
    async chat() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return { content: "", toolCalls: [{ id: "call-1", name: "capture", input: {} }] };
      }
      return { content: "done", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-signal", memory);
  const loop = new AgentLoop({ model, tools, maxTurns: 3 });
  const controller = new AbortController();

  const result = await loop.run(context, "capture", { signal: controller.signal });

  assert.equal(result.state.status, "done");
  assert.equal(capturedContext.sessionId, "agent-signal");
  assert.equal(capturedContext.signal, controller.signal);
});

test("agent loop accumulates usage across runs and reports each turn", async () => {
  const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
  const reported = [];
  const model = {
    id: "openai",
    model: "test-model",
    async chat() {
      return { content: "done", toolCalls: [], usage };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-usage", memory);
  const loop = new AgentLoop({ model, onUsage: (value) => reported.push(value) });

  const first = await loop.run(context, "hello");
  assert.deepEqual(reported, [usage]);
  assert.deepEqual(first.usage, usage);

  const second = await loop.run(first, "again");
  assert.equal(reported.length, 2);
  assert.deepEqual(second.usage, {
    promptTokens: 20,
    completionTokens: 10,
    totalTokens: 30,
  });
});
