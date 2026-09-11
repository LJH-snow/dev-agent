import assert from "node:assert/strict";
import test from "node:test";

import {
  parseConfig,
  loadConfig,
  parseApprovalMode,
  resolveApprovalMode,
  resolveMaxContextChars,
  resolveMaxTurns,
  resolveModel,
  resolveProviderId,
  resolveRustBinaryPath,
  resolveSummarizeContext,
  resolveSummaryMaxChars,
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

test("resolveSummarizeContext reads the environment flag before the config file", () => {
  assert.equal(resolveSummarizeContext({}, { DEV_AGENT_SUMMARIZE_CONTEXT: "1" }), true);
  assert.equal(resolveSummarizeContext({}, { DEV_AGENT_SUMMARIZE_CONTEXT: "true" }), true);
  assert.equal(resolveSummarizeContext({}, { DEV_AGENT_SUMMARIZE_CONTEXT: "YES" }), true);
  assert.equal(resolveSummarizeContext({ summarizeContext: true }, {}), true);
  assert.equal(
    resolveSummarizeContext(
      { summarizeContext: true },
      { DEV_AGENT_SUMMARIZE_CONTEXT: "false" }
    ),
    false
  );
  assert.equal(resolveSummarizeContext({}, { DEV_AGENT_SUMMARIZE_CONTEXT: "maybe" }), false);
  assert.equal(resolveSummarizeContext({}, {}), false);
});

test("resolveSummaryMaxChars prefers env, then config, then no cap", () => {
  assert.equal(resolveSummaryMaxChars({}, { DEV_AGENT_SUMMARY_MAX_CHARS: "1500" }), 1500);
  assert.equal(resolveSummaryMaxChars({ summaryMaxChars: 800 }, {}), 800);
  assert.equal(
    resolveSummaryMaxChars(
      { summaryMaxChars: 800 },
      { DEV_AGENT_SUMMARY_MAX_CHARS: "1500" }
    ),
    1500
  );
  assert.equal(resolveSummaryMaxChars({}, { DEV_AGENT_SUMMARY_MAX_CHARS: "0" }), undefined);
  assert.equal(resolveSummaryMaxChars({}, { DEV_AGENT_SUMMARY_MAX_CHARS: "abc" }), undefined);
  assert.equal(resolveSummaryMaxChars({ summaryMaxChars: -1 }, {}), undefined);
  assert.equal(resolveSummaryMaxChars({}, {}), undefined);
});

test("resolveApprovalMode prefers env, then config, then allow", () => {
  assert.equal(
    resolveApprovalMode(
      { approvalMode: "ask" },
      { DEV_AGENT_APPROVAL: "deny-dangerous" }
    ),
    "deny-dangerous"
  );
  assert.equal(resolveApprovalMode({ approvalMode: "ask" }, {}), "ask");
  assert.equal(resolveApprovalMode({}, {}), "allow");
  assert.equal(resolveApprovalMode({}, { DEV_AGENT_APPROVAL: "nonsense" }), "allow");
  assert.equal(resolveApprovalMode({ approvalMode: "nonsense" }, {}), "allow");
});

test("parseApprovalMode normalises known modes and rejects the rest", () => {
  assert.equal(parseApprovalMode("DENY-DANGEROUS"), "deny-dangerous");
  assert.equal(parseApprovalMode(" ask "), "ask");
  assert.equal(parseApprovalMode("allow"), "allow");
  assert.equal(parseApprovalMode("nope"), undefined);
  assert.equal(parseApprovalMode(undefined), undefined);
});
