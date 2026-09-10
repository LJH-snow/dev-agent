import assert from "node:assert/strict";
import test from "node:test";

import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
} from "../dist/index.js";

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(events) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(`${body}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("OpenAI chat reports usage", async () => {
  const provider = createOpenAIProvider({
    model: "gpt-4o-mini",
    fetch: async () =>
      jsonResponse({
        choices: [{ message: { content: "hi" } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }),
  });

  const completion = await provider.chat([{ role: "user", content: "hi" }]);

  assert.deepEqual(completion.usage, {
    promptTokens: 7,
    completionTokens: 3,
    totalTokens: 10,
  });
});

test("Anthropic chat reports usage", async () => {
  const provider = createAnthropicProvider({
    model: "claude-sonnet-4",
    fetch: async () =>
      jsonResponse({
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 11, output_tokens: 4 },
      }),
  });

  const completion = await provider.chat([{ role: "user", content: "hi" }]);

  assert.deepEqual(completion.usage, {
    promptTokens: 11,
    completionTokens: 4,
    totalTokens: 15,
  });
});

test("Gemini chat reports usage", async () => {
  const provider = createGeminiProvider({
    model: "gemini-2.5-pro",
    fetch: async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "hi" }] } }],
        usageMetadata: {
          promptTokenCount: 13,
          candidatesTokenCount: 5,
          totalTokenCount: 18,
        },
      }),
  });

  const completion = await provider.chat([{ role: "user", content: "hi" }]);

  assert.deepEqual(completion.usage, {
    promptTokens: 13,
    completionTokens: 5,
    totalTokens: 18,
  });
});

test("Ollama chat reports usage", async () => {
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async () =>
      jsonResponse({
        message: { content: "hi" },
        prompt_eval_count: 17,
        eval_count: 6,
      }),
  });

  const completion = await provider.chat([{ role: "user", content: "hi" }]);

  assert.deepEqual(completion.usage, {
    promptTokens: 17,
    completionTokens: 6,
    totalTokens: 23,
  });
});

test("OpenAI streamChat reports usage from the final chunk", async () => {
  const provider = createOpenAIProvider({
    model: "gpt-4o-mini",
    fetch: async () =>
      sseResponse([
        { choices: [{ delta: { content: "hi" } }] },
        {
          choices: [],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        },
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "hi");
  assert.deepEqual(completion.usage, {
    promptTokens: 2,
    completionTokens: 1,
    totalTokens: 3,
  });
});

test("Anthropic streamChat merges input and output usage", async () => {
  const provider = createAnthropicProvider({
    model: "claude-sonnet-4",
    fetch: async () =>
      sseResponse([
        { type: "message_start", message: { usage: { input_tokens: 8 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
        { type: "message_delta", usage: { output_tokens: 2 } },
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "hi");
  assert.deepEqual(completion.usage, {
    promptTokens: 8,
    completionTokens: 2,
    totalTokens: 10,
  });
});

test("providers omit usage when the response does not report it", async () => {
  const provider = createOpenAIProvider({
    model: "gpt-4o-mini",
    fetch: async () => jsonResponse({ choices: [{ message: { content: "hi" } }] }),
  });

  const completion = await provider.chat([{ role: "user", content: "hi" }]);

  assert.equal(completion.usage, undefined);
});
