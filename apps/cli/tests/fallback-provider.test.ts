import assert from "node:assert/strict";
import test from "node:test";

import { FallbackModelProvider } from "../dist/fallback-provider.js";
import { resolveModelSelection, type ModelSelection } from "../dist/model-profiles.js";
import type { ChatCompletion, ChatMessage, ModelProvider } from "@dev-agent/model";

function fakeProvider(selection: ModelSelection, behavior: "fail" | "pass"): ModelProvider {
  return {
    id: selection.provider,
    model: selection.model ?? "default",
    async chat(_messages: readonly ChatMessage[]): Promise<ChatCompletion> {
      if (behavior === "fail") throw new Error("429 rate limit");
      return { content: `answer from ${selection.provider}`, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    },
  };
}

test("fallback provider changes only when fallback is explicitly enabled", async () => {
  const config = {
    profiles: {
      local: { provider: "ollama", model: "qwen3:4b-instruct" },
      cloud: { provider: "openai", model: "gpt-4o-mini" },
    },
    defaultProfile: "local",
    fallback: { enabled: true, order: ["local", "cloud"] },
  };
  const initial = resolveModelSelection({ config }).selection;
  const initialResult = resolveModelSelection({ config });
  const changes: string[] = [];
  const provider = new FallbackModelProvider({
    config,
    initial: initialResult,
    createProvider: (selection) => fakeProvider(selection, selection.provider === "ollama" ? "fail" : "pass"),
    onSelectionChange: (selection) => changes.push(`${selection.selection.provider}/${selection.selection.model}`),
  });

  const result = await provider.chat([{ role: "user", content: "hello" }]);
  assert.equal(result.content, "answer from openai");
  assert.equal(provider.id, "openai");
  assert.equal(provider.model, "gpt-4o-mini");
  assert.deepEqual(changes, ["openai/gpt-4o-mini"]);
  assert.equal(initial.provider, "ollama");
});

test("fallback provider preserves the original error when fallback is disabled", async () => {
  const config = {
    profiles: {
      local: { provider: "ollama", model: "qwen3:4b-instruct" },
      cloud: { provider: "openai", model: "gpt-4o-mini" },
    },
    defaultProfile: "local",
    fallback: { enabled: false, order: ["local", "cloud"] },
  };
  const initial = resolveModelSelection({ config });
  const provider = new FallbackModelProvider({
    config,
    initial,
    createProvider: (selection) => fakeProvider(selection, "fail"),
  });
  await assert.rejects(() => provider.chat([{ role: "user", content: "hello" }]), /429 rate limit/);
  assert.equal(provider.id, "ollama");
});

test("fallback provider does not replay a partially streamed answer", async () => {
  const config = {
    profiles: {
      local: { provider: "ollama", model: "qwen3:4b-instruct" },
      cloud: { provider: "openai", model: "gpt-4o-mini" },
    },
    defaultProfile: "local",
    fallback: { enabled: true, order: ["local", "cloud"] },
  };
  const initial = resolveModelSelection({ config });
  let fallbackCalls = 0;
  const tokens: string[] = [];
  const provider = new FallbackModelProvider({
    config,
    initial,
    createProvider: (selection) => {
      if (selection.provider === "ollama") {
        return {
          id: "ollama",
          model: "qwen3:4b-instruct",
          async chat() {
            return { content: "unused" };
          },
          async streamChat(_messages, options) {
            options?.onToken?.("partial");
            throw new Error("connection lost");
          },
        };
      }
      fallbackCalls += 1;
      return fakeProvider(selection, "pass");
    },
  });

  await assert.rejects(
    () => provider.streamChat(
      [{ role: "user", content: "hello" }],
      { onToken: (token) => tokens.push(token) },
    ),
    /connection lost/,
  );
  assert.deepEqual(tokens, ["partial"]);
  assert.equal(fallbackCalls, 0);
});
