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
