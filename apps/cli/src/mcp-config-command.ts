import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { resolveMcpTemplate } from "./mcp-templates.js";

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_NAME_LENGTH = 64;
const MAX_VALUE_LENGTH = 4096;

export type McpConfigAction = "add" | "remove" | "enable" | "disable";

export interface McpConfigCommandOptions {
  readonly action: McpConfigAction;
  readonly configPath: string;
  readonly name: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly environment?: readonly string[];
  readonly timeoutMs?: number;
  readonly template?: string;
  readonly workingDirectory?: string;
  readonly enabled?: boolean;
}

export interface McpConfigCommandResult {
  readonly command: `mcp ${McpConfigAction}`;
  readonly status: "added" | "removed" | "enabled" | "disabled" | "not_found";
  readonly name: string;
  readonly serverCount: number;
  readonly argumentCount: number;
  readonly environmentVariableCount: number;
  readonly configCreated: boolean;
  readonly template?: string;
}

interface McpServerEntry {
  readonly name?: unknown;
  readonly command?: unknown;
  readonly args?: unknown;
  readonly env?: unknown;
  readonly timeoutMs?: unknown;
  readonly enabled?: unknown;
  readonly [key: string]: unknown;
}

type JsonConfig = Record<string, unknown>;

/**
 * Add or remove a named MCP server without starting it.
 *
 * The command intentionally returns metadata only. In particular, environment
 * values and command arguments are never copied into the result, so
 * `--json` remains safe to use in logs and CI.
 */
export async function executeMcpConfigCommand(
  options: McpConfigCommandOptions,
): Promise<McpConfigCommandResult> {
  const name = normalizeName(options.name);
  const config = await readConfig(options.configPath);
  const servers = readServers(config);

  if (options.action === "remove") {
    const index = servers.findIndex((server) => server.name === name);
    if (index < 0) {
      return {
        command: "mcp remove",
        status: "not_found",
        name,
        serverCount: servers.length,
        argumentCount: 0,
        environmentVariableCount: 0,
        configCreated: false,
      };
    }
    const [removed] = servers.splice(index, 1);
    await writeConfig(options.configPath, {
      ...config,
      mcpServers: servers,
    });
    return {
      command: "mcp remove",
      status: "removed",
      name,
      serverCount: servers.length,
      argumentCount: countStrings(removed?.args),
      environmentVariableCount: countEnvironment(removed?.env),
      configCreated: false,
    };
  }

  if (options.action === "enable" || options.action === "disable") {
    const index = servers.findIndex((server) => server.name === name);
    if (index < 0) {
      return {
        command: `mcp ${options.action}`,
        status: "not_found",
        name,
        serverCount: servers.length,
        argumentCount: 0,
        environmentVariableCount: 0,
        configCreated: false,
      };
    }
    const server = servers[index]!;
    const enabled = options.action === "enable";
    servers[index] = { ...server, enabled };
    await writeConfig(options.configPath, { ...config, mcpServers: servers });
    return {
      command: `mcp ${options.action}`,
      status: enabled ? "enabled" : "disabled",
      name,
      serverCount: servers.length,
      argumentCount: countStrings(server.args),
      environmentVariableCount: countEnvironment(server.env),
      configCreated: false,
    };
  }

  const template = options.template === undefined
    ? undefined
    : resolveMcpTemplate(options.template, options.workingDirectory);
  if (options.command === undefined && template === undefined) {
    throw new Error("mcp add requires --command or --template.");
  }
  if (options.command !== undefined && template !== undefined) {
    throw new Error("mcp add cannot combine --command with --template.");
  }
  const command = normalizeValue(options.command ?? template!.command, "command");
  if (servers.some((server) => server.name === name)) {
    throw new Error(`MCP server '${name}' already exists.`);
  }

  const args = normalizeValues(options.args ?? template?.args ?? [], "argument");
  const env = parseEnvironment(options.environment ?? []);
  const server: Record<string, unknown> = {
    name,
    command,
    ...(args.length === 0 ? {} : { args }),
    ...(Object.keys(env).length === 0 ? {} : { env }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: normalizeTimeout(options.timeoutMs) }),
    ...(options.enabled === false ? { enabled: false } : {}),
  };
  const nextServers = [...servers, server];
  await writeConfig(options.configPath, {
    ...config,
    mcpServers: nextServers,
  });
  return {
    command: "mcp add",
    status: "added",
    name,
    serverCount: nextServers.length,
    argumentCount: args.length,
    environmentVariableCount: Object.keys(env).length,
    configCreated: Object.keys(config).length === 0,
    ...(template === undefined ? {} : { template: template.name }),
  };
}

async function readConfig(configPath: string): Promise<JsonConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
    throw new Error("Configuration file exceeds the 1 MiB MCP management limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Configuration file is not valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new Error("Configuration file must contain a JSON object.");
  }
  return parsed;
}

function readServers(config: JsonConfig): Record<string, unknown>[] {
  const raw = config.mcpServers;
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error("Configuration field mcpServers must be an array.");
  }
  return raw.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`Configuration field mcpServers[${index}] must be an object.`);
    }
    if (value.name !== undefined && typeof value.name !== "string") {
      throw new Error(`Configuration field mcpServers[${index}].name must be a string.`);
    }
    return { ...value };
  });
}

async function writeConfig(configPath: string, config: JsonConfig): Promise<void> {
  const directory = dirname(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertSafeConfigTarget(configPath);
  const temporaryPath = `${configPath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, configPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function assertSafeConfigTarget(configPath: string): Promise<void> {
  try {
    const details = await lstat(configPath);
    if (details.isSymbolicLink()) {
      throw new Error("Configuration target cannot be a symbolic link.");
    }
    if (!details.isFile()) {
      throw new Error("Configuration target must be a regular file.");
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error(
      "MCP server name must start with a letter or number and contain only letters, numbers, '.', '_' or '-'.",
    );
  }
  return name.slice(0, MAX_NAME_LENGTH);
}

function normalizeValue(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`MCP ${label} must not be empty.`);
  }
  if (normalized.length > MAX_VALUE_LENGTH || hasControlCharacter(normalized)) {
    throw new Error(`MCP ${label} contains unsupported characters or is too long.`);
  }
  return normalized;
}

function normalizeValues(values: readonly string[], label: string): string[] {
  return values.map((value) => normalizeValue(value, label));
}

function parseEnvironment(values: readonly string[]): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const assignment of values) {
    const separator = assignment.indexOf("=");
    const key = separator < 0 ? assignment : assignment.slice(0, separator);
    const value = separator < 0 ? "" : assignment.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error("MCP environment names must look like KEY=VALUE.");
    }
    if (value.length > MAX_VALUE_LENGTH || hasControlCharacter(value)) {
      throw new Error("MCP environment values contain unsupported characters or are too long.");
    }
    environment[key] = value;
  }
  return environment;
}

function normalizeTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("MCP timeout must be a positive integer in milliseconds.");
  }
  return value;
}

function countStrings(value: unknown): number {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string").length : 0;
}

function countEnvironment(value: unknown): number {
  return isRecord(value) ? Object.keys(value).length : 0;
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is JsonConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
