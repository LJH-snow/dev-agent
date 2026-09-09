import assert from "node:assert/strict";
import test from "node:test";

import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
} from "../dist/index.js";

test("OpenAI provider sends messages and parses tool calls", async () => {
  let requestBody;
  const fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "",
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
  assert.equal(completion.toolCalls?.[0]?.input.action, "read");
});

test("Ollama provider sends chat request and parses tool calls", async () => {
  let requestBody;
  const fetch = async (url, init) => {
    assert.equal(url, "http://localhost:11434/api/chat");
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        message: {
          content: "",
          tool_calls: [
            {
              function: { name: "shell", arguments: { command: "ls" } },
            },
          ],
        },
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
  assert.equal(requestBody.messages[0].content, "run ls");
  assert.equal(completion.toolCalls?.[0]?.name, "shell");
  assert.equal(completion.toolCalls?.[0]?.input.command, "ls");
});

test("Anthropic provider sends separate system and maps tool messages", async () => {
  let requestBody;
  const fetch = async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        content: [
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
});

test("Gemini provider sends contents and parses function calls", async () => {
  let requestUrl;
  let requestBody;
  const fetch = async (url, init) => {
    requestUrl = url;
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
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
  assert.equal(completion.toolCalls?.[0]?.name, "git");
  assert.equal(completion.toolCalls?.[0]?.input.args[0], "status");
});
