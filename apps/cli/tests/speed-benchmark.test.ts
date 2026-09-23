import assert from "node:assert/strict";
import test from "node:test";

import { benchmarkModel } from "../dist/speed-benchmark.js";
import type { ChatMessage, ChatOptions, ModelProvider } from "@dev-agent/model";

test("benchmarks a streamed answer and returns timings only", async () => {
  let received: readonly ChatMessage[] = [];
  let receivedOptions: ChatOptions | undefined;
  const provider: ModelProvider = {
    id: "openai",
    model: "test-model",
    async chat() { return { content: "unused" }; },
    async streamChat(messages, options) {
      received = messages;
      receivedOptions = options;
      options?.onToken?.("answer-secret");
      return { content: "answer-secret" };
    },
  };
  const result = await benchmarkModel(provider, "benchmark prompt");
  assert.equal(received[0]?.content, "benchmark prompt");
  assert.equal(receivedOptions?.maxTokens, 32);
  assert.ok(Number.isFinite(result.firstTokenMs));
  assert.ok(Number.isFinite(result.totalMs));
  assert.ok((result.totalMs ?? 0) >= (result.firstTokenMs ?? 0));
  assert.doesNotMatch(JSON.stringify(result), /benchmark prompt|answer-secret/);
});

test("reports no first token for a non-streaming provider", async () => {
  const provider: ModelProvider = {
    id: "ollama",
    model: "test-model",
    async chat() { return { content: "answer-secret" }; },
  };
  const result = await benchmarkModel(provider, "hi");
  assert.equal(result.firstTokenMs, undefined);
  assert.ok(result.totalMs >= 0);
  assert.doesNotMatch(JSON.stringify(result), /answer-secret|hi/);
});

test("propagates provider failures from an explicit benchmark", async () => {
  const provider: ModelProvider = {
    id: "openai",
    model: "test-model",
    async chat() { throw new Error("offline"); },
  };
  await assert.rejects(benchmarkModel(provider), /offline/);
});
