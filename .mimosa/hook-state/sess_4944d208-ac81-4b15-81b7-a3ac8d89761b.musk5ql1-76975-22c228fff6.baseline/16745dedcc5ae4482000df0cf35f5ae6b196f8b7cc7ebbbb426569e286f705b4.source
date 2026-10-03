import assert from "node:assert/strict";
import test from "node:test";

import { AgentLoop, AgentToolRegistry, createAgentContext, InMemoryMemory } from "../dist/index.js";

test("tool output exceeding maxOutputChars is truncated with notice", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "big-output",
    description: "Produces a large output.",
    async execute() {
      return { data: "x".repeat(200) };
    },
  });

  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      return {
        content: "",
        toolCalls: [{ id: "c1", name: "big-output", input: {} }],
      };
    },
    async streamChat(_messages, options) {
      options.onToken?.("streaming ");
      return {
        content: "",
        toolCalls: [{ id: "c1", name: "big-output", input: {} }],
      };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("trunc-test", memory);
  const loop = new AgentLoop({
    model,
    tools,
    maxTurns: 2,
    toolDefaults: { maxOutputChars: 100 },
    onToken: () => {},
  });

  await loop.run(context, "test truncation");

  const entries = await memory.entries();
  const toolEntry = entries.find((e) => e.role === "tool");
  assert.ok(toolEntry);
  assert.match(toolEntry.content, /truncated/);
  assert.ok(toolEntry.content.length <= 150, `Expected truncated output to be short, got ${toolEntry.content.length} chars`);
});

test("tool output within limit is not truncated", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "small-output",
    description: "Produces a small output.",
    async execute() {
      return { ok: true };
    },
  });

  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      return {
        content: "",
        toolCalls: [{ id: "c1", name: "small-output", input: {} }],
      };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("no-trunc-test", memory);
  const loop = new AgentLoop({
    model,
    tools,
    maxTurns: 2,
    toolDefaults: { maxOutputChars: 50000 },
  });

  await loop.run(context, "test no truncation");

  const entries = await memory.entries();
  const toolEntry = entries.find((e) => e.role === "tool");
  assert.ok(toolEntry);
  assert.doesNotMatch(toolEntry.content, /truncated/);
  assert.equal(toolEntry.content, JSON.stringify({ ok: true }));
});
