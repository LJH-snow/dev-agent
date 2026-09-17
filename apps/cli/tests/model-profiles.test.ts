import assert from "node:assert/strict";
import test from "node:test";

import {
  formatModelSelectionMetadata,
  ModelProfileError,
  resolveFallbackSelection,
  resolveModelSelection,
  type CliConfigLike,
} from "../dist/model-profiles.js";

const config: CliConfigLike = {
  defaultProvider: "openai",
  defaultModel: "gpt-4o-mini",
  profiles: {
    local: { provider: "ollama", model: "qwen3:4b-instruct" },
    fast: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    backup: { provider: "gemini", model: "gemini-2.5-flash" },
  },
  aliases: {
    quick: "fast",
    localModel: { profile: "local" },
  },
  fallback: { enabled: true, order: ["backup"] },
};

function assertModelProfileError(error: unknown, code: string): void {
  assert.ok(error instanceof ModelProfileError);
  assert.equal(error.code, code);
  assert.equal(error.message, ModelProfileError.messageFor(code as never));
}

test("explicit provider/model override profile, environment, and config defaults", () => {
  const result = resolveModelSelection({
    config,
    profile: "local",
    provider: "ollama",
    model: "qwen3:4b-instruct",
    env: {
      DEV_AGENT_MODEL_PROVIDER: "anthropic",
      DEV_AGENT_MODEL: "claude-sonnet-4-20250514",
    },
  });

  assert.deepEqual(result.selection, {
    provider: "ollama",
    model: "qwen3:4b-instruct",
  });
  assert.equal(result.metadata.reason, "explicit");
  assert.equal(result.metadata.source, "explicit");
  assert.equal(result.metadata.profile, "local");
});

test("environment provider/model override config defaults when no explicit selector is supplied", () => {
  const result = resolveModelSelection({
    config,
    env: {
      DEV_AGENT_MODEL_PROVIDER: "anthropic",
      DEV_AGENT_MODEL: "claude-sonnet-4-20250514",
    },
  });

  assert.deepEqual(result.selection, {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
  });
  assert.equal(result.metadata.reason, "environment");
  assert.equal(result.metadata.source, "environment");
});

test("profile and alias selectors resolve to metadata-only provider/model choices", () => {
  const profile = resolveModelSelection({ config, profile: "local" });
  assert.deepEqual(profile.selection, {
    provider: "ollama",
    model: "qwen3:4b-instruct",
  });
  assert.equal(profile.metadata.reason, "profile");
  assert.equal(profile.metadata.profile, "local");

  const alias = resolveModelSelection({ config, alias: "quick" });
  assert.deepEqual(alias.selection, {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
  });
  assert.equal(alias.metadata.reason, "alias");
  assert.equal(alias.metadata.alias, "quick");
});

test("unknown provider, profile, and alias use stable error codes without echoing values", () => {
  assert.throws(
    () => resolveModelSelection({ provider: "private-provider" }),
    (error: unknown) => {
      assertModelProfileError(error, "unknown_provider");
      assert.doesNotMatch(String(error), /private-provider/);
      return true;
    },
  );
  assert.throws(
    () => resolveModelSelection({ config, profile: "missing-profile" }),
    (error: unknown) => {
      assertModelProfileError(error, "unknown_profile");
      assert.doesNotMatch(String(error), /missing-profile/);
      return true;
    },
  );
  assert.throws(
    () => resolveModelSelection({ config, alias: "missing-alias" }),
    (error: unknown) => {
      assertModelProfileError(error, "unknown_alias");
      assert.doesNotMatch(String(error), /missing-alias/);
      return true;
    },
  );
});

test("empty model values fail closed with a stable error", () => {
  assert.throws(
    () =>
      resolveModelSelection({
        config: {
          profiles: { broken: { provider: "ollama", model: "   " } },
        },
        profile: "broken",
      }),
    (error: unknown) => {
      assertModelProfileError(error, "empty_model");
      return true;
    },
  );
  assert.throws(
    () => resolveModelSelection({ provider: "ollama", model: "" }),
    (error: unknown) => {
      assertModelProfileError(error, "empty_model");
      return true;
    },
  );
});

test("fallback does not change the selection unless enabled is explicitly true", () => {
  const primary = resolveModelSelection({
    config: {
      profiles: {
        primary: { provider: "openai", model: "gpt-4o-mini" },
        backup: { provider: "ollama", model: "qwen3:4b-instruct" },
      },
      fallback: { order: ["backup"] },
    },
    profile: "primary",
  });

  const result = resolveFallbackSelection({
    config: {
      profiles: {
        primary: { provider: "openai", model: "gpt-4o-mini" },
        backup: { provider: "ollama", model: "qwen3:4b-instruct" },
      },
      fallback: { order: ["backup"] },
    },
    current: primary,
    failure: "unavailable",
  });

  assert.equal(result.changed, false);
  assert.deepEqual(result.selection, primary.selection);
  assert.equal(result.metadata.reason, "fallback-disabled");
});

test("enabled fallback selects the next profile and records only a structured reason", () => {
  const fallbackConfig: CliConfigLike = {
    profiles: {
      primary: { provider: "openai", model: "gpt-4o-mini" },
      backup: { provider: "ollama", model: "qwen3:4b-instruct" },
    },
    fallback: { enabled: true, order: ["backup"] },
  };
  const primary = resolveModelSelection({ config: fallbackConfig, profile: "primary" });
  const result = resolveFallbackSelection({
    config: fallbackConfig,
    current: primary,
    failure: "rate_limited",
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.selection, {
    provider: "ollama",
    model: "qwen3:4b-instruct",
  });
  assert.equal(result.metadata.reason, "fallback");
  assert.equal(result.metadata.failureReason, "rate_limited");
  assert.equal(result.metadata.fallbackIndex, 1);
});

test("fallback cycles fail closed with a stable error", () => {
  const cyclicConfig: CliConfigLike = {
    profiles: {
      primary: {
        provider: "openai",
        model: "gpt-4o-mini",
        fallback: "backup",
      },
      backup: {
        provider: "ollama",
        model: "qwen3:4b-instruct",
        fallback: "primary",
      },
    },
    fallback: { enabled: true },
  };
  const primary = resolveModelSelection({ config: cyclicConfig, profile: "primary" });

  assert.throws(
    () => resolveFallbackSelection({ config: cyclicConfig, current: primary, failure: "timeout" }),
    (error: unknown) => {
      assertModelProfileError(error, "fallback_cycle");
      return true;
    },
  );
});

test("unknown fallback targets fail closed without exposing configuration details", () => {
  const fallbackConfig: CliConfigLike = {
    profiles: {
      primary: { provider: "openai", model: "gpt-4o-mini" },
    },
    fallback: { enabled: true, order: ["missing-backup"] },
  };
  const primary = resolveModelSelection({ config: fallbackConfig, profile: "primary" });

  assert.throws(
    () => resolveFallbackSelection({ config: fallbackConfig, current: primary, failure: "timeout" }),
    (error: unknown) => {
      assertModelProfileError(error, "unknown_profile");
      assert.doesNotMatch(String(error), /missing-backup/);
      return true;
    },
  );
});

test("formatted selection metadata contains no key, path, or raw provider error", () => {
  const result = resolveModelSelection({
    config: {
      defaultProvider: "ollama",
      defaultModel: "qwen3:4b-instruct",
      apiKey: "do-not-output",
      baseUrl: "/Users/Admin/private/provider",
    },
  });
  const formatted = formatModelSelectionMetadata(result);

  assert.equal(typeof formatted, "string");
  assert.doesNotMatch(formatted, /do-not-output|\/Users\/|apiKey|baseUrl|Error|stack/i);
  assert.deepEqual(JSON.parse(formatted), {
    provider: "ollama",
    model: "qwen3:4b-instruct",
    reason: "config",
    source: "config",
    fallback: { enabled: false, changed: false },
  });
});
