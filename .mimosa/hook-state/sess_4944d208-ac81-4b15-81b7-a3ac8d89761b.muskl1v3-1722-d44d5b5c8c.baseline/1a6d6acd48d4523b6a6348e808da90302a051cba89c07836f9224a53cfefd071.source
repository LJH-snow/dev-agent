import assert from "node:assert/strict";
import test from "node:test";
import { SessionModelBudget } from "../dist/model-budget.js";
import type { ModelProvider } from "@dev-agent/model";

const usage = { promptTokens: 4, completionTokens: 6, totalTokens: 10 };
function model(chat: ModelProvider["chat"], name = "test-model"): ModelProvider {
  return { id: "openai", model: name, chat };
}

test("tokens are accumulated per call and block a later call without a provider request", async () => {
  let calls = 0;
  const limits: number[] = [];
  const budget = new SessionModelBudget({ maxTokens: 15 });
  const provider = budget.wrap(model(async (_messages, options) => {
    calls += 1;
    limits.push(options?.maxTokens ?? -1);
    return { content: "ok", usage };
  }));
  await provider.chat([]);
  await provider.chat([], { maxTokens: 50 });
  await assert.rejects(provider.chat([]), /token budget/i);
  assert.equal(calls, 2);
  assert.deepEqual(limits, [15, 5]);
  assert.equal(budget.snapshot().tokens, 20); // provider can report input + output above remaining allowance
});

test("cost is accounted per model and includes configured cache discounts", async () => {
  const budget = new SessionModelBudget({ maxCostUsd: 0.000024 }, {
    "test-model": { inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: 0.5 },
    "other-model": { inputPerMillion: 2, outputPerMillion: 2 },
  });
  await budget.wrap(model(async () => ({ content: "ok", usage: { ...usage, cachedPromptTokens: 4 } }))).chat([]);
  assert.equal(budget.snapshot().estimatedCostUsd, 0.000014);
  await budget.wrap(model(async () => ({ content: "ok", usage }), "other-model")).chat([]);
  assert.ok(Math.abs(budget.snapshot().estimatedCostUsd - 0.000034) < 1e-12);
  await assert.rejects(budget.wrap(model(async () => ({ content: "must not run", usage }))).chat([]), /cost budget/i);
});

test("a configured cost limit refuses an unpriced model before sending anything", async () => {
  let calls = 0;
  const budget = new SessionModelBudget({ maxCostUsd: 1 });
  await assert.rejects(budget.wrap(model(async () => { calls++; return { content: "ok", usage }; })).chat([]), /pricing/i);
  assert.equal(calls, 0);
  assert.equal(budget.snapshot().requests, 0);
});

test("missing or malformed usage cannot silently bypass token or cost limits", async () => {
  for (const invalid of [undefined, { ...usage, totalTokens: NaN }, { ...usage, completionTokens: -1 }]) {
    const budget = new SessionModelBudget({ maxTokens: 100 });
    const provider = budget.wrap(model(async () => ({ content: "answer", usage: invalid })));
    assert.equal((await provider.chat([])).content, "answer");
    await assert.rejects(provider.chat([]), /usage.*unknown|unknown.*usage/i);
    assert.equal(budget.snapshot().unknownUsageRequests, 1);
  }
});

test("reported total cannot undercount the prompt and completion token sum", async () => {
  const budget = new SessionModelBudget({ maxTokens: 10 });
  const provider = budget.wrap(model(async () => ({ content: "answer", usage: { ...usage, totalTokens: 1 } })));
  await provider.chat([]);
  assert.equal(budget.snapshot().tokens, 10);
  await assert.rejects(provider.chat([]), /token budget/i);
});

test("unpriced usage remains visible when a cost limit is introduced later", async () => {
  const budget = new SessionModelBudget();
  const provider = budget.wrap(model(async () => ({ content: "ok", usage })));
  await provider.chat([]);
  budget.setLimit("maxCostUsd", 1);
  await assert.rejects(provider.chat([]), /unknown|unpriced/i);
  assert.equal(budget.snapshot().unpricedRequests, 1);
});

test("stream callbacks are forwarded and a failed partial stream is never treated as free", async () => {
  let calls = 0;
  const budget = new SessionModelBudget({ maxTokens: 100 });
  const provider = budget.wrap({
    ...model(async () => ({ content: "unused" })),
    async streamChat(_messages, options) {
      calls++;
      options?.onReasoning?.("reason");
      options?.onToken?.("partial");
      throw new Error("provider interrupted");
    },
  });
  const tokens: string[] = [];
  await assert.rejects(provider.streamChat!([], { onToken: (t) => tokens.push(t), onReasoning: (t) => tokens.push(t) }));
  assert.deepEqual(tokens, ["reason", "partial"]);
  await assert.rejects(provider.chat([]), /unknown/i);
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().unknownUsageRequests, 1);
});

test("concurrent requests share the ledger and recheck the remaining budget after waiting", async () => {
  const budget = new SessionModelBudget({ maxTokens: 10 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const provider = budget.wrap(model(async () => { calls++; await gate; return { content: "ok", usage }; }));
  const first = provider.chat([]);
  const second = provider.chat([]);
  const secondRejected = assert.rejects(second, /token budget/i);
  release();
  await first;
  await secondRejected;
  assert.equal(calls, 1);
});

test("an already cancelled request consumes no budget and queued cancellation cannot call the provider", async () => {
  const budget = new SessionModelBudget({ maxTokens: 100 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const provider = budget.wrap(model(async () => { calls++; await gate; return { content: "ok", usage }; }));
  await assert.rejects(provider.chat([], { signal: AbortSignal.abort() }));
  assert.equal(budget.snapshot().requests, 0);
  const first = provider.chat([]);
  const cancel = new AbortController();
  const queued = provider.chat([], { signal: cancel.signal });
  const rejected = assert.rejects(queued);
  cancel.abort();
  await rejected;
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().unknownUsageRequests, 0);
});

test("model-time limit cancels an in-flight request and blocks the next one", async () => {
  const budget = new SessionModelBudget({ maxDurationMs: 25 });
  let aborted = false;
  const provider = budget.wrap(model(async (_messages, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => { aborted = true; reject(options!.signal!.reason); }, { once: true });
  })));
  await assert.rejects(provider.chat([]), /time budget/i);
  assert.equal(aborted, true);
  await assert.rejects(provider.chat([]), /time budget/i);
  assert.equal(budget.snapshot().requests, 1);
});

test("zero limits block before the first request and invalid limits fail closed", async () => {
  for (const limit of ["maxTokens", "maxCostUsd", "maxDurationMs"] as const) {
    const budget = new SessionModelBudget({ [limit]: 0 });
    await assert.rejects(budget.wrap(model(async () => ({ content: "must not run", usage }))).chat([]), /budget/i);
  }
  assert.throws(() => new SessionModelBudget({ maxTokens: -1 }));
  assert.throws(() => new SessionModelBudget({ maxCostUsd: NaN }));
  assert.throws(() => new SessionModelBudget({ maxDurationMs: Infinity }));
});
