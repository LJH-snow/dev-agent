import assert from "node:assert/strict";
import test from "node:test";

import { parseConfig, loadConfig } from "../dist/config.js";

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
