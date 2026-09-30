import assert from "node:assert/strict";
import test from "node:test";

import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
} from "../dist/index.js";

const PROVIDER_JSON_LIMIT = 16 * 1024 * 1024;

function oversizedJsonResponse(seed: Record<string, unknown>) {
  let cancelled = false;
  const payload = JSON.stringify(seed) + " ".repeat(PROVIDER_JSON_LIMIT + 1);
  let closeTimer: NodeJS.Timeout | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from(payload));
      closeTimer = setTimeout(() => controller.close(), 10);
    },
    cancel() {
      clearTimeout(closeTimer);
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { status: 200 }),
    wasCancelled: () => cancelled,
  };
}

test("OpenAI provider sends messages and parses tool calls", async () => {
  let requestBody;
  const fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    requestBody = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: "deciding",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "filesystem", arguments: '{"action":"read","path":"a.txt"}' },
                },
              ],
            },
          },
        ],
      }),
      { status: 200 }
    );
  };

  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    apiKey: "secret",
    baseUrl: "https://api.openai.com/v1",
    fetch,
  });

  const completion = await provider.chat(
    [
      { role: "user", content: "read a.txt" },
    ],
    {
      tools: [{ name: "filesystem", description: "Read files", parameters: { type: "object" } }],
    }
  );

  assert.equal(requestBody.model, "gpt-4.1");
  assert.equal(requestBody.messages[0].content, "read a.txt");
  assert.equal(requestBody.tools[0].function.name, "filesystem");
  assert.equal(completion.toolCalls?.[0]?.name, "filesystem");
  assert.equal((completion.toolCalls?.[0]?.input as { action: string }).action, "read");
  assert.equal(completion.reasoning, "deciding");
});

test("OpenAI serializes reasoning effort only for supported reasoning models", async () => {
  let supportedBody: Record<string, unknown> | undefined;
  const supported = createOpenAIProvider({
    model: "gpt-5.6",
    apiKey: "secret",
    fetch: async (_url, init) => {
      supportedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    },
  });
  await supported.chat([{ role: "user", content: "hi" }], { reasoningEffort: "low" });
  assert.equal(supportedBody?.reasoning_effort, "low");

  let unsupportedBody: Record<string, unknown> | undefined;
  const unsupported = createOpenAIProvider({
    model: "gpt-4.1",
    apiKey: "secret",
    fetch: async (_url, init) => {
      unsupportedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    },
  });
  await unsupported.chat([{ role: "user", content: "hi" }], { reasoningEffort: "low" });
  assert.equal("reasoning_effort" in (unsupportedBody ?? {}), false);
});

test("rejects an oversized OpenAI success response before full buffering", async () => {
  const oversized = oversizedJsonResponse({ choices: [] });
  const provider = createOpenAIProvider({
    model: "gpt-4.1",
    apiKey: "secret",
    fetch: async () => oversized.response,
  });

  await assert.rejects(
    () => provider.chat([{ role: "user", content: "hi" }]),
    (error) => {
      if (!(error instanceof Error)) return false;
      assert.match(error.message, /16 MiB/);
      return true;
    }
  );
  assert.equal(oversized.wasCancelled(), true);
});

test("Ollama provider sends chat request and parses tool calls", async () => {
  let requestBody;
  const fetch = async (url, init) => {
    assert.equal(url, "http://localhost:11434/api/chat");
    requestBody = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        message: {
          content: "",
          thinking: "先思考",
          tool_calls: [
            {
              function: { name: "shell", arguments: { command: "ls" } },
            },
          ],
        },
        load_duration: 1_200_000_000,
        prompt_eval_duration: 345_000_000,
        eval_duration: 678_000_000,
        total_duration: 2_300_000_000,
      }),
      { status: 200 }
    );
  };

  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch,
  });

  const completion = await provider.chat([{ role: "user", content: "run ls" }]);

  assert.equal(requestBody.model, "qwen3:4b-instruct");
  assert.equal("think" in requestBody, false, "balanced/default mode leaves model thinking defaults untouched");
  assert.equal(requestBody.messages[0].content, "run ls");
  assert.equal(completion.toolCalls?.[0]?.name, "shell");
  assert.equal((completion.toolCalls?.[0]?.input as { command: string }).command, "ls");
  assert.equal(completion.reasoning, "先思考");
  assert.deepEqual(completion.providerTiming, {
    loadMs: 1200,
    promptEvalMs: 345,
    generationMs: 678,
    serverTotalMs: 2300,
  });
});

test("Ollama streaming captures final-chunk request phase timings", async () => {
  const chunks = [
    JSON.stringify({ message: { content: "answer" } }),
    JSON.stringify({
      done: true,
      load_duration: 2_000_000_000,
      prompt_eval_duration: 500_000_000,
      eval_duration: 750_000_000,
      total_duration: 3_400_000_000,
      prompt_eval_count: 25,
      eval_count: 9,
    }),
  ].map((line) => `${line}\n`);
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
        controller.close();
      },
    }), { status: 200 }),
  });

  const completion = await provider.streamChat!([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "answer");
  assert.deepEqual(completion.providerTiming, {
    loadMs: 2000,
    promptEvalMs: 500,
    generationMs: 750,
    serverTotalMs: 3400,
  });
});

test("Ollama chat allows reasoning to be opted in", async () => {
  let requestBody;
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ message: { content: "answer" } }), { status: 200 });
    },
  });

  await provider.chat([{ role: "user", content: "explain" }], { think: true });

  assert.equal(requestBody.think, true);
});

test("Ollama serializes explicit thinking levels for models that support them", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = createOllamaProvider({
    model: "gpt-oss:20b",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
    },
  });
  await provider.chat([{ role: "user", content: "hi" }], { think: "low" });
  assert.equal(requestBody?.think, "low");
});

test("rejects an oversized Ollama success response before full buffering", async () => {
  const oversized = oversizedJsonResponse({ message: {} });
  const provider = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async () => oversized.response,
  });

  await assert.rejects(
    () => provider.chat([{ role: "user", content: "hi" }]),
    (error) => {
      if (!(error instanceof Error)) return false;
      assert.match(error.message, /16 MiB/);
      return true;
    }
  );
  assert.equal(oversized.wasCancelled(), true);
});

test("Anthropic provider sends separate system and maps tool messages", async () => {
  let requestBody;
  const fetch = async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    requestBody = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        content: [
          { type: "thinking", thinking: "先分析" },
          { type: "text", text: "using tool" },
          { type: "tool_use", id: "toolu_1", name: "search", input: { query: "needle" } },
        ],
      }),
      { status: 200 }
    );
  };

  const provider = createAnthropicProvider({
    model: "claude-sonnet-4-20250514",
    apiKey: "secret",
    fetch,
  });

  const completion = await provider.chat(
    [
      { role: "system", content: "Be concise" },
      { role: "user", content: "search" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "search", input: {} }] },
      { role: "tool", content: "{\"ok\":true}", toolCallId: "c1", toolName: "search" },
    ],
    { tools: [{ name: "search", description: "Search" }] }
  );

  assert.equal(requestBody.system, "Be concise");
  assert.equal(requestBody.tools[0].name, "search");
  assert.equal(requestBody.messages[0].role, "user");
  assert.equal(requestBody.messages[1].role, "assistant");
  assert.equal(requestBody.messages[2].role, "user");
  assert.equal(requestBody.messages[2].content[0].type, "tool_result");
  assert.equal(completion.toolCalls?.[0]?.name, "search");
  assert.equal(completion.reasoning, "先分析");
});

test("Anthropic serializes adaptive effort only for supported models", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = createAnthropicProvider({
    model: "claude-sonnet-4-6",
    apiKey: "secret",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200 });
    },
  });
  await provider.chat([{ role: "user", content: "hi" }], {
    adaptiveThinking: true,
    reasoningEffort: "low",
  });
  assert.deepEqual(requestBody?.thinking, { type: "adaptive" });
  assert.deepEqual(requestBody?.output_config, { effort: "low" });
});

test("rejects an oversized Anthropic success response before full buffering", async () => {
  const oversized = oversizedJsonResponse({ content: [] });
  const provider = createAnthropicProvider({
    model: "claude-sonnet-4-20250514",
    apiKey: "secret",
    fetch: async () => oversized.response,
  });

  await assert.rejects(
    () => provider.chat([{ role: "user", content: "hi" }]),
    (error) => {
      if (!(error instanceof Error)) return false;
      assert.match(error.message, /16 MiB/);
      return true;
    }
  );
  assert.equal(oversized.wasCancelled(), true);
});

test("Gemini provider sends contents and parses function calls", async () => {
  let requestUrl;
  let requestBody;
  const fetch = async (url, init) => {
    requestUrl = url;
    requestBody = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "先判断", thought: true },
                { text: "calling" },
                { functionCall: { name: "git", args: { args: ["status"] } } },
              ],
            },
          },
        ],
      }),
      { status: 200 }
    );
  };

  const provider = createGeminiProvider({
    model: "gemini-2.5-flash",
    apiKey: "secret",
    fetch,
  });

  const completion = await provider.chat(
    [{ role: "user", content: "git status" }],
    { tools: [{ name: "git", description: "Run git" }] }
  );

  assert.match(requestUrl, /gemini-2.5-flash/);
  assert.equal(requestBody.contents[0].role, "user");
  assert.equal(requestBody.tools[0].functionDeclarations[0].name, "git");
  assert.equal(completion.content, "calling");
  assert.equal(completion.reasoning, "先判断");
  assert.equal(completion.toolCalls?.[0]?.name, "git");
  assert.equal(
    (completion.toolCalls?.[0]?.input as { args: string[] }).args[0],
    "status"
  );
});

test("Gemini serializes the model-supported thinking level", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = createGeminiProvider({
    model: "gemini-3.1-flash-lite-image",
    apiKey: "secret",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      }), { status: 200 });
    },
  });
  await provider.chat([{ role: "user", content: "hi" }], { thinkingLevel: "minimal" });
  assert.deepEqual(
    (requestBody?.generationConfig as { thinkingConfig?: unknown } | undefined)?.thinkingConfig,
    { thinkingLevel: "MINIMAL" },
  );
});

test("rejects an oversized Gemini success response before full buffering", async () => {
  const oversized = oversizedJsonResponse({ candidates: [] });
  const provider = createGeminiProvider({
    model: "gemini-2.5-flash",
    apiKey: "secret",
    fetch: async () => oversized.response,
  });

  await assert.rejects(
    () => provider.chat([{ role: "user", content: "hi" }]),
    (error) => {
      if (!(error instanceof Error)) return false;
      assert.match(error.message, /16 MiB/);
      return true;
    }
  );
  assert.equal(oversized.wasCancelled(), true);
});
