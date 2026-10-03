import assert from "node:assert/strict";
import test from "node:test";

import { AgentLoop, AgentToolRegistry, createAgentContext, InMemoryMemory } from "../dist/index.js";

test("tool that exceeds timeoutMs returns timeout error in result", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "slow-tool",
    description: "Takes too long.",
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { shouldNotReach: true };
    },
  });

  let calls = 0;
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      calls += 1;
      if (calls === 1) {
        return {
          content: "",
          toolCalls: [{ id: "c1", name: "slow-tool", input: {} }],
        };
      }
      return { content: "done", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("timeout-test", memory);
  const loop = new AgentLoop({
    model,
    tools,
    maxTurns: 3,
    toolDefaults: { timeoutMs: 50 },
  });

  const result = await loop.run(context, "test timeout");

  const entries = await memory.entries();
  const toolEntry = entries.find((e) => e.role === "tool");
  assert.ok(toolEntry);
  assert.match(toolEntry.content, /timed out/);
  assert.equal(result.state.status, "done");
});

test("tool that completes within timeout returns normal result", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "fast-tool",
    description: "Completes quickly.",
    async execute() {
      return { quick: true };
    },
  });

  let calls = 0;
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      calls += 1;
      if (calls === 1) {
        return {
          content: "",
          toolCalls: [{ id: "c1", name: "fast-tool", input: {} }],
        };
      }
      return { content: "done", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("no-timeout-test", memory);
  const loop = new AgentLoop({
    model,
    tools,
    maxTurns: 3,
    toolDefaults: { timeoutMs: 5000 },
  });

  const result = await loop.run(context, "test fast tool");

  const entries = await memory.entries();
  const toolEntry = entries.find((e) => e.role === "tool");
  assert.ok(toolEntry);
  assert.equal(toolEntry.content, JSON.stringify({ quick: true }));
  assert.equal(result.state.status, "done");
});
