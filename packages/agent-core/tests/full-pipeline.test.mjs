import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  FileMemory,
  InMemoryMemory,
} from "../dist/index.js";

test("full pipeline: user input -> tool execution -> final answer -> memory persistence", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "greet",
    description: "Greet someone",
    async execute(input) {
      return { greeting: `Hello, ${input.name}!` };
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
          toolCalls: [{ id: "c1", name: "greet", input: { name: "World" } }],
        };
      }
      return { content: "Done! The greeting was sent.", toolCalls: [] };
    },
  };

  const memory = new InMemoryMemory();
  const context = createAgentContext("pipeline-test", memory, {
    sessionId: "test-session",
    workingDirectory: "/tmp",
  });

  const loop = new AgentLoop({
    model,
    tools,
    maxTurns: 5,
    onTurn: () => {},
    onToolCall: () => {},
    onToolResult: () => {},
  });

  const result = await loop.run(context, "Say hello to World");

  assert.equal(result.state.status, "done");
  assert.equal(result.state.turns, 2);

  const entries = await memory.entries();
  assert.equal(entries.length, 4);
  assert.equal(entries[0].role, "user");
  assert.equal(entries[1].role, "assistant");
  assert.equal(entries[2].role, "tool");
  assert.equal(entries[3].role, "assistant");
  assert.match(entries[3].content, /Done/);
});

test("full pipeline with FileMemory persists entries to disk", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const memFile = path.join(os.tmpdir(), `dev-agent-pipeline-${Date.now()}.json`);

  try {
    const tools = new AgentToolRegistry();
    tools.register({
      name: "ping",
      description: "Returns pong",
      async execute() { return { result: "pong" }; },
    });

    const model = {
      id: "openai",
      model: "test",
      async chat() {
        return { content: "pong received", toolCalls: [] };
      },
    };

    const memory = new FileMemory({ filePath: memFile });
    const context = createAgentContext("file-pipeline", memory);
    const loop = new AgentLoop({ model, tools, maxTurns: 3 });

    const result = await loop.run(context, "ping");

    assert.equal(result.state.status, "done");

    // Verify file was created and contains entries
    assert.ok(fs.existsSync(memFile));
    const raw = fs.readFileSync(memFile, "utf8");
    const parsed = JSON.parse(raw);
    assert.ok(parsed.entries.length >= 2);
    assert.ok(parsed.metadata);
    assert.equal(typeof parsed.metadata.createdAt, "string");
  } finally {
    try { fs.unlinkSync(memFile); } catch {}
  }
});
