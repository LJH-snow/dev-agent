import { readFile } from "node:fs/promises";

import {
  parseAndValidateConfig,
  validateConfigValue,
  type ConfigDiagnostic,
  type ConfigValidationResult,
} from "./config-validation.js";

export type ConfigCommandName = "validate" | "show";

export interface ConfigCommandOptions {
  readonly command: ConfigCommandName;
  readonly configPath: string;
}

export interface ConfigCommandResult {
  readonly command: `config ${ConfigCommandName}`;
  readonly source: "file" | "defaults";
  readonly valid: boolean;
  readonly diagnostics: readonly ConfigDiagnostic[];
  readonly config?: unknown;
}

export interface ConfigCommandExecution {
  readonly result: ConfigCommandResult;
  readonly exitCode: 0 | 1;
}

/**
 * Reads and validates a config file without loading a provider or executing
 * any configured MCP command. The absolute config path is intentionally not
 * returned in the result so --json output stays safe to share.
 */
export async function executeConfigCommand(
  options: ConfigCommandOptions
): Promise<ConfigCommandExecution> {
  let raw: string | undefined;
  let source: ConfigCommandResult["source"] = "file";
  try {
    raw = await readFile(options.configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      source = "defaults";
    } else {
      const result: ConfigCommandResult = {
        command: `config ${options.command}`,
        source: "file",
        valid: false,
        diagnostics: [
          {
            path: "$",
            code: "config_read_error",
            message: "Configuration could not be read.",
            severity: "error",
          },
        ],
      };
      return { result, exitCode: 1 };
    }
  }

  const validation: ConfigValidationResult =
    raw === undefined ? { valid: true, diagnostics: [] } : parseAndValidateConfig(raw);
  const parsed = raw === undefined ? {} : parseJson(raw);
  const result: ConfigCommandResult = {
    command: `config ${options.command}`,
    source,
    valid: validation.valid,
    diagnostics: validation.diagnostics,
    ...(options.command === "show" && validation.valid
      ? { config: redactConfigValue(parsed) }
      : {}),
  };
  return { result, exitCode: validation.valid ? 0 : 1 };
}

export function formatConfigCommandResult(result: ConfigCommandResult): string {
  const lines = [`Configuration source: ${result.source}`];
  if (result.command === "config show" && result.config !== undefined) {
    lines.push(JSON.stringify(result.config, null, 2));
  } else if (result.valid) {
    lines.push("Configuration is valid.");
  }
  if (result.diagnostics.length > 0) {
    lines.push("Diagnostics:");
    for (const diagnostic of result.diagnostics) {
      lines.push(
        `- ${diagnostic.severity} ${diagnostic.path} (${diagnostic.code}): ${diagnostic.message}`
      );
    }
  }
  return lines.join("\n");
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function redactConfigValue(value: unknown, key?: string): unknown {
  if (key !== undefined && isSensitiveKey(key)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactConfigValue(entry));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactConfigValue(entryValue, entryKey),
      ])
    );
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  return /(api[-_]?key|token|secret|password|credential|authorization|private[-_]?key)/i.test(
    key
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
