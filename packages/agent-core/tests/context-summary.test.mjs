import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  createMemoryEntry,
  InMemoryMemory,
} from "../dist/index.js";

const SUMMARY_PROMPT_PREFIX = "Summarize the conversation excerpt";

function isSummaryCall(messages) {
  return typeof messages[0]?.content === "string" &&
    messages[0].content.startsWith(SUMMARY_PROMPT_PREFIX);
}

/**
 * Model stub that answers summarization calls with a digest and everything
 * else with `answer`, optionally asking for a tool on the first turn.
 */
function createModel({ digest = "digest-text", answer = "done", toolOnFirstTurn = false } = {}) {
  const calls = [];
  let conversationTurns = 0;
  const model = {
    id: "openai",
    model: "test-model",
    async chat(messages) {
      calls.push(messages);
      if (isSummaryCall(messages)) {
        return {
          content: digest,
          usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        };
      }
      conversationTurns += 1;
      if (toolOnFirstTurn && conversationTurns === 1) {
        return {
          content: "",
          toolCalls: [{ id: "call-1", name: "echo", input: {} }],
          usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
        };
      }
      return {
        content: answer,
        toolCalls: [],
        usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
      };
    },
  };
  return { model, calls };
}

async function seedMemory(entries) {
  const memory = new InMemoryMemory();
  for (const entry of entries) {
    await memory.append(entry);
  }
  return memory;
}

function longHistory() {
  return [
    createMemoryEntry("user", `old-0 ${"x".repeat(200)}`),
    createMemoryEntry("assistant", `old-1 ${"y".repeat(200)}`),
    createMemoryEntry("user", "recent-2"),
    createMemoryEntry("assistant", "recent-3"),
  ];
}

test("a trimmed history is summarized instead of only announced", async () => {
  const memory = await seedMemory(longHistory());
  const context = createAgentContext("summary-1", memory);
  const { model, calls } = createModel();
  const loop = new AgentLoop({
    model,
    systemPrompt: "system prompt",
    contextBudget: { maxChars: 80, summarize: true },
  });

  const result = await loop.run(context, "current request");

  assert.equal(result.state.status, "done");
  const summaryCall = calls.find(isSummaryCall);
  assert.ok(summaryCall, "the loop should have asked for a summary");
  assert.match(summaryCall[1].content, /old-0/);
  assert.ok(!summaryCall[1].content.includes("recent-2"), "only dropped entries are summarized");

  const conversationCall = calls.filter((messages) => !isSummaryCall(messages)).at(-1);
  const summaryMessage = conversationCall.find((message) => message.content.startsWith("[summary]"));
  assert.ok(summaryMessage, "the conversation should carry a summary message");
  assert.match(summaryMessage.content, /digest-text/);
  assert.ok(
    !conversationCall.some((message) => message.content.startsWith("[context]")),
    "the omission notice is replaced by the summary"
  );
  assert.ok(
    !conversationCall.some((message) => message.content.includes("old-0")),
    "dropped entries are not sent verbatim"
  );
});

test("later turns summarize only the newly dropped entries", async () => {
  const memory = await seedMemory(longHistory());
  const context = createAgentContext("summary-2", memory);
  const { model, calls } = createModel({
    digest: "digest-text",
    toolOnFirstTurn: true,
  });
  const tools = new AgentToolRegistry();
  tools.register({
    name: "echo",
    description: "Echoes.",
    async execute() {
      return { ok: true };
    },
  });
  const loop = new AgentLoop({
    model,
    tools,
    systemPrompt: "system prompt",
    maxTurns: 3,
    contextBudget: { maxChars: 80, summarize: true },
  });

  await loop.run(context, "current request");

  const summaryCalls = calls.filter(isSummaryCall);
  assert.ok(summaryCalls.length >= 2, `expected incremental summaries, got ${summaryCalls.length}`);
  assert.match(summaryCalls[0][1].content, /old-0/);
  assert.ok(
    !summaryCalls[1][1].content.includes("old-0"),
    "the second summary should not repeat already summarized entries"
  );
  assert.match(summaryCalls[1][1].content, /recent-2|tool|echo/);
});

test("summarization tokens count toward the session usage", async () => {
  const memory = await seedMemory(longHistory());
  const context = createAgentContext("summary-3", memory);
  const { model } = createModel();
  const loop = new AgentLoop({
    model,
    systemPrompt: "system prompt",
    contextBudget: { maxChars: 80, summarize: true },
  });

  const result = await loop.run(context, "current request");

  // Summary call (7) plus the conversation call (4).
  assert.equal(result.usage.totalTokens, 11);
});

test("a failing summary falls back to the omission notice", async () => {
  const memory = await seedMemory(longHistory());
  const context = createAgentContext("summary-4", memory);
  const calls = [];
  const model = {
    id: "openai",
    model: "test-model",
    async chat(messages) {
      calls.push(messages);
      if (isSummaryCall(messages)) {
        throw new Error("summarizer unavailable");
      }
      return { content: "done", toolCalls: [] };
    },
  };
  const loop = new AgentLoop({
    model,
    systemPrompt: "system prompt",
    contextBudget: { maxChars: 80, summarize: true },
  });

  const result = await loop.run(context, "current request");

  assert.equal(result.state.status, "done");
  const conversationCall = calls.at(-1);
  const notice = conversationCall.find((message) => message.content.startsWith("[context]"));
  assert.ok(notice, "the omission notice should still be used");
  assert.match(notice.content, /earlier entries omitted/);
});

test("summarize stays off unless it is requested", async () => {
  const memory = await seedMemory(longHistory());
  const context = createAgentContext("summary-5", memory);
  const { model, calls } = createModel();
  const loop = new AgentLoop({
    model,
    systemPrompt: "system prompt",
    contextBudget: { maxChars: 80 },
  });

  await loop.run(context, "current request");

  assert.equal(calls.filter(isSummaryCall).length, 0);
  assert.ok(calls.at(-1).some((message) => message.content.startsWith("[context]")));
});
