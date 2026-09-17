import assert from "node:assert/strict";
import test from "node:test";

import {
  executeProviderCommand,
  getCurrentModel,
  getProviderStatuses,
  listModels,
  listProviders,
  testProviders,
  type ProviderManagementConfig,
} from "../dist/provider-command.js";

const SECRET = "sk-test-secret-do-not-echo";
const ALL_KEYS_ENV = {
  OPENAI_API_KEY: SECRET,
  ANTHROPIC_API_KEY: "anthropic-secret",
  GEMINI_API_KEY: "gemini-secret",
  OLLAMA_BASE_URL: "http://ollama.test:11434",
} as const;

function json(value: unknown): string {
  return JSON.stringify(value);
}

test("providers list is provider-free, stable, and covers all four model providers", () => {
  let fetchCalls = 0;
  const result = listProviders({
    fetch: async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    },
    env: { OPENAI_API_KEY: SECRET },
  });

  assert.equal(result.ok, true);
  assert.equal(result.command, "providers list");
  assert.deepEqual(
    result.providers.map((provider) => provider.id),
    ["ollama", "openai", "anthropic", "gemini"]
  );
  assert.equal(fetchCalls, 0);
  assert.doesNotMatch(json(result), /sk-test-secret|anthropic-secret|gemini-secret/);
  assert.deepEqual(Object.keys(result.providers[0] ?? {}).sort(), [
    "auth",
    "baseUrl",
    "configured",
    "defaultModel",
    "enabled",
    "id",
    "model",
    "name",
    "reason",
    "state",
  ]);
});

test("provider status reports configuration presence for Ollama and all API-key providers", () => {
  const configured = getProviderStatuses({ env: ALL_KEYS_ENV });
  assert.equal(configured.ok, true);
  assert.deepEqual(
    configured.providers.map((provider) => [provider.id, provider.configured, provider.state]),
    [
      ["ollama", true, "ready"],
      ["openai", true, "ready"],
      ["anthropic", true, "ready"],
      ["gemini", true, "ready"],
    ]
  );
  assert.equal(configured.providers.find((provider) => provider.id === "ollama")?.auth, "none");
  assert.doesNotMatch(json(configured), /sk-test-secret|anthropic-secret|gemini-secret/);
});

test("provider status reports missing API keys without echoing credentials", () => {
  const result = getProviderStatuses({
    env: {
      OLLAMA_BASE_URL: "http://localhost:11434",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
    },
  });

  assert.equal(result.ok, true);
  for (const id of ["openai", "anthropic", "gemini"] as const) {
    const provider = result.providers.find((item) => item.id === id);
    assert.equal(provider?.configured, false);
    assert.equal(provider?.state, "missing_config");
    assert.equal(provider?.reason, "api_key_missing");
  }
  assert.doesNotMatch(json(result), /sk-test-secret|anthropic-secret|gemini-secret|password=|token=/i);
});

test("provider status accepts injected project config and environment precedence", () => {
  const config: ProviderManagementConfig = {
    defaultProvider: "openai",
    defaultModel: "config-default-model",
    providers: {
      openai: {
        model: "config-openai-model",
        apiKey: "config-secret",
        baseUrl: "https://config.example/v1",
      },
      ollama: {
        model: "config-ollama-model",
      },
    },
  };

  const result = getProviderStatuses({
    config,
    env: {
      OPENAI_API_KEY: SECRET,
      OPENAI_BASE_URL: "https://env.example/v1",
      DEV_AGENT_OPENAI_MODEL: "env-openai-model",
    },
    provider: "openai",
  });

  assert.equal(result.ok, true);
  assert.equal(result.providers.length, 1);
  const provider = result.providers[0];
  assert.equal(provider?.id, "openai");
  assert.equal(provider?.model, "env-openai-model");
  assert.equal(provider?.baseUrl, "https://env.example");
  assert.equal(provider?.configured, true);
  assert.doesNotMatch(json(result), /config-secret|sk-test-secret/);
});

test("providers test uses an injected fetch and performs no default network access", async () => {
  let fetchCalls = 0;
  const skipped = await testProviders({ env: ALL_KEYS_ENV });
  assert.equal(skipped.ok, true);
  assert.ok(skipped.providers.every((provider) => provider.state === "skipped"));
  assert.ok(skipped.providers.every((provider) => provider.reason === "probe_not_configured"));

  const tested = await testProviders({
    env: ALL_KEYS_ENV,
    fetch: async (input, init) => {
      fetchCalls += 1;
      assert.equal(init?.method, "GET");
      assert.match(String(input), /^(http:\/\/ollama\.test:11434\/api\/tags|https:\/\/api\.openai\.com\/v1\/models|https:\/\/api\.anthropic\.com\/v1\/models|https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models)$/);
      return new Response("{}", { status: 200 });
    },
    now: () => 1000,
  });

  assert.equal(tested.ok, true);
  assert.equal(fetchCalls, 4);
  assert.ok(tested.providers.every((provider) => provider.state === "passed"));
  assert.ok(tested.providers.every((provider) => provider.checked === true));
  assert.ok(tested.providers.every((provider) => provider.latencyMs === 0));
  assert.doesNotMatch(json(tested), /sk-test-secret|anthropic-secret|gemini-secret/);
});

test("providers test returns stable reasons for HTTP and network failures", async () => {
  const httpFailure = await testProviders({
    provider: "openai",
    env: { OPENAI_API_KEY: SECRET },
    fetch: async () => new Response("unauthorized body with secret", { status: 401 }),
  });
  assert.equal(httpFailure.ok, true);
  assert.equal(httpFailure.providers[0]?.state, "failed");
  assert.equal(httpFailure.providers[0]?.reason, "authentication_failed");
  assert.equal(httpFailure.providers[0]?.httpStatus, 401);
  assert.doesNotMatch(json(httpFailure), /unauthorized body|sk-test-secret/);

  const networkFailure = await testProviders({
    provider: "anthropic",
    env: { ANTHROPIC_API_KEY: "anthropic-secret" },
    fetch: async () => {
      throw new Error(`network failed with anthropic-secret`);
    },
  });
  assert.equal(networkFailure.ok, true);
  assert.equal(networkFailure.providers[0]?.state, "failed");
  assert.equal(networkFailure.providers[0]?.reason, "network_error");
  assert.doesNotMatch(json(networkFailure), /network failed|anthropic-secret/);
});

test("providers test supports injected probes without leaking probe details", async () => {
  let seenKey: string | undefined;
  const result = await testProviders({
    provider: "gemini",
    env: { GEMINI_API_KEY: "gemini-secret" },
    probes: {
      gemini: async (context) => {
        seenKey = context.apiKey;
        return { ok: false, status: 503, detail: "provider response contains gemini-secret" };
      },
    },
  });

  assert.equal(seenKey, "gemini-secret");
  assert.equal(result.ok, true);
  assert.equal(result.providers[0]?.state, "failed");
  assert.equal(result.providers[0]?.reason, "server_error");
  assert.equal(result.providers[0]?.httpStatus, 503);
  assert.doesNotMatch(json(result), /gemini-secret|provider response contains/);
});

test("models list and current model resolve config, environment, and defaults", () => {
  const config: ProviderManagementConfig = {
    defaultProvider: "openai",
    defaultModel: "config-global-model",
    models: {
      openai: ["gpt-config-a", "gpt-config-b"],
      ollama: ["qwen-config"],
    },
    providers: {
      anthropic: { model: "claude-config" },
    },
  };
  const options = {
    config,
    env: {
      DEV_AGENT_MODEL_PROVIDER: "openai",
      DEV_AGENT_MODEL: "gpt-env-current",
      DEV_AGENT_OLLAMA_MODEL: "qwen-env",
    },
  };

  const listed = listModels(options);
  assert.equal(listed.ok, true);
  assert.equal(listed.currentProvider, "openai");
  assert.deepEqual(
    listed.models.filter((model) => model.provider === "openai").map((model) => model.model),
    ["gpt-env-current", "gpt-config-a", "gpt-config-b", "config-global-model", "gpt-4o-mini"]
  );
  assert.equal(listed.models.find((model) => model.current)?.model, "gpt-env-current");
  assert.ok(listed.models.some((model) => model.model === "qwen-env" && model.source === "environment"));
  assert.ok(listed.models.some((model) => model.model === "claude-config" && model.source === "config"));
  assert.doesNotMatch(json(listed), /config-secret|api[_-]?key|token/i);

  const current = getCurrentModel(options);
  assert.equal(current.ok, true);
  assert.equal(current.provider, "openai");
  assert.equal(current.model, "gpt-env-current");
  assert.equal(current.source, "environment");
});

test("executeProviderCommand dispatches provider and model operations with JSON-safe results", async () => {
  const providers = await executeProviderCommand(
    { resource: "providers", action: "status" },
    { env: { OPENAI_API_KEY: SECRET } }
  );
  assert.equal(providers.ok, true);
  assert.equal(providers.command, "providers status");

  const models = await executeProviderCommand(
    { resource: "models", action: "current" },
    { env: { DEV_AGENT_MODEL_PROVIDER: "ollama", DEV_AGENT_MODEL: "qwen-test" } }
  );
  assert.equal(models.ok, true);
  assert.equal(models.command, "models current");
  assert.equal(models.provider, "ollama");
  assert.equal(models.model, "qwen-test");

  const invalid = await executeProviderCommand(
    { resource: "providers", action: "test", provider: "not-a-provider" },
    {}
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.reason, "invalid_provider");
  assert.doesNotMatch(json(invalid), /not-a-provider/);
});
