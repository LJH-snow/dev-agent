import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  createAgentContext,
  createMemoryEntry,
  InMemoryMemory,
} from "../dist/index.js";

function captureModel() {
  const state = { messages: undefined };
  const model = {
    id: "openai",
    model: "test-model",
    async chat(messages) {
      state.messages = messages;
      return { content: "done", toolCalls: [] };
    },
  };
  return { model, state };
}

async function runWithHistory(entries, contextBudget, options = {}) {
  const memory = new InMemoryMemory();
  for (const entry of entries) {
    await memory.append(entry);
  }

  const context = createAgentContext("budget-test", memory);
  const { model, state } = captureModel();
  const loop = new AgentLoop({
    model,
    systemPrompt: options.systemPrompt ?? "system prompt",
    maxTurns: 2,
    contextBudget,
  });

  await loop.run(context, options.input ?? "current request");
  return state.messages;
}

test("context budget drops the oldest entries and reports how many", async () => {
  const entries = [
    createMemoryEntry("user", "old message ".repeat(40)),
    createMemoryEntry("assistant", "old answer ".repeat(40)),
    createMemoryEntry("user", "recent question"),
    createMemoryEntry("assistant", "recent answer"),
  ];

  const messages = await runWithHistory(entries, { maxChars: 120 });
  const contents = messages.map((message) => message.content);

  assert.ok(contents.includes("recent question"));
  assert.ok(contents.includes("recent answer"));
  assert.ok(contents.includes("current request"));
  assert.ok(!contents.some((content) => content.includes("old message")));
  assert.ok(!contents.some((content) => content.includes("old answer")));

  const notice = messages.find((message) => message.content.startsWith("[context]"));
  assert.equal(notice?.content, "[context] 2 earlier entries omitted");
});

test("context budget keeps a tool call together with its results", async () => {
  const entries = [
    createMemoryEntry("user", "x".repeat(400)),
    createMemoryEntry("assistant", "", {
      toolCalls: [{ id: "call-1", name: "echo", input: {} }],
    }),
    createMemoryEntry("tool", "tool output", {
      toolCallId: "call-1",
      toolName: "echo",
    }),
    createMemoryEntry("assistant", "final answer"),
  ];

  const messages = await runWithHistory(entries, { maxChars: 100 });

  assert.ok(!messages.some((message) => message.content === "x".repeat(400)));

  const toolMessage = messages.find((message) => message.role === "tool");
  assert.equal(toolMessage?.toolCallId, "call-1");

  const owningCall = messages.find(
    (message) =>
      message.role === "assistant" &&
      message.toolCalls?.some((call) => call.id === toolMessage?.toolCallId)
  );
  assert.ok(owningCall, "the tool result must keep its assistant tool call");
  assert.ok(
    messages.indexOf(owningCall) < messages.indexOf(toolMessage),
    "the tool call must precede its result"
  );
});

test("no configured budget passes the full history through", async () => {
  const entries = [
    createMemoryEntry("user", "first"),
    createMemoryEntry("assistant", "second"),
  ];

  const messages = await runWithHistory(entries, undefined);

  assert.equal(messages.filter((message) => message.role === "system").length, 1);
  assert.ok(!messages.some((message) => message.content.startsWith("[context]")));
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /^system prompt/);
  assert.deepEqual(
    messages.slice(1).map((message) => message.content),
    ["first", "second", "current request"]
  );
});

test("invalid budget values are ignored", async () => {
  const entries = [
    createMemoryEntry("user", "first"),
    createMemoryEntry("assistant", "second"),
  ];

  for (const maxChars of [0, -10, 1.5, Number.NaN, undefined]) {
    const messages = await runWithHistory(entries, { maxChars });
    assert.ok(
      !messages.some((message) => message.content.startsWith("[context]")),
      `budget ${String(maxChars)} should not trim the history`
    );
  }
});

test("the system prompt is kept even with a tiny budget", async () => {
  const entries = [
    createMemoryEntry("user", "old"),
    createMemoryEntry("assistant", "older"),
  ];

  const messages = await runWithHistory(entries, { maxChars: 1 }, {
    systemPrompt: "keep me",
  });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /keep me/);
  assert.ok(messages.some((message) => message.content.startsWith("[context]")));
});

test("the newest entry is kept even when it alone exceeds the budget", async () => {
  const bigRequest = "z".repeat(500);

  const messages = await runWithHistory(
    [createMemoryEntry("assistant", "old answer")],
    { maxChars: 10 },
    { input: bigRequest }
  );

  const last = messages.at(-1);
  assert.equal(last?.role, "user");
  assert.equal(last?.content, bigRequest);
});
