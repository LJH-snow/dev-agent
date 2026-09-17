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
    id: "openai" as const,
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

test("a run records provider usage into session metadata", async () => {
  const memory = new InMemoryMemory();
  const context = createAgentContext("usage-run", memory);
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      return {
        content: "done",
        usage: { promptTokens: 11, completionTokens: 4, totalTokens: 15 },
      };
    },
  };
  const loop = new AgentLoop({ model });

  const result = await loop.run(context, "hello");

  assert.deepEqual(result.usage, {
    promptTokens: 11,
    completionTokens: 4,
    totalTokens: 15,
  });
  const metadata = await memory.getMetadata();
  assert.deepEqual(metadata?.usage, {
    promptTokens: 11,
    completionTokens: 4,
    totalTokens: 15,
  });
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
    id: "openai" as const,
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
    id: "openai" as const,
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

test("agent loop reports a missing tool back to the model", async () => {
  let calls = 0;
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      calls += 1;
      if (calls === 1) {
        return { content: "", toolCalls: [{ id: "call-1", name: "missing", input: {} }] };
      }
      return { content: "recovered without the tool", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-3", memory);
  const loop = new AgentLoop({ model, tools: new AgentToolRegistry(), maxTurns: 4 });

  const result = await loop.run(context, "use missing tool");

  assert.equal(result.state.status, "done");
  assert.equal(result.state.currentTask, "use missing tool");
  assert.equal(calls, 2, "the model should get a second turn to correct itself");
  const entries = await memory.entries();
  const toolEntry = entries.find((entry) => entry.role === "tool");
  assert.match(toolEntry.content, /Tool not found: missing/);
  assert.equal(entries.at(-1).content, "recovered without the tool");
});

test("agent loop reports a thrown tool error back to the model", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "broken",
    description: "Always fails.",
    async execute() {
      throw new Error("bad path");
    },
  });
  let calls = 0;
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      calls += 1;
      if (calls === 1) {
        return { content: "", toolCalls: [{ id: "call-1", name: "broken", input: {} }] };
      }
      return { content: "recovered", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-4", memory);
  const loop = new AgentLoop({ model, tools, maxTurns: 4 });
  const result = await loop.run(context, "try the broken tool");

  assert.equal(result.state.status, "done");
  const entries = await memory.entries();
  const toolEntry = entries.find((entry) => entry.role === "tool");
  assert.match(toolEntry.content, /bad path/);
  assert.equal(entries.at(-1).content, "recovered");
});

test("a tool that keeps failing still ends at maxTurns", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "broken",
    description: "Always fails.",
    async execute() {
      throw new Error("still broken");
    },
  });
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      return { content: "", toolCalls: [{ id: "call-1", name: "broken", input: {} }] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-5", memory);
  const loop = new AgentLoop({ model, tools, maxTurns: 2 });
  const result = await loop.run(context, "keep failing");

  assert.equal(result.state.status, "error");
  assert.match(result.state.lastError, /Max turns reached/);
});

test("agent loop rejects without calling the model when already aborted", async () => {
  let modelCalls = 0;
  const model = {
    id: "openai" as const,
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
    id: "openai" as const,
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
  let observedAbortDuringCall = false;
  let releaseTool: (() => void) | undefined;
  let toolAborted: (() => void) | undefined;
  const abortSeen = new Promise<void>((resolve) => {
    toolAborted = resolve;
  });
  let modelCalls = 0;

  const tools = new AgentToolRegistry();
  tools.register({
    name: "capture",
    description: "Captures its execution context.",
    async execute(_input, context): Promise<{ ok: boolean }> {
      capturedContext = context;
      // Stay inside the call so the signal can be observed while it still
      // tracks the run's controller.
      await new Promise<void>((resolve) => {
        releaseTool = resolve;
        context?.signal?.addEventListener(
          "abort",
          () => {
            observedAbortDuringCall = context.signal?.aborted === true;
            toolAborted?.();
            resolve();
          },
          { once: true }
        );
      });
      return { ok: true };
    },
  });

  const model = {
    id: "openai" as const,
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

  const pending = loop.run(context, "capture", { signal: controller.signal });
  // Wait until the tool is inside execute(), then abort the run.
  while (releaseTool === undefined) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  controller.abort();
  await Promise.race([abortSeen, new Promise((resolve) => setTimeout(resolve, 500))]);
  const result = await pending.catch(() => undefined);

  assert.equal(capturedContext.sessionId, "agent-signal");
  // The tool gets a signal that *tracks* the run's, not necessarily the same
  // object: `runTool` derives one so a per-call timeout can abort the tool
  // without aborting the whole run. What matters is that the run's abort
  // reaches the tool.
  assert.ok(capturedContext.signal, "the tool must receive an abort signal");
  assert.equal(
    observedAbortDuringCall,
    true,
    "aborting the run must abort the signal the tool holds while it runs"
  );
  assert.ok(result === undefined || result.state.status === "done");
});

test("agent loop accumulates usage across runs and reports each turn", async () => {
  const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
  const reported = [];
  const model = {
    id: "openai" as const,
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

test("agent loop refreshes a dynamic system prompt on every model turn", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "refresh",
    description: "Refreshes the prompt state.",
    async execute() {
      return { ok: true };
    },
  });

  let supplement = "old MCP prompt";
  const capturedPrompts: string[] = [];
  let calls = 0;
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat(messages) {
      calls += 1;
      capturedPrompts.push(String(messages.find((message) => message.role === "system")?.content ?? ""));
      if (calls === 1) {
        supplement = "new MCP prompt";
        return {
          content: "",
          toolCalls: [{ id: "call-refresh", name: "refresh", input: {} }],
        };
      }
      return { content: "done", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("dynamic-prompt", memory);
  const loop = new AgentLoop({
    model,
    tools,
    systemPromptProvider: () => supplement,
    maxTurns: 3,
  });

  const result = await loop.run(context, "use the current MCP prompt");

  assert.equal(result.state.status, "done");
  assert.equal(capturedPrompts.length, 2);
  assert.match(capturedPrompts[0], /old MCP prompt/);
  assert.doesNotMatch(capturedPrompts[0], /new MCP prompt/);
  assert.match(capturedPrompts[1], /new MCP prompt/);
});

test("agent loop fails closed before a tool call when maxTokens is exhausted", async () => {
  let modelCalls = 0;
  let toolCalls = 0;
  const tools = new AgentToolRegistry();
  tools.register({
    name: "should-not-run",
    description: "Counts tool calls.",
    async execute() {
      toolCalls += 1;
      return "unexpected";
    },
  });

  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      modelCalls += 1;
      return {
        content: "",
        toolCalls: [{ id: "call-budget", name: "should-not-run", input: {} }],
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      };
    },
  };

  const context = createAgentContext("budget-tokens", new InMemoryMemory());
  const loop = new AgentLoop({ model, tools, budget: { maxTokens: 5 } });
  const result = await loop.run(context, "use the tool");

  assert.equal(modelCalls, 1);
  assert.equal(toolCalls, 0);
  assert.equal(result.state.status, "error");
  assert.deepEqual(JSON.parse(result.state.lastError ?? "{}"), {
    code: "budget_exceeded",
    budget: "maxTokens",
    phase: "tool",
    limit: 5,
    observed: 5,
  });
  assert.deepEqual(result.usage, { promptTokens: 3, completionTokens: 2, totalTokens: 5 });
});

test("agent loop fails closed before the next model call when maxTurns is reached", async () => {
  let modelCalls = 0;
  let toolCalls = 0;
  const tools = new AgentToolRegistry();
  tools.register({
    name: "count",
    description: "Counts tool calls.",
    async execute() {
      toolCalls += 1;
      return "ok";
    },
  });

  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      modelCalls += 1;
      return { content: "", toolCalls: [{ id: "call-turn", name: "count", input: {} }] };
    },
  };

  const context = createAgentContext("budget-turns", new InMemoryMemory());
  const loop = new AgentLoop({ model, tools, maxTurns: 5, budget: { maxTurns: 1 } });
  const result = await loop.run(context, "keep going");

  assert.equal(modelCalls, 1);
  assert.equal(toolCalls, 1);
  assert.equal(result.state.status, "error");
  assert.deepEqual(JSON.parse(result.state.lastError ?? "{}"), {
    code: "budget_exceeded",
    budget: "maxTurns",
    phase: "model",
    limit: 1,
    observed: 1,
  });
});

test("agent loop uses the injected clock to stop before the next model call", async () => {
  let now = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  const tools = new AgentToolRegistry();
  tools.register({
    name: "advance-time",
    description: "Advances the test clock.",
    async execute() {
      toolCalls += 1;
      now = 100;
      return "ok";
    },
  });

  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      modelCalls += 1;
      return modelCalls === 1
        ? { content: "", toolCalls: [{ id: "call-time", name: "advance-time", input: {} }] }
        : { content: "done", toolCalls: [] };
    },
  };

  const context = createAgentContext("budget-duration", new InMemoryMemory());
  const loop = new AgentLoop({
    model,
    tools,
    budget: { maxDurationMs: 100, clock: () => now },
  });
  const result = await loop.run(context, "advance time");

  assert.equal(modelCalls, 1);
  assert.equal(toolCalls, 1);
  assert.equal(result.state.status, "error");
  assert.deepEqual(JSON.parse(result.state.lastError ?? "{}"), {
    code: "budget_exceeded",
    budget: "maxDurationMs",
    phase: "model",
    limit: 100,
    observed: 100,
  });
});

test("agent loop reports output overages without starting another call", async () => {
  let modelCalls = 0;
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      modelCalls += 1;
      return { content: "12345", toolCalls: [] };
    },
  };

  const context = createAgentContext("budget-output", new InMemoryMemory());
  const loop = new AgentLoop({ model, budget: { maxOutputChars: 4 } });
  const result = await loop.run(context, "write a short answer");

  assert.equal(modelCalls, 1);
  assert.equal(result.state.status, "error");
  assert.deepEqual(JSON.parse(result.state.lastError ?? "{}"), {
    code: "budget_exceeded",
    budget: "maxOutputChars",
    phase: "model",
    limit: 4,
    observed: 5,
  });
});
