import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly maxTurns?: number;
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
