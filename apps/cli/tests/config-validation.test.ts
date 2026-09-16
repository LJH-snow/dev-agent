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
    "pricing.model.extraPrice",
    "mcpServers[0].extra",
  ]) {
    assert.equal(diagnosticAt(result, path).code, "unknown_field");
  }
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

test("rejects non-JSON values in known fields without serializing them", () => {
  const secret = "function-secret-value";
  const result = validateConfigValue({
    defaultModel: () => secret,
  });

  assert.equal(result.valid, false);
  assert.equal(diagnosticAt(result, "defaultModel").code, "invalid_type");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});
