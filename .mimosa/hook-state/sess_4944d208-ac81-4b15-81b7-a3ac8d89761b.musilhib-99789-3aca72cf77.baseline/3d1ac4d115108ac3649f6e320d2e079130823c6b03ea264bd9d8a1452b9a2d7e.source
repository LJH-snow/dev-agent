import assert from "node:assert/strict";
import test from "node:test";

import {
  createOllamaProvider,
  ModelSpeedModeController,
  SpeedModeModelProvider,
  describeSpeedModeSupport,
  withSpeedModeOptions,
} from "../dist/index.js";
import type { ChatMessage, ChatOptions, ModelProvider } from "../dist/index.js";

const message: readonly ChatMessage[] = [{ role: "user", content: "hi" }];
const speedOptions = (provider: Pick<ModelProvider, "id" | "model">, mode: "fast" | "balanced" | "deep"): ChatOptions =>
  withSpeedModeOptions(provider, mode, {});

test("balanced mode leaves provider defaults and explicit options untouched", () => {
  const options: ChatOptions = { temperature: 0.2, maxTokens: 64 };
  assert.equal(withSpeedModeOptions({ id: "openai", model: "gpt-5.6" }, "balanced", options), options);
});

test("fast and deep modes use supported Ollama thinking controls only", () => {
  assert.equal(speedOptions({ id: "ollama", model: "qwen3:4b-instruct" }, "fast").think, false);
  assert.equal(speedOptions({ id: "ollama", model: "qwen3:4b-instruct" }, "deep").think, true);
  assert.equal(speedOptions({ id: "ollama", model: "deepseek-r1:7b" }, "deep").think, true);
  assert.equal(speedOptions({ id: "ollama", model: "gpt-oss:20b" }, "fast").think, "low");
  assert.equal(speedOptions({ id: "ollama", model: "gpt-oss:20b" }, "deep").think, "high");
  const unsupported = {};
  assert.equal(withSpeedModeOptions({ id: "ollama", model: "llama3.2:latest" }, "deep", unsupported), unsupported);
  assert.match(describeSpeedModeSupport({ id: "ollama", model: "llama3.2:latest" }, "deep"), /unavailable/);
});

test("OpenAI reasoning effort is gated by model capability and high-only models", () => {
  assert.equal(speedOptions({ id: "openai", model: "gpt-5.6" }, "fast").reasoningEffort, "low");
  assert.equal(speedOptions({ id: "openai", model: "o4-mini" }, "deep").reasoningEffort, "high");
  assert.equal(speedOptions({ id: "openai", model: "gpt-5-pro" }, "fast").reasoningEffort, undefined);
  assert.match(describeSpeedModeSupport({ id: "openai", model: "gpt-5-pro" }, "fast"), /fast control unavailable/);
  const unsupported = {};
  assert.equal(withSpeedModeOptions({ id: "openai", model: "gpt-4.1" }, "deep", unsupported), unsupported);
});

test("Anthropic adaptive effort and Gemini thinking depth are model gated", () => {
  const claudeFast = speedOptions({ id: "anthropic", model: "claude-sonnet-4-6" }, "fast");
  assert.equal(claudeFast.adaptiveThinking, true);
  assert.equal(claudeFast.reasoningEffort, "low");
  const unsupportedClaude = {};
  assert.equal(withSpeedModeOptions({ id: "anthropic", model: "claude-sonnet-4-5" }, "deep", unsupportedClaude), unsupportedClaude);

  assert.equal(speedOptions({ id: "gemini", model: "gemini-3.8-pro" }, "fast").thinkingLevel, "low");
  assert.equal(speedOptions({ id: "gemini", model: "gemini-3.8-pro" }, "deep").thinkingLevel, "high");
  assert.equal(speedOptions({ id: "gemini", model: "gemini-3.1-flash-lite-image" }, "fast").thinkingLevel, "minimal");
  const unsupportedGemini = {};
  assert.equal(withSpeedModeOptions({ id: "gemini", model: "gemini-2.5-flash" }, "deep", unsupportedGemini), unsupportedGemini);
});

test("speed-mode provider applies the current mode to each subsequent call", async () => {
  const received: ChatOptions[] = [];
  const base: ModelProvider = {
    id: "openai",
    model: "gpt-5.6",
    async chat(_messages, options) {
      received.push(options ?? {});
      return { content: "ok" };
    },
    async streamChat(_messages, options) {
      received.push(options ?? {});
      options?.onToken?.("ok");
      return { content: "ok" };
    },
  };
  const controller = new ModelSpeedModeController();
  const provider = new SpeedModeModelProvider(base, controller);

  await provider.chat(message);
  controller.setMode("fast");
  await provider.streamChat?.(message, { onToken() {} });
  controller.setMode("deep");
  await provider.chat(message);

  assert.deepEqual(received.map((options) => options.reasoningEffort), [undefined, "low", "high"]);
});

test("Ollama speed modes serialize provider-default, fast-off, and deep-on controls", async () => {
  const received: Record<string, unknown>[] = [];
  const base = createOllamaProvider({
    model: "qwen3:4b-instruct",
    fetch: async (_url, init) => {
      received.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
    },
  });
  const controller = new ModelSpeedModeController();
  const provider = new SpeedModeModelProvider(base, controller);

  await provider.chat(message);
  controller.setMode("fast");
  await provider.chat(message);
  controller.setMode("deep");
  await provider.chat(message);

  assert.equal("think" in (received[0] ?? {}), false);
  assert.equal(received[1]?.think, false);
  assert.equal(received[2]?.think, true);
});
