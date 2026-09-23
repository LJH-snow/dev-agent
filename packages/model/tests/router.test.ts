import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelRouter,
  type ChatCompletion,
  type ChatMessage,
  type ModelProvider,
} from "../dist/index.js";

function provider(
  id: ModelProvider["id"],
  behavior: {
    readonly chat?: () => Promise<ChatCompletion>;
    readonly streamChat?: ModelProvider["streamChat"];
  },
): ModelProvider {
  return {
    id,
    model: `${id}-model`,
    chat: behavior.chat ?? (async () => ({ content: `${id} answer` })),
    ...(behavior.streamChat === undefined ? {} : { streamChat: behavior.streamChat }),
  };
}

test("ModelRouter selects a lazy fallback after a non-streaming failure", async () => {
  let createdFallback = 0;
  const fallback = provider("openai", {
    chat: async () => ({ content: "fallback answer" }),
  });
  const events: unknown[] = [];
  const router = new ModelRouter({
    primary: provider("ollama", {
      chat: async () => {
        throw new Error("429 rate limit");
      },
    }),
    resolveFallback: ({ attempt, failure }) => {
      assert.equal(attempt, 1);
      assert.equal(failure, "rate_limited");
      createdFallback += 1;
      return fallback;
    },
    onFallback: (event) => events.push(event),
  });

  const result = await router.chat([{ role: "user", content: "hello" }]);

  assert.equal(result.content, "fallback answer");
  assert.equal(router.id, "openai");
  assert.equal(createdFallback, 1);
  assert.deepEqual(events, [{
    from: { id: "ollama", model: "ollama-model" },
    to: { id: "openai", model: "openai-model" },
    failure: "rate_limited",
    attempt: 1,
  }]);
});

test("ModelRouter does not fallback after an abort", async () => {
  const controller = new AbortController();
  controller.abort();
  let fallbackCalls = 0;
  const router = new ModelRouter({
    primary: provider("ollama", {
      chat: async () => {
        throw new Error("request aborted");
      },
    }),
    resolveFallback: () => {
      fallbackCalls += 1;
      return provider("openai", {});
    },
  });

  await assert.rejects(
    () => router.chat([{ role: "user", content: "hello" }], { signal: controller.signal }),
    /request aborted/,
  );
  assert.equal(fallbackCalls, 0);
});

test("ModelRouter can fallback before the first streamed token", async () => {
  const tokens: string[] = [];
  let fallbackCalls = 0;
  const router = new ModelRouter({
    primary: provider("ollama", {
      streamChat: async () => {
        throw new Error("service unavailable");
      },
    }),
    resolveFallback: () => {
      fallbackCalls += 1;
      return provider("openai", {
        streamChat: async (
          _messages: readonly ChatMessage[],
          options,
        ) => {
          options?.onToken?.("fallback");
          return { content: "fallback" };
        },
      });
    },
  });

  const result = await router.streamChat(
    [{ role: "user", content: "hello" }],
    { onToken: (token) => tokens.push(token) },
  );

  assert.equal(result.content, "fallback");
  assert.deepEqual(tokens, ["fallback"]);
  assert.equal(fallbackCalls, 1);
});

test("ModelRouter never replays a stream after visible output", async () => {
  let fallbackCalls = 0;
  const tokens: string[] = [];
  const router = new ModelRouter({
    primary: provider("ollama", {
      streamChat: async (_messages, options) => {
        options?.onToken?.("partial");
        throw new Error("connection lost");
      },
    }),
    resolveFallback: () => {
      fallbackCalls += 1;
      return provider("openai", {
        streamChat: async (_messages, options) => {
          options?.onToken?.("duplicate");
          return { content: "duplicate" };
        },
      });
    },
  });

  await assert.rejects(
    () => router.streamChat(
      [{ role: "user", content: "hello" }],
      { onToken: (token) => tokens.push(token) },
    ),
    /connection lost/,
  );
  assert.deepEqual(tokens, ["partial"]);
  assert.equal(fallbackCalls, 0);
});

test("ModelRouter treats reasoning output as visible stream output", async () => {
  let fallbackCalls = 0;
  const router = new ModelRouter({
    primary: provider("ollama", {
      streamChat: async (_messages, options) => {
        options?.onReasoning?.("thinking");
        throw new Error("stream failed");
      },
    }),
    resolveFallback: () => {
      fallbackCalls += 1;
      return provider("openai", {});
    },
  });

  await assert.rejects(
    () => router.streamChat([{ role: "user", content: "hello" }]),
    /stream failed/,
  );
  assert.equal(fallbackCalls, 0);
});
