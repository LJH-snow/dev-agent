import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAndValidateConfig,
  validateConfigValue,
  type ConfigDiagnostic,
} from "../dist/config-validation.js";

function diagnosticAt(result: ReturnType<typeof validateConfigValue>, path: string): ConfigDiagnostic {
  const diagnostic = result.diagnostics.find((entry) => entry.path === path);
  assert.ok(diagnostic, `expected a diagnostic at ${path}`);
  return diagnostic;
}

test("accepts a complete config that matches the existing config shapes", () => {
  const result = validateConfigValue({
    defaultProvider: "openai",
    defaultModel: "gpt-4o-mini",
    maxTurns: 12,
    maxContextChars: 120_000,
    summarizeContext: true,
    summaryMaxChars: 2_000,
    validation: { policy: "default" },
    validationPolicy: "default",
    approvalMode: "review-writes",
    approval: {
      allow: ["npm test"],
      deny: ["\\bdeploy\\b"],
    },
    collaboration: { toolAllowlist: ["filesystem", "search"] },
    pricing: {
      "gpt-4o-mini": {
        inputPerMillion: 0.15,
        outputPerMillion: 0.6,
        cachedInputPerMillion: 0.1,
        cacheCreationInputPerMillion: 0.2,
      },
    },
    mcpServers: [
      {
        name: "files",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        env: { MCP_LOG_LEVEL: "info" },
        timeoutMs: 30_000,
      },
    ],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
});

test("accepts the empty config object", () => {
  assert.deepEqual(validateConfigValue({}), { valid: true, diagnostics: [] });
});

test("accepts supported Ink themes and rejects invalid ones", () => {
  assert.equal(validateConfigValue({ theme: "signal" }).valid, true);
  assert.equal(validateConfigValue({ theme: "ember" }).valid, true);
  const result = validateConfigValue({ theme: "neon" });
  assert.equal(result.valid, false);
  assert.equal(diagnosticAt(result, "theme").code, "invalid_theme");
});

test("reports invalid JSON without echoing the raw input", () => {
  const secret = "super-secret-api-key-value";
  const result = parseAndValidateConfig(`{"defaultModel":"${secret}",`);

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    path: "$",
    code: "invalid_json",
    message: "Configuration is not valid JSON.",
    severity: "error",
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("reports non-object JSON values as a structured root diagnostic", () => {
  const result = parseAndValidateConfig("[]");

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0]?.path, "$");
  assert.equal(result.diagnostics[0]?.code, "invalid_root_type");
});

test("reports unknown top-level and nested fields", () => {
  const result = validateConfigValue({
    unexpected: true,
    validation: { policy: "fast", executable: "sh" },
    approval: { allow: [], extra: "ignored" },
    collaboration: { extra: "ignored" },
    pricing: {
      model: {
        inputPerMillion: 1,
        outputPerMillion: 2,
        extraPrice: 3,
      },
    },
    mcpServers: [{ command: "node", extra: "ignored" }],
  });

  assert.equal(result.valid, false);
  for (const path of [
    "unexpected",
    "validation.executable",
    "approval.extra",
    "collaboration.extra",
    "pricing.model.extraPrice",
    "mcpServers[0].extra",
  ]) {
    assert.equal(diagnosticAt(result, path).code, "unknown_field");
  }
});

test("validates a caller-owned collaborative tool ceiling", () => {
  assert.equal(
    validateConfigValue({ collaboration: { toolAllowlist: [] } }).valid,
    true,
  );
  assert.equal(
    validateConfigValue({ collaboration: { toolAllowlist: ["filesystem", "mcp__docs.search"] } }).valid,
    true,
  );

  const wrongObject = validateConfigValue({ collaboration: [] });
  assert.equal(diagnosticAt(wrongObject, "collaboration").code, "invalid_type");

  const wrongList = validateConfigValue({ collaboration: { toolAllowlist: "filesystem" } });
  assert.equal(diagnosticAt(wrongList, "collaboration.toolAllowlist").code, "invalid_type");

  const invalidName = validateConfigValue({ collaboration: { toolAllowlist: [" filesystem"] } });
  assert.equal(diagnosticAt(invalidName, "collaboration.toolAllowlist[0]").code, "invalid_string");

  const duplicate = validateConfigValue({ collaboration: { toolAllowlist: ["filesystem", "filesystem"] } });
  assert.equal(diagnosticAt(duplicate, "collaboration.toolAllowlist[1]").code, "duplicate_tool");

  const oversized = validateConfigValue({
    collaboration: { toolAllowlist: Array.from({ length: 257 }, (_, index) => `tool-${index}`) },
  });
  assert.equal(diagnosticAt(oversized, "collaboration.toolAllowlist").code, "too_many_entries");
});

test("legacy per-task collaboration review flag is accepted but cannot disable review", () => {
  assert.equal(
    validateConfigValue({ collaboration: { reviewTaskToolScopes: false } }).valid,
    true,
  );
  assert.equal(
    validateConfigValue({ collaboration: { reviewTaskToolScopes: true } }).valid,
    true,
  );
  const invalid = validateConfigValue({
    collaboration: { reviewTaskToolScopes: "yes" },
  });
  assert.equal(
    diagnosticAt(invalid, "collaboration.reviewTaskToolScopes").code,
    "invalid_type",
  );
});

test("reports wrong field types and non-positive integer limits", () => {
  const result = validateConfigValue({
    defaultProvider: 42,
    defaultModel: false,
    maxTurns: "12",
    maxContextChars: 0,
    summarizeContext: "yes",
    summaryMaxChars: 2.5,
    approval: "not-an-object",
    mcpServers: {},
  });

  assert.equal(result.valid, false);
  assert.equal(diagnosticAt(result, "defaultProvider").code, "invalid_type");
  assert.equal(diagnosticAt(result, "defaultModel").code, "invalid_type");
  assert.equal(diagnosticAt(result, "maxTurns").code, "invalid_positive_integer");
  assert.equal(diagnosticAt(result, "maxContextChars").code, "invalid_positive_integer");
  assert.equal(diagnosticAt(result, "summarizeContext").code, "invalid_type");
  assert.equal(diagnosticAt(result, "summaryMaxChars").code, "invalid_positive_integer");
  assert.equal(diagnosticAt(result, "approval").code, "invalid_type");
  assert.equal(diagnosticAt(result, "mcpServers").code, "invalid_type");
});

test("rejects unsupported provider and empty model strings", () => {
  const result = validateConfigValue({
    defaultProvider: "unsupported-provider",
    defaultModel: "   ",
  });

  assert.equal(result.valid, false);
  assert.equal(diagnosticAt(result, "defaultProvider").code, "invalid_provider");
  assert.equal(diagnosticAt(result, "defaultModel").code, "invalid_model");
  assert.doesNotMatch(JSON.stringify(result), /unsupported-provider/);
});

test("validates approval mode and allow/deny string arrays", () => {
  const result = validateConfigValue({
    approvalMode: "approve-everything",
    approval: {
      allow: "npm test",
      deny: ["\\bdeploy\\b", 7],
    },
  });

  assert.equal(result.valid, false);
  assert.equal(diagnosticAt(result, "approvalMode").code, "invalid_approval_mode");
  assert.equal(diagnosticAt(result, "approval.allow").code, "invalid_type");
  assert.equal(diagnosticAt(result, "approval.deny[1]").code, "invalid_type");
});

test("validates nested and flat validation policies without executing config values", () => {
  const result = validateConfigValue({
    validation: { policy: "unsafe" },
    validationPolicy: "strict",
  });

  assert.equal(result.valid, false);
  assert.equal(diagnosticAt(result, "validation.policy").code, "invalid_validation_policy");
});

test("rejects conflicting validation policy spellings", () => {
  const result = validateConfigValue({
    validation: { policy: "fast" },
    validationPolicy: "strict",
  });

  assert.equal(result.valid, false);
  assert.equal(diagnosticAt(result, "$" ).code, "conflicting_validation_policy");
});

test("validates required and optional pricing numbers", () => {
  const result = validateConfigValue({
    pricing: {
      "gpt-4o-mini": {
        inputPerMillion: -1,
        outputPerMillion: "free",
        cachedInputPerMillion: Number.POSITIVE_INFINITY,
      },
      " ": {
        inputPerMillion: 1,
        outputPerMillion: 2,
      },
      missingOutput: { inputPerMillion: 1 },
    },
  });

  assert.equal(result.valid, false);
  assert.equal(
    diagnosticAt(result, "pricing.gpt-4o-mini.inputPerMillion").code,
    "invalid_price",
  );
  assert.equal(
    diagnosticAt(result, "pricing.gpt-4o-mini.outputPerMillion").code,
    "invalid_price",
  );
  assert.equal(
    diagnosticAt(result, "pricing.gpt-4o-mini.cachedInputPerMillion").code,
    "invalid_price",
  );
  assert.equal(diagnosticAt(result, "pricing.<key>").code, "invalid_pricing_key");
  assert.equal(
    diagnosticAt(result, "pricing.missingOutput.outputPerMillion").code,
    "missing_field",
  );
});

test("validates MCP server command, args, env, timeout, and object shape", () => {
  const secret = "MCP_ENV_SECRET_VALUE";
  const absolutePath = "/Users/example/private/untrusted-server";
  const result = validateConfigValue({
    mcpServers: [
      {
        name: 7,
        command: absolutePath,
        args: ["--ok", 2],
        env: { TOKEN: secret, PORT: 3000 },
        timeoutMs: 0,
        extra: "not allowed",
      },
      { command: "" },
      "not-an-object",
    ],
  });

  assert.equal(result.valid, false);
  assert.equal(diagnosticAt(result, "mcpServers[0].name").code, "invalid_type");
  assert.equal(diagnosticAt(result, "mcpServers[0].args[1]").code, "invalid_type");
  assert.equal(diagnosticAt(result, "mcpServers[0].env.PORT").code, "invalid_type");
  assert.equal(diagnosticAt(result, "mcpServers[0].timeoutMs").code, "invalid_positive_integer");
  assert.equal(diagnosticAt(result, "mcpServers[0].extra").code, "unknown_field");
  assert.equal(diagnosticAt(result, "mcpServers[1].command").code, "invalid_mcp_command");
  assert.equal(diagnosticAt(result, "mcpServers[2]").code, "invalid_type");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(absolutePath));
});

test("validates the optional MCP enabled flag", () => {
  const invalid = validateConfigValue({
    mcpServers: [{ command: "node", enabled: "yes" }],
  });
  assert.equal(diagnosticAt(invalid, "mcpServers[0].enabled").code, "invalid_type");

  const valid = validateConfigValue({
    mcpServers: [{ command: "node", enabled: false }],
  });
  assert.equal(valid.valid, true);
});

test("rejects non-JSON values in known fields without serializing them", () => {
  const secret = "function-secret-value";
  const result = validateConfigValue({
    defaultModel: () => secret,
  });

  assert.equal(result.valid, false);
  assert.equal(diagnosticAt(result, "defaultModel").code, "invalid_type");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("validates provider profiles, aliases, fallback, and execution budgets", () => {
  const valid = validateConfigValue({
    defaultProfile: "local",
    providers: {
      ollama: { enabled: true, model: "qwen3:4b-instruct", models: ["qwen3:4b-instruct"] },
      openai: { baseUrl: "https://api.openai.com/v1" },
    },
    profiles: {
      local: { provider: "ollama", model: "qwen3:4b-instruct", fallbacks: ["cloud"] },
      cloud: { provider: "openai", model: "gpt-4o-mini" },
    },
    aliases: { fast: "local", reliable: { profile: "cloud" } },
    fallback: { enabled: true, order: ["local", "cloud"] },
    budget: { maxTurns: 0, maxTokens: 1000, maxDurationMs: 5000, maxOutputChars: 20_000 },
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.diagnostics, []);

  const invalid = validateConfigValue({
    profiles: { broken: { provider: "not-real", model: "", fallbacks: [""] } },
    aliases: { broken: { profile: "" } },
    budget: { maxTurns: -1, extra: true },
  });
  assert.equal(invalid.valid, false);
  assert.equal(diagnosticAt(invalid, "profiles.broken.provider").code, "invalid_provider");
  assert.equal(diagnosticAt(invalid, "profiles.broken.model").code, "invalid_model");
  assert.equal(diagnosticAt(invalid, "profiles.broken.fallbacks").code, "invalid_type");
  assert.equal(diagnosticAt(invalid, "aliases.broken.profile").code, "invalid_string");
  assert.equal(diagnosticAt(invalid, "budget.maxTurns").code, "invalid_non_negative_integer");
  assert.equal(diagnosticAt(invalid, "budget.extra").code, "unknown_field");
});

test("validates bounded named collaboration roles and per-role budgets", () => {
  const valid = validateConfigValue({
    collaboration: {
      toolAllowlist: ["filesystem", "search"],
      roles: [{
        id: "code-reviewer",
        instructions: "Review correctness, compatibility, and security risks.",
        provider: "openai",
        model: "gpt-4.1-mini",
        toolAllowlist: ["filesystem"],
        budget: { maxTurns: 3, maxTokens: 4000, maxDurationMs: 60_000, maxOutputChars: 12_000 },
      }],
    },
  });
  assert.equal(valid.valid, true);

  const duplicate = validateConfigValue({
    collaboration: {
      roles: [
        { id: "tester", instructions: "Write tests." },
        { id: "tester", instructions: "Review tests." },
      ],
    },
  });
  assert.equal(diagnosticAt(duplicate, "collaboration.roles[1].id").code, "duplicate_role_id");

  const unsafe = validateConfigValue({
    collaboration: {
      roles: [{
        id: "Code Reviewer",
        instructions: "x".repeat(12_001),
        provider: "unknown",
        toolAllowlist: ["search", "search"],
        budget: { maxTurns: 0, maxTokens: -1, shell: true },
      }],
    },
  });
  assert.equal(diagnosticAt(unsafe, "collaboration.roles[0].id").code, "invalid_role_id");
  assert.equal(diagnosticAt(unsafe, "collaboration.roles[0].provider").code, "invalid_provider");
  assert.equal(diagnosticAt(unsafe, "collaboration.roles[0].toolAllowlist[1]").code, "duplicate_tool");
  assert.equal(diagnosticAt(unsafe, "collaboration.roles[0].budget.maxTurns").code, "invalid_positive_integer");
  assert.equal(diagnosticAt(unsafe, "collaboration.roles[0].budget.maxTokens").code, "invalid_non_negative_integer");
  assert.equal(diagnosticAt(unsafe, "collaboration.roles[0].budget.shell").code, "unknown_field");
});
