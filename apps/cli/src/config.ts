import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { PriceTable } from "@dev-agent/model";
import type { ProviderManagementConfig } from "./provider-command.js";
import { parseInkTheme, type InkThemeName } from "./ink/theme-types.js";
import { validateCollaborationConfig } from "./config-validation.js";
import {
  normalizeValidationPolicySettings,
  resolveValidationPolicy as resolveSharedValidationPolicy,
  type ValidationPolicy,
  type ValidationPolicySettings,
} from "@dev-agent/tools";

export interface SpecialistAgentBudgetConfig {
  readonly maxTurns?: number;
  readonly maxTokens?: number;
  readonly maxDurationMs?: number;
  readonly maxOutputChars?: number;
}

export interface SpecialistAgentConfig {
  readonly id: string;
  readonly instructions: string;
  readonly provider?: string;
  readonly model?: string;
  /** Role-specific limits narrow the available collaboration tools. */
  readonly toolAllowlist?: readonly string[];
  readonly budget?: SpecialistAgentBudgetConfig;
}

export interface CliConfig extends ProviderManagementConfig {
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly defaultProfile?: string;
  readonly defaultAlias?: string;
  readonly profile?: string;
  readonly alias?: string;
  readonly maxTurns?: number;
  readonly maxContextChars?: number;
  readonly summarizeContext?: boolean;
  readonly summaryMaxChars?: number;
  readonly maxTokens?: number;
  readonly maxDurationMs?: number;
  readonly maxOutputChars?: number;
  readonly budget?: {
    readonly maxTurns?: number;
    readonly maxTokens?: number;
    readonly maxDurationMs?: number;
    readonly maxOutputChars?: number;
  };
  readonly profiles?: unknown;
  readonly aliases?: unknown;
  readonly fallback?: unknown;
  readonly validation?: ValidationPolicySettings["validation"];
  readonly validationPolicy?: ValidationPolicy;
  /** USD-per-million-token prices keyed by model-name prefix. */
  readonly pricing?: PriceTable;
  readonly routing?: {
    readonly mode?: "auto" | "manual";
    readonly profiles?: Partial<Record<"fast" | "balanced" | "deep", string>>;
    readonly budget?: { readonly maxTokens?: number; readonly maxCostUsd?: number; readonly maxDurationMs?: number };
  };
  readonly approvalMode?: ApprovalMode;
  readonly theme?: InkThemeName;
  readonly approval?: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
  /** Optional user-owned upper bound shared by every :team worker. */
  readonly collaboration?: {
    readonly toolAllowlist?: readonly string[];
    /** @deprecated Scope review is mandatory; this setting is accepted but ignored. */
    readonly reviewTaskToolScopes?: boolean;
    /** Optional named roles for `:team plan` and matching `:team` task workers; configured roles replace planning defaults. */
    readonly roles?: readonly SpecialistAgentConfig[];
  };
  readonly mcpServers?: ReadonlyArray<{
    readonly name?: string;
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: Record<string, string>;
    readonly timeoutMs?: number;
    readonly enabled?: boolean;
  }>;
}

export function parseConfig(raw: string): CliConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return {
    ...(parsed as Record<string, unknown>),
    ...normalizeValidationPolicySettings(parsed),
  } as CliConfig;
}

export function resolveInkTheme(
  config: CliConfig = {},
  env: Env = process.env,
): InkThemeName {
  return parseInkTheme(env.DEV_AGENT_THEME) ??
    parseInkTheme(config.theme) ??
    "signal";
}

export type CollaborationToolAllowlistResolution =
  | { readonly valid: true; readonly toolAllowlist?: readonly string[] }
  | { readonly valid: false; readonly message: string };

/**
 * Resolves the user-owned collaboration ceiling without trusting the static
 * CliConfig cast applied to JSON. Invalid safety configuration fails closed.
 */
export function resolveCollaborationToolAllowlist(
  config: unknown,
): CollaborationToolAllowlistResolution {
  if (!isPlainRecord(config)) {
    return { valid: false, message: "Configuration must be an object." };
  }
  if (!Object.prototype.hasOwnProperty.call(config, "collaboration")) {
    return { valid: true };
  }

  const validation = validateCollaborationConfig(config.collaboration);
  if (!validation.valid) {
    const diagnostic = validation.diagnostics[0];
    return {
      valid: false,
      message: diagnostic
        ? `Invalid collaboration configuration at ${diagnostic.path}: ${diagnostic.message}`
        : "Invalid collaboration configuration.",
    };
  }

  if (!isPlainRecord(config.collaboration)) {
    return { valid: false, message: "Invalid collaboration configuration." };
  }
  const toolAllowlist = config.collaboration.toolAllowlist;
  return Array.isArray(toolAllowlist)
    ? { valid: true, toolAllowlist: toolAllowlist as string[] }
    : { valid: true };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const MAX_CONFIG_FILE_BYTES = 1024 * 1024; // 1 MiB

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Resolves the config file without changing the legacy user-level default.
 * Explicit paths are relative to the selected working directory so a project
 * can carry a checked-in or otherwise project-local config file. The
 * environment variable follows the same rule when no flag is supplied.
 */
export function resolveConfigPath(
  flagValue: string | undefined,
  env: Env = process.env,
  homeDirectory = homedir(),
  baseDirectory = process.cwd(),
  projectState = false
): string {
  const fromFlag = flagValue?.trim();
  if (fromFlag) {
    return resolve(baseDirectory, fromFlag);
  }

  const fromEnv = env.DEV_AGENT_CONFIG_FILE?.trim();
  if (fromEnv) {
    return resolve(baseDirectory, fromEnv);
  }

  return projectState
    ? join(baseDirectory, ".dev-agent", "config.json")
    : join(homeDirectory, ".dev-agent", "config.json");
}

export function loadConfig(
  configPath?: string,
  env: Env = process.env,
  baseDirectory = process.cwd(),
  projectState = false
): CliConfig {
  const resolvedPath = resolveConfigPath(
    configPath,
    env,
    homedir(),
    baseDirectory,
    projectState
  );
  if (!existsSync(resolvedPath)) {
    return {};
  }

  let raw: string;
  try {
    if (statSync(resolvedPath).size > MAX_CONFIG_FILE_BYTES) {
      return {};
    }
    raw = readFileSync(resolvedPath, "utf8");
  } catch {
    return {};
  }

  // Structural validation errors in the validation section intentionally
  // propagate instead of silently disabling the safety policy.
  return parseConfig(raw);
}

/**
 * Resolves the sandbox runtime binary path. An explicit CLI flag wins, then the
 * `DEV_AGENT_RUST_BINARY` environment variable.
 */
export function resolveRustBinaryPath(
  flagValue: string | undefined,
  env: Env = process.env
): string | undefined {
  const fromFlag = flagValue?.trim();
  if (fromFlag) {
    return fromFlag;
  }
  const fromEnv = env.DEV_AGENT_RUST_BINARY?.trim();
  return fromEnv ? fromEnv : undefined;
}

/**
 * Environment variables win over the config file, which wins over the default,
 * so an explicit invocation always overrides a saved preference.
 */
export function resolveProviderId(config: CliConfig = {}, env: Env = process.env): string {
  const fromEnv = env.DEV_AGENT_MODEL_PROVIDER?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromConfig =
    typeof config.defaultProvider === "string" ? config.defaultProvider.trim() : undefined;
  return fromConfig ? fromConfig : "ollama";
}

export function resolveModel(
  config: CliConfig = {},
  env: Env = process.env
): string | undefined {
  const fromEnv = env.DEV_AGENT_MODEL?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromConfig =
    typeof config.defaultModel === "string" ? config.defaultModel.trim() : undefined;
  return fromConfig ? fromConfig : undefined;
}

/** Falls back when the configured value is missing or not a positive integer. */
export function resolveMaxTurns(config: CliConfig = {}, fallback: number): number {
  const value = config.maxTurns;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

/**
 * Resolves the conversation-history budget handed to the agent loop.
 *
 * Environment, then config file, then no budget at all -- with no budget the
 * loop passes the full history through, exactly as it did before the option
 * existed. Invalid values are ignored rather than fatal.
 */
export function resolveMaxContextChars(
  config: CliConfig = {},
  env: Env = process.env
): number | undefined {
  const fromEnv = env.DEV_AGENT_MAX_CONTEXT_CHARS?.trim();
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const fromConfig = config.maxContextChars;
  if (typeof fromConfig === "number" && Number.isInteger(fromConfig) && fromConfig > 0) {
    return fromConfig;
  }

  return undefined;
}

/**
 * Resolves whether trimmed history is summarized instead of just announced.
 * `DEV_AGENT_SUMMARIZE_CONTEXT` accepts 1/true/yes and 0/false/no; anything
 * else (or no setting at all) falls back to the config file.
 */
export function resolveSummarizeContext(
  config: CliConfig = {},
  env: Env = process.env
): boolean {
  const fromEnv = env.DEV_AGENT_SUMMARIZE_CONTEXT?.trim().toLowerCase();
  if (fromEnv) {
    if (["1", "true", "yes"].includes(fromEnv)) {
      return true;
    }
    if (["0", "false", "no"].includes(fromEnv)) {
      return false;
    }
  }
  return config.summarizeContext === true;
}

/** Resolves the cap for the generated digest; invalid values fall through. */
export function resolveSummaryMaxChars(
  config: CliConfig = {},
  env: Env = process.env
): number | undefined {
  const fromEnv = env.DEV_AGENT_SUMMARY_MAX_CHARS?.trim();
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const fromConfig = config.summaryMaxChars;
  if (typeof fromConfig === "number" && Number.isInteger(fromConfig) && fromConfig > 0) {
    return fromConfig;
  }

  return undefined;
}

export type ApprovalMode = "allow" | "deny-dangerous" | "ask" | "review-writes";

/** Validates a user-supplied approval mode, returning undefined when unknown. */
export function parseApprovalMode(value: string | undefined): ApprovalMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "allow" ||
    normalized === "deny-dangerous" ||
    normalized === "ask" ||
    normalized === "review-writes"
  ) {
    return normalized;
  }
  return undefined;
}

/** Environment wins over the config file; anything unrecognised falls back to allow. */
export function resolveApprovalMode(
  config: CliConfig = {},
  env: Env = process.env
): ApprovalMode {
  const fromEnv = parseApprovalMode(env.DEV_AGENT_APPROVAL);
  if (fromEnv) {
    return fromEnv;
  }
  const fromConfig = parseApprovalMode(config.approvalMode);
  return fromConfig ?? "allow";
}

/** Resolves the validation policy using the shared, allowlisted policy parser. */
export function resolveValidationPolicy(
  config: CliConfig = {},
  env: Env = process.env
): ValidationPolicy {
  return resolveSharedValidationPolicy(config, env);
}
