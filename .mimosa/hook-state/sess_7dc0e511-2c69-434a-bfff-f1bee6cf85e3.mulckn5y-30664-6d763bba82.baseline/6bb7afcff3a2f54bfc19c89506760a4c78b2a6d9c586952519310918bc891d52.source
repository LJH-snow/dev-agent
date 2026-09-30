import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentHookRegistry,
  AgentToolRegistry,
  createAgentContext,
  InMemoryMemory,
  type RuntimeEvent,
} from "../dist/index.js";

function context(sessionId = "runtime-events-test") {
  return createAgentContext(sessionId, new InMemoryMemory(), {
    workingDirectory: "/workspace",
  });
}

test("lifecycle hooks correlate model and tool operations with usage", async () => {
  const hooks = new AgentHookRegistry();
  const observed: Array<{
    name: string;
    operationId?: string;
    turn?: number;
    occurredAt?: string;
    usageTotal?: number;
  }> = [];
  for (const name of [
    "session.start",
    "before.model",
    "after.model",
    "before.tool",
    "after.tool",
    "session.end",
  ] as const) {
    hooks.register(name, (hookContext) => {
      observed.push({
        name,
        operationId: hookContext.operationId,
        turn: hookContext.turn,
        occurredAt: hookContext.occurredAt,
        usageTotal: hookContext.usage?.totalTokens,
      });
    });
  }

  const tools = new AgentToolRegistry();
  tools.register({
    name: "shell",
    description: "Runs a command.",
    async execute() {
      return "ok";
    },
  });
  let calls = 0;
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat() {
        calls += 1;
        return calls === 1
          ? { content: "", toolCalls: [{ id: "call-1", name: "shell", input: {} }] }
          : {
              content: "finished",
              toolCalls: [],
              usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
            };
      },
    },
    tools,
    hooks,
  });

  await loop.run(context("hook-lifecycle-session"), "run a tool", { runId: "run-hooks" });

  assert.deepEqual(
    observed.map((event) => event.name),
    [
      "session.start",
      "before.model",
      "after.model",
      "before.tool",
      "after.tool",
      "before.model",
      "after.model",
      "session.end",
    ],
  );
  assert.match(observed[1]?.operationId ?? "", /^model-/);
  assert.equal(observed[1]?.operationId, observed[2]?.operationId);
  assert.equal(observed[3]?.operationId, "call-1");
  assert.equal(observed[3]?.operationId, observed[4]?.operationId);
  assert.equal(observed[6]?.usageTotal, 6);
  assert.ok(observed.every((event) => event.occurredAt));
  assert.equal(observed.at(-1)?.turn, 2);
});

test("finalization emits lifecycle hooks for its no-tools model call", async () => {
  const hooks = new AgentHookRegistry();
  const modelCalls: Array<{ tools: number; operationId?: string }> = [];
  hooks.register("before.model", (hookContext) => {
    modelCalls.push({
      tools: 0,
      operationId: hookContext.operationId,
    });
  });

  const tools = new AgentToolRegistry();
  tools.register({
    name: "inspect",
    description: "Collects evidence.",
    async execute() {
      return "verified";
    },
  });
  let calls = 0;
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat(_messages, options) {
        calls += 1;
        return (options?.tools?.length ?? 0) > 0
          ? { content: "", toolCalls: [{ id: "call-inspect", name: "inspect", input: {} }] }
          : { content: "final answer", toolCalls: [] };
      },
    },
    tools,
    hooks,
    budget: { maxTurns: 1 },
    finalizeOnMaxTurns: true,
  });

  await loop.run(context("hook-finalization-session"), "inspect", { runId: "run-finalize" });

  assert.equal(calls, 2);
  assert.equal(modelCalls.length, 2);
  assert.notEqual(modelCalls[0]?.operationId, modelCalls[1]?.operationId);
});

test("emits one ordered event stream for a streamed final answer", async () => {
  const events: RuntimeEvent[] = [];
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      return { content: "hello", toolCalls: [] };
    },
    async streamChat(_messages, options) {
      options.onToken?.("hello");
      return {
        content: "hello",
        toolCalls: [],
        usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      };
    },
  };
  const loop = new AgentLoop({
    model,
    eventSink: (event) => events.push(event),
  });

  const result = await loop.run(context(), "say hello", { runId: "run-1" });

  assert.equal(result.state.status, "done");
  assert.equal(new Set(events.map((event) => event.sessionId)).size, 1);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      "session.started",
      "run.started",
      "run.status",
      "run.status",
      "assistant.delta",
      "usage.reported",
      "assistant.completed",
      "run.status",
      "run.completed",
    ],
  );
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(events.find((event) => event.type === "assistant.delta")?.runId, "run-1");
});

test("emits reasoning deltas on the shared runtime event stream", async () => {
  const events: RuntimeEvent[] = [];
  const model = {
    id: "ollama" as const,
    model: "qwen3:4b-instruct",
    async chat() {
      return { content: "answer", toolCalls: [] };
    },
    async streamChat(_messages, options) {
      options.onReasoning?.("先思考");
      options.onToken?.("答案");
      return { content: "答案", toolCalls: [] };
    },
  };
  const loop = new AgentLoop({
    model,
    eventSink: (event) => events.push(event),
  });

  await loop.run(context("reasoning-events-test"), "explain", { runId: "run-reasoning" });

  assert.deepEqual(
    events
      .filter((event) => event.type === "assistant.delta")
      .map((event) => event.data),
    [
      { text: "先思考", channel: "reasoning" },
      { text: "答案", channel: "answer" },
    ],
  );
});

test("emits approval and tool lifecycle events without removing callbacks", async () => {
  const events: RuntimeEvent[] = [];
  const callbackEvents: string[] = [];
  let calls = 0;
  const tools = new AgentToolRegistry();
  tools.register({
    name: "shell",
    description: "Runs a command.",
    async execute() {
      callbackEvents.push("execute");
      return "ok";
    },
  });
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      calls += 1;
      return calls === 1
        ? {
            content: "",
            toolCalls: [{ id: "call-1", name: "shell", input: { command: "pwd" } }],
          }
        : { content: "finished", toolCalls: [] };
    },
  };
  const loop = new AgentLoop({
    model,
    tools,
    approval: {
      decide() {
        return { decision: "allow", reason: "test approval" };
      },
    },
    onToolCall: () => callbackEvents.push("tool-call"),
    onToolResult: () => callbackEvents.push("tool-result"),
    eventSink: (event) => events.push(event),
  });

  const result = await loop.run(context(), "run pwd", { runId: "run-2" });

  assert.equal(result.state.status, "done");
  assert.deepEqual(callbackEvents, ["tool-call", "execute", "tool-result"]);
  assert.deepEqual(
    events
      .map((event) => event.type)
      .filter((type) => type.startsWith("tool.")),
    [
      "tool.started",
      "tool.approval-requested",
      "tool.approval-resolved",
      "tool.completed",
    ],
  );
  const started = events.find((event) => event.type === "tool.started");
  assert.deepEqual(started?.type === "tool.started" ? started.data.metadata : undefined, {
    risk: "dangerous",
    confirmation: "on-risk",
    resultFormat: "text",
    supportsProgress: false,
  });
  assert.equal(events.at(-1)?.type, "run.completed");
});

test("emits run.interrupted rather than run.failed when the signal aborts", async () => {
  const events: RuntimeEvent[] = [];
  const controller = new AbortController();
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat(_messages, options) {
      await new Promise((_, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
      return { content: "unreachable", toolCalls: [] };
    },
  };
  const loop = new AgentLoop({
    model,
    eventSink: (event) => events.push(event),
  });
  const run = loop.run(context("interrupt-session"), "wait", {
    runId: "run-3",
    signal: controller.signal,
  });

  setTimeout(() => controller.abort(), 10);
  await assert.rejects(run, /aborted/);

  assert.equal(events.filter((event) => event.type === "run.interrupted").length, 1);
  assert.equal(events.some((event) => event.type === "run.failed"), false);
  assert.equal(events.at(-1)?.type, "run.interrupted");
});
