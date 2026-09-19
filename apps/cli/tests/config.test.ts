import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseConfig,
  loadConfig,
  parseApprovalMode,
  resolveApprovalMode,
  resolveConfigPath,
  resolveMaxContextChars,
  resolveMaxTurns,
  resolveModel,
  resolveProviderId,
  resolveRustBinaryPath,
  resolveSummarizeContext,
  resolveSummaryMaxChars,
  resolveValidationPolicy,
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

test("loadConfig rejects an invalid validation policy instead of ignoring it", async () => {
  const home = await mkdtemp(join(tmpdir(), "dev-agent-config-validation-"));
  const configPath = join(home, "config.json");
  try {
    await writeFile(configPath, JSON.stringify({ validation: { policy: "unsafe" } }), "utf8");

    assert.throws(
      () => loadConfig(configPath),
      /unknown validation policy/i
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("loadConfig ignores a config file above the 1 MiB read limit", async () => {
  const home = await mkdtemp(join(tmpdir(), "dev-agent-config-limit-"));
  try {
    await mkdir(join(home, ".dev-agent"), { recursive: true });
    await writeFile(
      join(home, ".dev-agent", "config.json"),
      JSON.stringify({
        defaultProvider: "gemini",
        padding: "x".repeat(1024 * 1024),
      }),
      "utf8"
    );

    const config = loadConfig(join(home, ".dev-agent", "config.json"));
    assert.equal(config.defaultProvider, undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
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

test("invalid provider and model config values fall back instead of throwing", () => {
  const config = parseConfig(
    JSON.stringify({ defaultProvider: 42, defaultModel: false })
  );

  assert.equal(resolveProviderId(config, {}), "ollama");
  assert.equal(resolveModel(config, {}), undefined);
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
  assert.equal(resolveMaxTurns({ maxTurns: "4" } as any, 8), 8);
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
  assert.equal(resolveApprovalMode({ approvalMode: "nonsense" } as any, {}), "allow");
});

test("parseApprovalMode normalises known modes and rejects the rest", () => {
  assert.equal(parseApprovalMode("DENY-DANGEROUS"), "deny-dangerous");
  assert.equal(parseApprovalMode(" ask "), "ask");
  assert.equal(parseApprovalMode("allow"), "allow");
  assert.equal(parseApprovalMode(" REVIEW-WRITES "), "review-writes");
  assert.equal(resolveApprovalMode({ approvalMode: "review-writes" }, {}), "review-writes");
  assert.equal(parseApprovalMode("nope"), undefined);
  assert.equal(parseApprovalMode(undefined), undefined);
});


test("validation policy config accepts only predefined policy names", () => {
  assert.equal(parseConfig('{"validation":{"policy":"fast"}}').validation?.policy, "fast");
  assert.equal(parseConfig('{"validationPolicy":"strict"}').validationPolicy, "strict");
  assert.equal(resolveValidationPolicy({ validation: { policy: "default" } }, {}), "default");
  assert.equal(
    resolveValidationPolicy({}, { DEV_AGENT_VALIDATION_POLICY: "FAST" }),
    "fast"
  );
  assert.throws(
    () => parseConfig('{"validation":{"policy":"unsafe"}}'),
    /unknown validation policy/i
  );
  assert.throws(
    () => parseConfig('{"validation":{"policy":"fast","executable":"sh"}}'),
    /validation.*(only|unsupported|unknown)|executable/i
  );
  assert.throws(
    () => parseConfig('{"validation":{"policy":"fast","args":["-c","echo injected"]}}'),
    /validation.*(only|unsupported|unknown)|args/i
  );
});

test("resolveConfigPath prefers an explicit flag over the environment", () => {
  assert.equal(
    resolveConfigPath("project.json", {
      DEV_AGENT_CONFIG_FILE: "env.json",
    }, "/tmp/home", "/tmp/workspace"),
    "/tmp/workspace/project.json"
  );
});

test("resolveConfigPath uses DEV_AGENT_CONFIG_FILE before the user default", () => {
  assert.equal(
    resolveConfigPath(undefined, {
      DEV_AGENT_CONFIG_FILE: "config/project.json",
    }, "/tmp/home", "/tmp/workspace"),
    "/tmp/workspace/config/project.json"
  );
  assert.equal(
    resolveConfigPath(undefined, {}, "/tmp/home", "/tmp/workspace"),
    "/tmp/home/.dev-agent/config.json"
  );
});

test("resolveConfigPath uses the final project directory when project state is enabled", () => {
  const resolveWithProjectState = resolveConfigPath as unknown as (
    flagValue: string | undefined,
    env: Record<string, string | undefined>,
    homeDirectory: string,
    baseDirectory: string,
    projectState: boolean
  ) => string;

  assert.equal(
    resolveWithProjectState(undefined, {}, "/tmp/home", "/tmp/project", true),
    "/tmp/project/.dev-agent/config.json"
  );
  assert.equal(
    resolveWithProjectState("explicit.json", {}, "/tmp/home", "/tmp/project", true),
    "/tmp/project/explicit.json"
  );
  assert.equal(
    resolveWithProjectState(
      undefined,
      { DEV_AGENT_CONFIG_FILE: "env.json" },
      "/tmp/home",
      "/tmp/project",
      true
    ),
    "/tmp/project/env.json"
  );
});
