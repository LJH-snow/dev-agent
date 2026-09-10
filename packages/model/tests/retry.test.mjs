import assert from "node:assert/strict";
import test from "node:test";

import {
  createAnthropicProvider,
  createOpenAIProvider,
  parseRetryAfter,
} from "../dist/index.js";

function jsonResponse(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("a 429 response is retried and honours Retry-After", async () => {
  const responses = [
    new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }),
    jsonResponse("recovered"),
  ];
  let calls = 0;
  const delays = [];

  const provider = createOpenAIProvider({
    model: "gpt-4o-mini",
    fetch: async () => responses[calls++] ?? new Response("unexpected", { status: 500 }),
    retry: {
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5,
    },
  });

  const completion = await provider.chat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "recovered");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);
});

test("5xx responses are retried with exponential backoff until the budget runs out", async () => {
  let calls = 0;
  const delays = [];

  const provider = createOpenAIProvider({
    model: "gpt-4o-mini",
    fetch: async () => {
      calls += 1;
      return new Response("boom", { status: 503 });
    },
    retry: {
      retries: 2,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5,
    },
  });

  await assert.rejects(
    () => provider.chat([{ role: "user", content: "hi" }]),
    /OpenAI request failed \(503\): boom/
  );

  assert.equal(calls, 3, "one attempt plus two retries");
  assert.deepEqual(delays, [188, 375]);
});

test("other 4xx responses are not retried", async () => {
  let calls = 0;

  const provider = createOpenAIProvider({
    model: "gpt-4o-mini",
    fetch: async () => {
      calls += 1;
      return new Response("bad request", { status: 400 });
    },
    retry: {
      sleep: async () => {
        throw new Error("a client error must not be retried");
      },
    },
  });

  await assert.rejects(
    () => provider.chat([{ role: "user", content: "hi" }]),
    /OpenAI request failed \(400\): bad request/
  );
  assert.equal(calls, 1);
});

test("network failures are retried", async () => {
  let calls = 0;

  const provider = createAnthropicProvider({
    model: "claude-sonnet-4",
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "recovered" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
    retry: { sleep: async () => {}, random: () => 0.5 },
  });

  const completion = await provider.chat([{ role: "user", content: "hi" }]);

  assert.equal(completion.content, "recovered");
  assert.equal(calls, 2);
});

test("a stream that fails after its first token is not retried", async () => {
  const encoder = new TextEncoder();
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
        );
        return;
      }
      controller.error(new Error("connection lost"));
    },
  });

  let calls = 0;
  const tokens = [];
  const provider = createOpenAIProvider({
    model: "gpt-4o-mini",
    fetch: async () => {
      calls += 1;
      return new Response(stream, { status: 200 });
    },
    retry: {
      retries: 3,
      sleep: async () => {
        throw new Error("a started stream must not be retried");
      },
    },
  });

  await assert.rejects(
    () =>
      provider.streamChat([{ role: "user", content: "hi" }], {
        onToken: (token) => tokens.push(token),
      }),
    /connection lost/
  );

  assert.equal(calls, 1);
  assert.deepEqual(tokens, ["partial"]);
});

test("parseRetryAfter understands delta seconds and HTTP dates", () => {
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter(" 0 "), 0);

  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(parseRetryAfter("Thu, 01 Jan 2026 00:00:05 GMT", now), 5000);
  assert.equal(parseRetryAfter("garbage"), undefined);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter(undefined), undefined);
});
