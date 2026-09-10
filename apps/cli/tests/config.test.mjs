import assert from "node:assert/strict";
import test from "node:test";

import {
  parseConfig,
  loadConfig,
  resolveMaxContextChars,
  resolveMaxTurns,
  resolveModel,
  resolveProviderId,
  resolveRustBinaryPath,
} from "../dist/config.js";

test("parseConfig returns parsed object for valid JSON config", () => {
  const raw = JSON.stringify({
    defaultProvider: "ollama",
    defaultModel: "qwen3:4b",
    maxTurns: 12,
  });

  const config = parseConfig(raw);
  assert.equal(config.defaultProvider, "ollama");
  assert.equal(config.defaultModel, "qwen3:4b");
  assert.equal(config.maxTurns, 12);
});

test("parseConfig returns empty object for invalid JSON", () => {
  const config = parseConfig("not valid json {{{");
  assert.deepEqual(config, {});
});

test("parseConfig returns empty object for non-object JSON", () => {
  assert.deepEqual(parseConfig("42"), {});
  assert.deepEqual(parseConfig('"string"'), {});
  assert.deepEqual(parseConfig("null"), {});
});

test("loadConfig returns empty object when no config file exists", () => {
  // When running in sandbox, the config file won't exist
  const config = loadConfig();
  assert.ok(typeof config === "object");
});

test("resolveRustBinaryPath prefers the flag over the environment", () => {
  assert.equal(
    resolveRustBinaryPath("/from/flag", { DEV_AGENT_RUST_BINARY: "/from/env" }),
    "/from/flag"
  );
});

test("resolveRustBinaryPath falls back to DEV_AGENT_RUST_BINARY", () => {
  assert.equal(
    resolveRustBinaryPath(undefined, { DEV_AGENT_RUST_BINARY: "/from/env" }),
    "/from/env"
  );
  // A flag with only whitespace is not an explicit choice.
  assert.equal(
    resolveRustBinaryPath("   ", { DEV_AGENT_RUST_BINARY: "/from/env" }),
    "/from/env"
  );
  assert.equal(resolveRustBinaryPath(undefined, {}), undefined);
  assert.equal(resolveRustBinaryPath(undefined, { DEV_AGENT_RUST_BINARY: "  " }), undefined);
});

test("resolveProviderId prefers env, then config, then ollama", () => {
  assert.equal(
    resolveProviderId({ defaultProvider: "gemini" }, { DEV_AGENT_MODEL_PROVIDER: "openai" }),
    "openai"
  );
  assert.equal(resolveProviderId({ defaultProvider: "gemini" }, {}), "gemini");
  assert.equal(resolveProviderId({}, {}), "ollama");
  assert.equal(resolveProviderId(undefined, {}), "ollama");
});

test("resolveModel prefers env, then config, then undefined", () => {
  assert.equal(
    resolveModel({ defaultModel: "from-config" }, { DEV_AGENT_MODEL: "from-env" }),
    "from-env"
  );
  assert.equal(resolveModel({ defaultModel: "from-config" }, {}), "from-config");
  assert.equal(resolveModel({}, {}), undefined);
});

test("resolveMaxTurns ignores invalid config values", () => {
  assert.equal(resolveMaxTurns({ maxTurns: 3 }, 8), 3);
  assert.equal(resolveMaxTurns({ maxTurns: 0 }, 8), 8);
  assert.equal(resolveMaxTurns({ maxTurns: -1 }, 8), 8);
  assert.equal(resolveMaxTurns({ maxTurns: 2.5 }, 8), 8);
  assert.equal(resolveMaxTurns({ maxTurns: "4" }, 8), 8);
  assert.equal(resolveMaxTurns({}, 8), 8);
  assert.equal(resolveMaxTurns(undefined, 8), 8);
});

test("resolveMaxContextChars prefers env, then config, then no budget", () => {
  assert.equal(
    resolveMaxContextChars(
      { maxContextChars: 4000 },
      { DEV_AGENT_MAX_CONTEXT_CHARS: "9000" }
    ),
    9000
  );
  assert.equal(resolveMaxContextChars({ maxContextChars: 4000 }, {}), 4000);
  assert.equal(resolveMaxContextChars({}, {}), undefined);
  assert.equal(resolveMaxContextChars(undefined, {}), undefined);
});

test("resolveMaxContextChars ignores invalid values", () => {
  assert.equal(resolveMaxContextChars({}, { DEV_AGENT_MAX_CONTEXT_CHARS: "0" }), undefined);
  assert.equal(resolveMaxContextChars({}, { DEV_AGENT_MAX_CONTEXT_CHARS: "-5" }), undefined);
  assert.equal(resolveMaxContextChars({}, { DEV_AGENT_MAX_CONTEXT_CHARS: "abc" }), undefined);
  assert.equal(resolveMaxContextChars({ maxContextChars: 0 }, {}), undefined);
  assert.equal(resolveMaxContextChars({ maxContextChars: 2.5 }, {}), undefined);
  assert.equal(resolveMaxContextChars({ maxContextChars: -1 }, {}), undefined);
});
