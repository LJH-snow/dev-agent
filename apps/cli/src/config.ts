import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { PriceTable } from "@dev-agent/model";

export interface CliConfig {
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly maxTurns?: number;
  readonly maxContextChars?: number;
  readonly summarizeContext?: boolean;
  readonly summaryMaxChars?: number;
  /** USD-per-million-token prices keyed by model-name prefix. */
  readonly pricing?: PriceTable;
  readonly approvalMode?: ApprovalMode;
  readonly approval?: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
  readonly mcpServers?: ReadonlyArray<{
    readonly name?: string;
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: Record<string, string>;
  }>;
}

export function parseConfig(raw: string): CliConfig {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as CliConfig;
    }
    return {};
  } catch {
    return {};
  }
}

export function loadConfig(): CliConfig {
  const configPath = join(homedir(), ".dev-agent", "config.json");
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    return parseConfig(raw);
  } catch {
    return {};
  }
}

type Env = Readonly<Record<string, string | undefined>>;

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
  const fromConfig = config.defaultProvider?.trim();
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
  const fromConfig = config.defaultModel?.trim();
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

export type ApprovalMode = "allow" | "deny-dangerous" | "ask";

/** Validates a user-supplied approval mode, returning undefined when unknown. */
export function parseApprovalMode(value: string | undefined): ApprovalMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "allow" || normalized === "deny-dangerous" || normalized === "ask") {
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
