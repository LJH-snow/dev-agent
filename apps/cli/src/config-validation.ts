/** A diagnostic severity emitted by config validation. */
export type ConfigDiagnosticSeverity = "error" | "warning";

/**
 * Metadata-only information about one configuration problem.
 *
 * Diagnostics deliberately do not carry the offending value. This keeps
 * validation safe to print for configurations that contain secrets in MCP
 * environment variables or other future sensitive fields.
 */
export interface ConfigDiagnostic {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly severity: ConfigDiagnosticSeverity;
}

/** The stable result shape used by future config commands. */
export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly ConfigDiagnostic[];
}

const TOP_LEVEL_FIELDS = new Set([
  "defaultProvider",
  "defaultModel",
  "defaultProfile",
  "defaultAlias",
  "profile",
  "alias",
  "maxTurns",
  "maxContextChars",
  "summarizeContext",
  "summaryMaxChars",
  "maxTokens",
  "maxDurationMs",
  "maxOutputChars",
  "budget",
  "providers",
  "models",
  "apiKeys",
  "baseUrls",
  "profiles",
  "aliases",
  "fallback",
  "validation",
  "validationPolicy",
  "pricing",
  "approvalMode",
  "approval",
  "mcpServers",
]);

const PROVIDERS = new Set(["openai", "anthropic", "gemini", "ollama"]);
const APPROVAL_MODES = new Set(["allow", "deny-dangerous", "ask", "review-writes"]);
const VALIDATION_POLICIES = new Set(["fast", "default", "strict"]);
const APPROVAL_FIELDS = new Set(["allow", "deny"]);
const PRICE_FIELDS = new Set([
  "inputPerMillion",
  "outputPerMillion",
  "cachedInputPerMillion",
  "cacheCreationInputPerMillion",
]);
const MCP_FIELDS = new Set(["name", "command", "args", "env", "timeoutMs"]);

/**
 * Validates the in-memory JSON-shaped value used by the CLI config reader.
 *
 * This function is pure: it only inspects data, never resolves paths, reads
 * files, imports provider credentials, or executes configured commands.
 */
export function validateConfigValue(value: unknown): ConfigValidationResult {
  const diagnostics: ConfigDiagnostic[] = [];

  if (!isPlainRecord(value)) {
    addDiagnostic(
      diagnostics,
      "$",
      "invalid_root_type",
      "Configuration must be a JSON object.",
    );
    return resultFrom(diagnostics);
  }

  const config = value;
  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      addDiagnostic(diagnostics, key, "unknown_field", "Unknown configuration field.");
    }
  }

  validateProvider(config, diagnostics);
  validateModel(config, diagnostics);
  validatePositiveIntegerField(config, "maxTurns", diagnostics);
  validatePositiveIntegerField(config, "maxContextChars", diagnostics);
  validateBooleanField(config, "summarizeContext", diagnostics);
  validatePositiveIntegerField(config, "summaryMaxChars", diagnostics);
  validatePositiveIntegerField(config, "maxTokens", diagnostics);
  validatePositiveIntegerField(config, "maxDurationMs", diagnostics);
  validatePositiveIntegerField(config, "maxOutputChars", diagnostics);
  validateBudget(config, diagnostics);
  validateStringSelector(config, "defaultProfile", diagnostics);
  validateStringSelector(config, "defaultAlias", diagnostics);
  validateStringSelector(config, "profile", diagnostics);
  validateStringSelector(config, "alias", diagnostics);
  validateProviderManagement(config, diagnostics);
  validateProfilesAndAliases(config, diagnostics);
  const nestedPolicy = validateNestedValidationPolicy(config, diagnostics);
  const flatPolicy = validateFlatValidationPolicy(config, diagnostics);
  if (nestedPolicy !== undefined && flatPolicy !== undefined && nestedPolicy !== flatPolicy) {
    addDiagnostic(
      diagnostics,
      "$",
      "conflicting_validation_policy",
      "validation and validationPolicy must select the same policy.",
    );
  }
  validateApprovalMode(config, diagnostics);
  validateApproval(config, diagnostics);
  validatePricing(config, diagnostics);
  validateMcpServers(config, diagnostics);

  return resultFrom(diagnostics);
}

/**
 * Parses and validates raw JSON without returning the parsed value. Keeping
 * the value out of the result prevents accidental disclosure from a future
 * `config validate` JSON renderer.
 */
export function parseAndValidateConfig(raw: string): ConfigValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      valid: false,
      diagnostics: [
        {
          path: "$",
          code: "invalid_json",
          message: "Configuration is not valid JSON.",
          severity: "error",
        },
      ],
    };
  }
  return validateConfigValue(parsed);
}

function validateProvider(
  config: Record<string, unknown>,
  diagnostics: ConfigDiagnostic[],
): void {
  const path = "defaultProvider";
  if (!hasOwn(config, path)) {
    return;
  }
  const value = config[path];
  if (typeof value !== "string") {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be a string.`);
    return;
  }
  if (!PROVIDERS.has(value.trim())) {
    addDiagnostic(
      diagnostics,
      path,
      "invalid_provider",
      `${path} must be one of: openai, anthropic, gemini, ollama.`,
    );
  }
}

function validateModel(config: Record<string, unknown>, diagnostics: ConfigDiagnostic[]): void {
  const path = "defaultModel";
  if (!hasOwn(config, path)) {
    return;
  }
  const value = config[path];
  if (typeof value !== "string") {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be a string.`);
    return;
  }
  if (value.trim() === "") {
    addDiagnostic(diagnostics, path, "invalid_model", `${path} must be a non-empty string.`);
  }
}

function validatePositiveIntegerField(
  config: Record<string, unknown>,
  path: string,
  diagnostics: ConfigDiagnostic[],
  prefix = "",
): void {
  const diagnosticPath = `${prefix}${path}`;
  if (!hasOwn(config, path)) {
    return;
  }
  const value = config[path];
  if (!isPositiveSafeInteger(value)) {
    addDiagnostic(
      diagnostics,
      diagnosticPath,
      "invalid_positive_integer",
      `${diagnosticPath} must be a positive integer.`,
    );
  }
}

function validateStringSelector(
  config: Record<string, unknown>,
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (!hasOwn(config, path)) return;
  if (typeof config[path] !== "string" || config[path].trim() === "") {
    addDiagnostic(diagnostics, path, "invalid_string", `${path} must be a non-empty string.`);
  }
}

function validateBudget(config: Record<string, unknown>, diagnostics: ConfigDiagnostic[]): void {
  if (!hasOwn(config, "budget")) return;
  const value = config.budget;
  if (!isPlainRecord(value)) {
    addDiagnostic(diagnostics, "budget", "invalid_type", "budget must be an object.");
    return;
  }
  for (const key of Object.keys(value)) {
    if (!["maxTurns", "maxTokens", "maxDurationMs", "maxOutputChars"].includes(key)) {
      addDiagnostic(diagnostics, `budget.${key}`, "unknown_field", "Unknown budget field.");
    } else {
      validateNonNegativeIntegerField(value, key, diagnostics, "budget.");
    }
  }
}

function validateProfilesAndAliases(config: Record<string, unknown>, diagnostics: ConfigDiagnostic[]): void {
  if (hasOwn(config, "profiles")) {
    const profiles = config.profiles;
    if (!isPlainRecord(profiles)) {
      addDiagnostic(diagnostics, "profiles", "invalid_type", "profiles must be an object.");
    } else {
      for (const [name, value] of Object.entries(profiles)) {
        const path = `profiles.${name}`;
        if (!isPlainRecord(value)) {
          addDiagnostic(diagnostics, path, "invalid_type", "Profile must be an object.");
          continue;
        }
        for (const key of Object.keys(value)) {
          if (!["provider", "model", "fallback", "fallbacks"].includes(key)) {
            addDiagnostic(diagnostics, `${path}.${key}`, "unknown_field", "Unknown profile field.");
          }
        }
        validateOptionalProvider(value, `${path}.provider`, diagnostics);
        validateOptionalModel(value, "model", `${path}.model`, diagnostics);
        validateReferenceList(value, "fallback", `${path}.fallback`, diagnostics);
        validateReferenceList(value, "fallbacks", `${path}.fallbacks`, diagnostics);
      }
    }
  }

  if (hasOwn(config, "aliases")) {
    const aliases = config.aliases;
    if (!isPlainRecord(aliases)) {
      addDiagnostic(diagnostics, "aliases", "invalid_type", "aliases must be an object.");
    } else {
      for (const [name, value] of Object.entries(aliases)) {
        const path = `aliases.${name}`;
        if (typeof value === "string") {
          if (value.trim() === "") {
            addDiagnostic(diagnostics, path, "invalid_string", "Alias must not be empty.");
          }
          continue;
        }
        if (!isPlainRecord(value)) {
          addDiagnostic(diagnostics, path, "invalid_type", "Alias must be a string or object.");
          continue;
        }
        for (const key of Object.keys(value)) {
          if (!["provider", "model", "profile", "alias"].includes(key)) {
            addDiagnostic(diagnostics, `${path}.${key}`, "unknown_field", "Unknown alias field.");
          }
        }
        validateOptionalProvider(value, `${path}.provider`, diagnostics);
        validateOptionalModel(value, "model", `${path}.model`, diagnostics);
        for (const key of ["profile", "alias"] as const) {
          if (key in value && (typeof value[key] !== "string" || value[key].trim() === "")) {
            addDiagnostic(diagnostics, `${path}.${key}`, "invalid_string", `${path}.${key} must be a non-empty string.`);
          }
        }
      }
    }
  }
}

function validateOptionalProvider(
  value: Record<string, unknown>,
  diagnosticPath: string,
  diagnostics: ConfigDiagnostic[],
): void {
  const key = diagnosticPath.slice(diagnosticPath.lastIndexOf(".") + 1);
  if (!(key in value)) return;
  if (typeof value[key] !== "string" || !PROVIDERS.has(value[key]!.trim())) {
    addDiagnostic(diagnostics, diagnosticPath, "invalid_provider", "Provider is not supported.");
  }
}

function validateOptionalModel(
  value: Record<string, unknown>,
  key: string,
  diagnosticPath: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (!(key in value)) return;
  if (typeof value[key] !== "string" || value[key]!.trim() === "") {
    addDiagnostic(diagnostics, diagnosticPath, "invalid_model", "Model must be a non-empty string.");
  }
}

function validateReferenceList(
  value: Record<string, unknown>,
  key: string,
  diagnosticPath: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (!(key in value)) return;
  const references = value[key];
  if (!Array.isArray(references) || references.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    addDiagnostic(diagnostics, diagnosticPath, "invalid_type", `${diagnosticPath} must be an array of names.`);
  }
}

function validateNonNegativeIntegerField(
  config: Record<string, unknown>,
  path: string,
  diagnostics: ConfigDiagnostic[],
  prefix = "",
): void {
  const diagnosticPath = `${prefix}${path}`;
  if (!hasOwn(config, path)) return;
  if (!isNonNegativeSafeInteger(config[path])) {
    addDiagnostic(diagnostics, diagnosticPath, "invalid_non_negative_integer", `${diagnosticPath} must be a non-negative integer.`);
  }
}

function validateProviderManagement(config: Record<string, unknown>, diagnostics: ConfigDiagnostic[]): void {
  for (const field of ["providers", "models", "apiKeys", "baseUrls"] as const) {
    if (!hasOwn(config, field)) continue;
    const value = config[field];
    if (!isPlainRecord(value)) {
      addDiagnostic(diagnostics, field, "invalid_type", `${field} must be an object.`);
      continue;
    }
    for (const [provider, providerValue] of Object.entries(value)) {
      if (!PROVIDERS.has(provider)) {
        addDiagnostic(diagnostics, `${field}.${provider}`, "invalid_provider", "Provider is not supported.");
        continue;
      }
      if (field === "providers") {
        if (!isPlainRecord(providerValue)) {
          addDiagnostic(diagnostics, `${field}.${provider}`, "invalid_type", "Provider settings must be an object.");
          continue;
        }
        for (const key of Object.keys(providerValue)) {
          if (!["enabled", "model", "apiKey", "baseUrl", "models"].includes(key)) {
            addDiagnostic(diagnostics, `${field}.${provider}.${key}`, "unknown_field", "Unknown provider field.");
          }
        }
        if ("enabled" in providerValue && typeof providerValue.enabled !== "boolean") {
          addDiagnostic(diagnostics, `${field}.${provider}.enabled`, "invalid_type", "enabled must be a boolean.");
        }
        if ("model" in providerValue && (typeof providerValue.model !== "string" || providerValue.model.trim() === "")) {
          addDiagnostic(diagnostics, `${field}.${provider}.model`, "invalid_model", "model must be a non-empty string.");
        }
        if ("models" in providerValue && (!Array.isArray(providerValue.models) || providerValue.models.some((item) => typeof item !== "string" || item.trim() === ""))) {
          addDiagnostic(diagnostics, `${field}.${provider}.models`, "invalid_type", "models must be an array of non-empty strings.");
        }
      } else if (field === "models") {
        if (!Array.isArray(providerValue) || providerValue.some((item) => typeof item !== "string" || item.trim() === "")) {
          addDiagnostic(diagnostics, `${field}.${provider}`, "invalid_type", "models must be an array of non-empty strings.");
        }
      } else if (typeof providerValue !== "string" || providerValue.trim() === "") {
        addDiagnostic(diagnostics, `${field}.${provider}`, "invalid_type", `${field} values must be non-empty strings.`);
      }
    }
  }

  if (hasOwn(config, "fallback")) {
    const fallback = config.fallback;
    if (!isPlainRecord(fallback)) {
      addDiagnostic(diagnostics, "fallback", "invalid_type", "fallback must be an object.");
    } else {
      if ("enabled" in fallback && typeof fallback.enabled !== "boolean") {
        addDiagnostic(diagnostics, "fallback.enabled", "invalid_type", "fallback.enabled must be a boolean.");
      }
      if ("order" in fallback && (!Array.isArray(fallback.order) || fallback.order.some((item) => typeof item !== "string" || item.trim() === ""))) {
        addDiagnostic(diagnostics, "fallback.order", "invalid_type", "fallback.order must be an array of names.");
      }
    }
  }
}

function validateBooleanField(
  config: Record<string, unknown>,
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (!hasOwn(config, path)) {
    return;
  }
  if (typeof config[path] !== "boolean") {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be a boolean.`);
  }
}

function validateNestedValidationPolicy(
  config: Record<string, unknown>,
  diagnostics: ConfigDiagnostic[],
): string | undefined {
  const path = "validation";
  if (!hasOwn(config, path)) {
    return undefined;
  }
  const value = config[path];
  if (!isPlainRecord(value)) {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be an object.`);
    return undefined;
  }

  for (const key of Object.keys(value)) {
    if (key !== "policy") {
      addDiagnostic(
        diagnostics,
        `${path}.${key}`,
        "unknown_field",
        "Unknown validation configuration field.",
      );
    }
  }

  if (!hasOwn(value, "policy")) {
    addDiagnostic(
      diagnostics,
      `${path}.policy`,
      "missing_field",
      "validation.policy is required when validation is configured.",
    );
    return undefined;
  }
  return validatePolicyValue(value.policy, `${path}.policy`, diagnostics);
}

function validateFlatValidationPolicy(
  config: Record<string, unknown>,
  diagnostics: ConfigDiagnostic[],
): string | undefined {
  const path = "validationPolicy";
  if (!hasOwn(config, path)) {
    return undefined;
  }
  return validatePolicyValue(config[path], path, diagnostics);
}

function validatePolicyValue(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): string | undefined {
  if (typeof value !== "string") {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be a string.`);
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!VALIDATION_POLICIES.has(normalized)) {
    addDiagnostic(
      diagnostics,
      path,
      "invalid_validation_policy",
      `${path} must be one of: fast, default, strict.`,
    );
    return undefined;
  }
  return normalized;
}

function validateApprovalMode(
  config: Record<string, unknown>,
  diagnostics: ConfigDiagnostic[],
): void {
  const path = "approvalMode";
  if (!hasOwn(config, path)) {
    return;
  }
  const value = config[path];
  if (typeof value !== "string") {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be a string.`);
    return;
  }
  if (!APPROVAL_MODES.has(value.trim().toLowerCase())) {
    addDiagnostic(
      diagnostics,
      path,
      "invalid_approval_mode",
      `${path} must be one of: allow, deny-dangerous, ask, review-writes.`,
    );
  }
}

function validateApproval(
  config: Record<string, unknown>,
  diagnostics: ConfigDiagnostic[],
): void {
  const path = "approval";
  if (!hasOwn(config, path)) {
    return;
  }
  const value = config[path];
  if (!isPlainRecord(value)) {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be an object.`);
    return;
  }

  for (const key of Object.keys(value)) {
    if (!APPROVAL_FIELDS.has(key)) {
      addDiagnostic(diagnostics, `${path}.${key}`, "unknown_field", "Unknown approval field.");
    }
  }

  validateStringArrayField(value, "allow", path, diagnostics);
  validateStringArrayField(value, "deny", path, diagnostics);
}

function validateStringArrayField(
  record: Record<string, unknown>,
  field: string,
  parentPath: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (!hasOwn(record, field)) {
    return;
  }
  const path = `${parentPath}.${field}`;
  const value = record[field];
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be an array of strings.`);
    return;
  }
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (typeof entry !== "string") {
      addDiagnostic(diagnostics, entryPath, "invalid_type", `${entryPath} must be a string.`);
    } else if (entry.trim() === "") {
      addDiagnostic(
        diagnostics,
        entryPath,
        "invalid_string",
        `${entryPath} must be a non-empty string.`,
      );
    }
  });
}

function validatePricing(config: Record<string, unknown>, diagnostics: ConfigDiagnostic[]): void {
  const path = "pricing";
  if (!hasOwn(config, path)) {
    return;
  }
  const value = config[path];
  if (!isPlainRecord(value)) {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be an object.`);
    return;
  }

  for (const prefix of Object.keys(value)) {
    const prefixPath = prefix.trim() === "" ? `${path}.<key>` : `${path}.${prefix}`;
    if (prefix.trim() === "") {
      addDiagnostic(
        diagnostics,
        prefixPath,
        "invalid_pricing_key",
        "Pricing model prefixes must be non-empty strings.",
      );
    }

    const price = value[prefix];
    if (!isPlainRecord(price)) {
      addDiagnostic(diagnostics, prefixPath, "invalid_type", `${prefixPath} must be an object.`);
      continue;
    }

    for (const key of Object.keys(price)) {
      if (!PRICE_FIELDS.has(key)) {
        addDiagnostic(
          diagnostics,
          `${prefixPath}.${key}`,
          "unknown_field",
          "Unknown pricing field.",
        );
      }
    }

    validateRequiredPriceField(price, "inputPerMillion", prefixPath, diagnostics);
    validateRequiredPriceField(price, "outputPerMillion", prefixPath, diagnostics);
    validateOptionalPriceField(price, "cachedInputPerMillion", prefixPath, diagnostics);
    validateOptionalPriceField(price, "cacheCreationInputPerMillion", prefixPath, diagnostics);
  }
}

function validateRequiredPriceField(
  price: Record<string, unknown>,
  field: string,
  parentPath: string,
  diagnostics: ConfigDiagnostic[],
): void {
  const path = `${parentPath}.${field}`;
  if (!hasOwn(price, field)) {
    addDiagnostic(diagnostics, path, "missing_field", `${path} is required.`);
    return;
  }
  validatePriceNumber(price[field], path, diagnostics);
}

function validateOptionalPriceField(
  price: Record<string, unknown>,
  field: string,
  parentPath: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (!hasOwn(price, field)) {
    return;
  }
  validatePriceNumber(price[field], `${parentPath}.${field}`, diagnostics);
}

function validatePriceNumber(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    addDiagnostic(
      diagnostics,
      path,
      "invalid_price",
      `${path} must be a finite non-negative number.`,
    );
  }
}

function validateMcpServers(
  config: Record<string, unknown>,
  diagnostics: ConfigDiagnostic[],
): void {
  const path = "mcpServers";
  if (!hasOwn(config, path)) {
    return;
  }
  const value = config[path];
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be an array.`);
    return;
  }

  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isPlainRecord(entry)) {
      addDiagnostic(diagnostics, entryPath, "invalid_type", `${entryPath} must be an object.`);
      return;
    }
    validateMcpServerEntry(entry, entryPath, diagnostics);
  });
}

function validateMcpServerEntry(
  server: Record<string, unknown>,
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  for (const key of Object.keys(server)) {
    if (!MCP_FIELDS.has(key)) {
      addDiagnostic(diagnostics, `${path}.${key}`, "unknown_field", "Unknown MCP server field.");
    }
  }

  if (!hasOwn(server, "command")) {
    addDiagnostic(diagnostics, `${path}.command`, "missing_field", "MCP server command is required.");
  } else {
    validateMcpCommand(server.command, `${path}.command`, diagnostics);
  }

  if (hasOwn(server, "name")) {
    const namePath = `${path}.name`;
    if (typeof server.name !== "string") {
      addDiagnostic(diagnostics, namePath, "invalid_type", `${namePath} must be a string.`);
    } else if (server.name.trim() === "") {
      addDiagnostic(diagnostics, namePath, "invalid_string", `${namePath} must be a non-empty string.`);
    }
  }

  if (hasOwn(server, "args")) {
    validateMcpArgs(server.args, `${path}.args`, diagnostics);
  }
  if (hasOwn(server, "env")) {
    validateMcpEnv(server.env, `${path}.env`, diagnostics);
  }
  if (hasOwn(server, "timeoutMs")) {
    if (!isPositiveSafeInteger(server.timeoutMs)) {
      addDiagnostic(
        diagnostics,
        `${path}.timeoutMs`,
        "invalid_positive_integer",
        `${path}.timeoutMs must be a positive integer.`,
      );
    }
  }
}

function validateMcpCommand(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (typeof value !== "string") {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be a string.`);
  } else if (value.trim() === "") {
    addDiagnostic(diagnostics, path, "invalid_mcp_command", `${path} must be a non-empty string.`);
  }
}

function validateMcpArgs(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be an array of strings.`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      const entryPath = `${path}[${index}]`;
      addDiagnostic(diagnostics, entryPath, "invalid_type", `${entryPath} must be a string.`);
    }
  });
}

function validateMcpEnv(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  if (!isPlainRecord(value)) {
    addDiagnostic(diagnostics, path, "invalid_type", `${path} must be an object of strings.`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (typeof value[key] !== "string") {
      const entryPath = `${path}.${key}`;
      addDiagnostic(diagnostics, entryPath, "invalid_type", `${entryPath} must be a string.`);
    }
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function addDiagnostic(
  diagnostics: ConfigDiagnostic[],
  path: string,
  code: string,
  message: string,
): void {
  diagnostics.push({ path, code, message, severity: "error" });
}

function resultFrom(diagnostics: readonly ConfigDiagnostic[]): ConfigValidationResult {
  return {
    valid: diagnostics.length === 0,
    diagnostics,
  };
}
