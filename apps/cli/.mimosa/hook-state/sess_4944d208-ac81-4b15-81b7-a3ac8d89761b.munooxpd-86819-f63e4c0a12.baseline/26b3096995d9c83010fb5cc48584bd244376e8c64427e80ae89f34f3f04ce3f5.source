import assert from "node:assert/strict";
import test from "node:test";
import { ModelSpeedModeController, type ModelProvider } from "@dev-agent/model";
import {
  AdaptiveModelProvider,
  ModelRoutingController,
  classifyPromptRoute,
  executeModelRoutingCommand,
  resolveModelRoutingConfig,
} from "../dist/model-routing.js";
import { SessionModelBudget } from "../dist/model-budget.js";
import { validateConfigValue } from "../dist/config-validation.js";

test("routing recognizes only standalone greetings as fast, not mixed code requests", () => {
  assert.deepEqual(classifyPromptRoute(" Ｈｉ！ "), { mode: "fast", reason: "greeting" });
  assert.deepEqual(classifyPromptRoute("你好！"), { mode: "fast", reason: "greeting" });
  assert.deepEqual(classifyPromptRoute("hi, fix this bug"), { mode: "balanced", reason: "standard" });
  assert.deepEqual(classifyPromptRoute("rename the heading to Hello"), { mode: "balanced", reason: "standard" });
  assert.deepEqual(classifyPromptRoute("重构跨模块认证逻辑并修复并发问题"), { mode: "deep", reason: "complex" });
  assert.deepEqual(classifyPromptRoute("Investigate a race condition in the migration"), { mode: "deep", reason: "complex" });
  assert.deepEqual(classifyPromptRoute("x".repeat(20_000)), { mode: "deep", reason: "large-request" });
});

test("route commands respect a manual speed selection and disclose only decision metadata", () => {
  const speed = new ModelSpeedModeController();
  const routing = new ModelRoutingController(speed);
  const budget = new SessionModelBudget();
  routing.select("hi");
  assert.equal(speed.mode, "fast");
  routing.setManualMode("deep");
  assert.deepEqual(routing.select("hi"), { mode: "deep", reason: "manual" });
  assert.equal(executeModelRoutingCommand(":routes", routing, budget), undefined);
  assert.match(executeModelRoutingCommand("/route auto", routing, budget)!, /auto/);
  assert.deepEqual(routing.select("hi"), { mode: "fast", reason: "greeting" });
  assert.match(executeModelRoutingCommand(":route manual", routing, budget)!, /manual/);
  assert.equal(routing.select("refactor secret-test-value").mode, "fast");
  assert.doesNotMatch(executeModelRoutingCommand(":route", routing, budget)!, /secret-test-value/);
  assert.match(executeModelRoutingCommand(":route invalid", routing, budget)!, /Usage/);
});

test("adaptive provider routes actual requests and does not reclassify tool output as a request", async () => {
  const speed = new ModelSpeedModeController();
  const routing = new ModelRoutingController(speed);
  const selected: string[] = [];
  const providerFor = (mode: string): ModelProvider => ({
    id: "ollama", model: mode,
    async chat() { selected.push(mode); return { content: mode }; },
    async streamChat(_messages, options) { selected.push(mode); options?.onToken?.(mode); return { content: mode }; },
  });
  const provider = new AdaptiveModelProvider({
    controller: routing,
    initial: providerFor("balanced"),
    getProvider: (mode, policy) => providerFor(`${policy}:${mode}`),
  });
  assert.equal((await provider.chat([{ role: "user", content: "hi" }])).content, "auto:fast");
  const tokens: string[] = [];
  await provider.streamChat([
    { role: "user", content: "Refactor the scheduler" },
    { role: "assistant", content: "Checking" },
    { role: "tool", content: "hello" },
  ], { onToken: (token) => tokens.push(token) });
  assert.deepEqual(tokens, ["auto:deep"]);
  routing.setManualMode("balanced");
  await provider.chat([{ role: "user", content: "hi" }]);
  assert.deepEqual(selected, ["auto:fast", "auto:deep", "manual:balanced"]);
  assert.equal(provider.model, "manual:balanced");
});

test("routing config validates nested limits and never echoes rejected values", () => {
  assert.deepEqual(resolveModelRoutingConfig(undefined), { profiles: {}, budget: {} });
  assert.deepEqual(resolveModelRoutingConfig({
    mode: "auto", profiles: { fast: "local", deep: "careful" }, budget: { maxTokens: 1200, maxCostUsd: 0.5 },
  }), { mode: "auto", profiles: { fast: "local", deep: "careful" }, budget: { maxTokens: 1200, maxCostUsd: 0.5 } });
  for (const value of [null, [], { mode: "secret-test-value" }, { profiles: { fast: "" } },
    { budget: { maxTokens: -1 } }, { budget: { maxTokens: 1.5 } }, { budget: { maxCostUsd: Infinity } },
    { budget: { typo: 3 } }, { profiles: { typo: "secret-test-value" } }]) {
    assert.throws(() => resolveModelRoutingConfig(value), (error: Error) =>
      /routing/i.test(error.message) && !error.message.includes("secret-test-value"));
  }
  const valid = validateConfigValue({ routing: { mode: "auto", budget: { maxTokens: 0 } } });
  assert.equal(valid.valid, true);
  assert.equal(valid.diagnostics.some((item) => item.path === "routing"), false);
  const invalid = validateConfigValue({ routing: { budget: { maxCostUsd: -1 } } });
  assert.equal(invalid.valid, false);
});

test("budget commands set explicit limits without discarding recorded spending", async () => {
  const budget = new SessionModelBudget();
  const routing = new ModelRoutingController(new ModelSpeedModeController());
  const provider = budget.wrap({ id: "ollama", model: "local", async chat() {
    return { content: "ok", usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } };
  } });
  await provider.chat([]);
  assert.match(executeModelRoutingCommand(":budget tokens 10", routing, budget)!, /10/);
  await assert.rejects(provider.chat([]), /token budget/i);
  assert.match(executeModelRoutingCommand(":budget tokens off", routing, budget)!, /unlimited/);
  await provider.chat([]);
  assert.equal(budget.snapshot().tokens, 20);
  assert.match(executeModelRoutingCommand(":budget cost NaN", routing, budget)!, /Usage/);
  assert.match(executeModelRoutingCommand(":budget duration 25", routing, budget)!, /25/);
  assert.equal(budget.snapshot().limits.maxDurationMs, 25);
});
