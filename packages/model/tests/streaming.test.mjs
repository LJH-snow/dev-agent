import assert from "node:assert/strict";
import test from "node:test";

import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
} from "../dist/index.js";

const encoder = new TextEncoder();

function streamFromBytes(byteChunks) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of byteChunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function streamFromStrings(chunks) {
  return streamFromBytes(chunks.map((chunk) => encoder.encode(chunk)));
}

function openAIEvent(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

test("OpenAI streamChat streams tokens, invokes onToken, and returns content", async () => {
  const tokens = [];
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    apiKey: "secret",
    fetch: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      const body = JSON.parse(init.body);
      assert.equal(body.stream, true);
      return streamFromStrings([openAIEvent("Hel"), openAIEvent("lo"), "data: [DONE]\n\n"]);
    },
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }], {
    onToken: (token) => tokens.push(token),
  });

  assert.equal(completion.content, "Hello");
  assert.deepEqual(tokens, ["Hel", "lo"]);
});

test("OpenAI streamChat reassembles an event split across chunk boundaries", async () => {
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    fetch: async () =>
      streamFromStrings([
        'data: {"choices":[{"del',
        'ta":{"content":"split"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "split");
});

test("OpenAI streamChat ignores events that arrive after [DONE]", async () => {
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    fetch: async () =>
      streamFromStrings([
        openAIEvent("first"),
        "data: [DONE]\n\n",
        openAIEvent("AFTER_DONE"),
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "first");
});

test("OpenAI streamChat flushes a trailing event with no final newline", async () => {
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    fetch: async () =>
      streamFromStrings(['data: {"choices":[{"delta":{"content":"tail"}}]}']),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "tail");
});

test("OpenAI streamChat skips malformed events without failing", async () => {
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    fetch: async () =>
      streamFromStrings(["data: {not json}\n\n", openAIEvent("ok"), "data: [DONE]\n\n"]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "ok");
});

test("OpenAI streamChat decodes a multi-byte character split across chunks", async () => {
  const text = openAIEvent("你好");
  const bytes = encoder.encode(text);
  const prefixLength = encoder.encode(openAIEvent("")).length;
  const splitAt = prefixLength + 1;

  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    fetch: async () =>
      streamFromBytes([bytes.slice(0, splitAt), bytes.slice(splitAt)]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "你好");
});

test("OpenAI streamChat throws on a non-OK response", async () => {
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    fetch: async () => new Response("nope", { status: 500 }),
  });

  await assert.rejects(
    () => provider.streamChat([{ role: "user", content: "hi" }]),
    /OpenAI stream request failed \(500\): nope/
  );
});

test("OpenAI streamChat throws when the response has no body", async () => {
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    fetch: async () => new Response(null, { status: 200 }),
  });

  await assert.rejects(
    () => provider.streamChat([{ role: "user", content: "hi" }]),
    /OpenAI stream request failed \(200\)/
  );
});

test("OpenAI streamChat forwards the abort signal to fetch", async () => {
  const controller = new AbortController();
  let seenSignal;
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    fetch: async (_url, init) => {
      seenSignal = init.signal;
      return streamFromStrings([openAIEvent("ok"), "data: [DONE]\n\n"]);
    },
  });

  await provider.streamChat([{ role: "user", content: "hi" }], {
    signal: controller.signal,
  });

  assert.equal(seenSignal, controller.signal);
});

test("OpenAI streamChat accumulates tool call deltas across events", async () => {
  const toolCallEvent = (toolCall) =>
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [toolCall] } }] })}\n\n`;
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    fetch: async () =>
      streamFromStrings([
        toolCallEvent({
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: "filesystem", arguments: '{"action":"read",' },
        }),
        toolCallEvent({ index: 0, function: { arguments: '"path":"a.txt"}' } }),
        "data: [DONE]\n\n",
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "read a.txt" }]);

  assert.equal(completion.toolCalls?.length, 1);
  assert.equal(completion.toolCalls?.[0]?.id, "call_1");
  assert.equal(completion.toolCalls?.[0]?.name, "filesystem");
  assert.deepEqual(completion.toolCalls?.[0]?.input, { action: "read", path: "a.txt" });
});

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

test("Anthropic streamChat streams text deltas and returns content", async () => {
  const tokens = [];
  const provider = createAnthropicProvider({
    model: "claude-sonnet-4",
    apiKey: "secret",
    baseUrl: "https://api.anthropic.com",
    fetch: async (url, init) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      const body = JSON.parse(init.body);
      assert.equal(body.stream, true);
      return streamFromStrings([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hey"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"!"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]);
    },
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }], {
    onToken: (token) => tokens.push(token),
  });

  assert.equal(completion.content, "Hey!");
  assert.deepEqual(tokens, ["Hey", "!"]);
});

test("Anthropic streamChat reassembles an event split across chunk boundaries", async () => {
  const provider = createAnthropicProvider({
    model: "claude-sonnet-4",
    fetch: async () =>
      streamFromStrings([
        'data: {"delta":{"te',
        'xt":"joined"}}\n\n',
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "joined");
});

test("Anthropic streamChat flushes a trailing event with no final newline", async () => {
  const provider = createAnthropicProvider({
    model: "claude-sonnet-4",
    fetch: async () => streamFromStrings(['data: {"delta":{"text":"tail"}}']),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "tail");
});

test("Anthropic streamChat throws on a non-OK response", async () => {
  const provider = createAnthropicProvider({
    model: "claude-sonnet-4",
    fetch: async () => new Response("boom", { status: 429 }),
  });

  await assert.rejects(
    () => provider.streamChat([{ role: "user", content: "hi" }]),
    /Anthropic stream request failed \(429\): boom/
  );
});

test("Anthropic streamChat accumulates tool_use input fragments", async () => {
  const event = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
  const provider = createAnthropicProvider({
    model: "claude-sonnet-4",
    fetch: async () =>
      streamFromStrings([
        event({
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_1", name: "filesystem", input: {} },
        }),
        event({
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"action":"read",' },
        }),
        event({
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '"path":"a.txt"}' },
        }),
        event({ type: "message_stop" }),
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "read a.txt" }]);

  assert.equal(completion.toolCalls?.length, 1);
  assert.equal(completion.toolCalls?.[0]?.id, "toolu_1");
  assert.equal(completion.toolCalls?.[0]?.name, "filesystem");
  assert.deepEqual(completion.toolCalls?.[0]?.input, { action: "read", path: "a.txt" });
});

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

test("Gemini streamChat streams candidate text parts", async () => {
  const tokens = [];
  const provider = createGeminiProvider({
    model: "gemini-2.5-pro",
    apiKey: "secret",
    baseUrl: "https://generativelanguage.googleapis.com",
    fetch: async (url) => {
      assert.match(url, /streamGenerateContent/);
      assert.match(url, /alt=sse/);
      return streamFromStrings([
        'data: {"candidates":[{"content":{"parts":[{"text":"Gem"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"ini"}]}}]}\n\n',
      ]);
    },
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }], {
    onToken: (token) => tokens.push(token),
  });

  assert.equal(completion.content, "Gemini");
  assert.deepEqual(tokens, ["Gem", "ini"]);
});

test("Gemini streamChat flushes a trailing event with no final newline", async () => {
  const provider = createGeminiProvider({
    model: "gemini-2.5-pro",
    fetch: async () =>
      streamFromStrings(['data: {"candidates":[{"content":{"parts":[{"text":"tail"}]}}]}']),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "tail");
});

test("Gemini streamChat throws on a non-OK response", async () => {
  const provider = createGeminiProvider({
    model: "gemini-2.5-pro",
    fetch: async () => new Response("denied", { status: 403 }),
  });

  await assert.rejects(
    () => provider.streamChat([{ role: "user", content: "hi" }]),
    /Gemini stream request failed \(403\): denied/
  );
});

test("Gemini streamChat collects functionCall parts", async () => {
  const provider = createGeminiProvider({
    model: "gemini-2.5-pro",
    fetch: async () =>
      streamFromStrings([
        `data: ${JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: "filesystem", args: { action: "read", path: "a.txt" } } },
                ],
              },
            },
          ],
        })}\n\n`,
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "read a.txt" }]);

  assert.equal(completion.toolCalls?.length, 1);
  assert.equal(completion.toolCalls?.[0]?.name, "filesystem");
  assert.deepEqual(completion.toolCalls?.[0]?.input, { action: "read", path: "a.txt" });
});

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

test("Ollama streamChat streams NDJSON content", async () => {
  const tokens = [];
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    baseUrl: "http://localhost:11434",
    fetch: async (url, init) => {
      assert.equal(url, "http://localhost:11434/api/chat");
      const body = JSON.parse(init.body);
      assert.equal(body.stream, true);
      return streamFromStrings([
        '{"message":{"content":"Ol"}}\n',
        '{"message":{"content":"la"}}\n',
        '{"message":{"content":""},"done":true}\n',
      ]);
    },
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }], {
    onToken: (token) => tokens.push(token),
  });

  assert.equal(completion.content, "Olla");
  assert.deepEqual(tokens, ["Ol", "la"]);
});

test("Ollama streamChat handles several JSON objects in a single chunk", async () => {
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async () =>
      streamFromStrings([
        '{"message":{"content":"a"}}\n{"message":{"content":"b"}}\n',
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "ab");
});

test("Ollama streamChat collects tool calls from the stream", async () => {
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async () =>
      streamFromStrings([
        '{"message":{"content":"","tool_calls":[{"function":{"name":"filesystem","arguments":{"action":"read","path":"a.txt"}}}]}}\n',
      ]),
  });

  const completion = await provider.streamChat([{ role: "user", content: "read a.txt" }]);

  assert.equal(completion.toolCalls?.length, 1);
  assert.equal(completion.toolCalls?.[0]?.name, "filesystem");
  assert.deepEqual(completion.toolCalls?.[0]?.input, { action: "read", path: "a.txt" });
});

test("Ollama streamChat flushes a trailing line with no final newline", async () => {
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async () => streamFromStrings(['{"message":{"content":"tail"}}']),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "tail");
});

test("Ollama streamChat skips malformed lines without failing", async () => {
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async () =>
      streamFromStrings(["{not json}\n", '{"message":{"content":"ok"}}\n']),
  });

  const completion = await provider.streamChat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "ok");
});

test("Ollama streamChat throws on a non-OK response", async () => {
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async () => new Response("missing model", { status: 404 }),
  });

  await assert.rejects(
    () => provider.streamChat([{ role: "user", content: "hi" }]),
    /Ollama stream request failed \(404\): missing model/
  );
});
