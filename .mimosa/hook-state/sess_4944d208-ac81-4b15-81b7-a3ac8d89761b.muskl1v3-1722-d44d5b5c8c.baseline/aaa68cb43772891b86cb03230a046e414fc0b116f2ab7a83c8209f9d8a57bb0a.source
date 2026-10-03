import { homedir } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AgentLoopBudget } from "./budget.js";

const DEFAULT_MAX_AGENT_FILE_BYTES = 128 * 1024;
const DEFAULT_MAX_INSTRUCTION_CHARS = 16 * 1024;
const MAX_AGENT_COUNT = 256;
const MAX_TOOL_ALLOWLIST = 256;
const MAX_DESCRIPTION_CHARS = 512;
const MAX_MODEL_CHARS = 256;
const MAX_PROVIDER_CHARS = 64;
const MAX_BUDGET_VALUE = 2 ** 31 - 1;
const AGENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/u;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:@/-]+$/u;
const FRONT_MATTER_FIELDS = new Set([
  "name",
  "description",
  "provider",
  "model",
  "toolAllowlist",
  "maxTurns",
  "maxTokens",
  "maxDurationMs",
  "maxOutputChars",
]);

export type AgentDefinitionScope = "project" | "user";

export interface AgentDefinition {
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
  readonly scope: AgentDefinitionScope;
  readonly path: string;
  readonly provider?: string;
  readonly model?: string;
  readonly toolAllowlist?: readonly string[];
  readonly budget?: AgentLoopBudget;
}

export interface AgentDefinitionRegistryOptions {
  readonly workingDirectory: string;
  /** Directory containing user agent folders; defaults to ~/.dev-agent/agents. */
  readonly userAgentsDirectory?: string;
  readonly maxFileBytes?: number;
  readonly maxInstructionChars?: number;
  /** Optional runtime capabilities; unsupported optional definitions are skipped. */
  readonly supportedProviders?: readonly string[];
  readonly availableTools?: readonly string[];
}

/**
 * Discovers bounded Markdown specialist definitions without executing code.
 * Project definitions shadow user definitions with the same id.
 */
export class AgentDefinitionRegistry {
  private constructor(private readonly agents: readonly AgentDefinition[]) {}

  static async load(options: AgentDefinitionRegistryOptions): Promise<AgentDefinitionRegistry> {
    const maxFileBytes = normalizePositiveLimit(
      options.maxFileBytes,
      DEFAULT_MAX_AGENT_FILE_BYTES,
    );
    const maxInstructionChars = normalizePositiveLimit(
      options.maxInstructionChars,
      DEFAULT_MAX_INSTRUCTION_CHARS,
    );
    const supportedProviders = options.supportedProviders === undefined
      ? undefined : new Set(options.supportedProviders);
    const availableTools = options.availableTools === undefined
      ? undefined : new Set(options.availableTools);
    const projectDirectory = join(resolve(options.workingDirectory), ".dev-agent", "agents");
    const userDirectory = resolve(
      options.userAgentsDirectory ?? join(homedir(), ".dev-agent", "agents"),
    );

    const userAgents = await loadAgentDirectory(
      userDirectory,
      "user",
      maxFileBytes,
      maxInstructionChars,
      supportedProviders,
      availableTools,
    );
    const projectAgents = await loadAgentDirectory(
      projectDirectory,
      "project",
      maxFileBytes,
      maxInstructionChars,
      supportedProviders,
      availableTools,
    );
    const byId = new Map<string, AgentDefinition>();
    for (const agent of [...userAgents, ...projectAgents]) {
      byId.set(agent.id, agent);
    }

    return new AgentDefinitionRegistry(
      [...byId.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, MAX_AGENT_COUNT),
    );
  }

  list(): readonly AgentDefinition[] {
    return this.agents.map(cloneAgent);
  }

  get(id: string): AgentDefinition | undefined {
    const normalized = id.trim();
    const agent = this.agents.find((candidate) => candidate.id === normalized);
    return agent === undefined ? undefined : cloneAgent(agent);
  }
}

async function loadAgentDirectory(
  directory: string,
  scope: AgentDefinitionScope,
  maxFileBytes: number,
  maxInstructionChars: number,
  supportedProviders?: ReadonlySet<string>,
  availableTools?: ReadonlySet<string>,
): Promise<AgentDefinition[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    return [];
  }

  const agents: AgentDefinition[] = [];
  for (const entry of entries
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (agents.length >= MAX_AGENT_COUNT) break;
    const path = join(directory, entry.name, "AGENT.md");
    try {
      const fileStat = await stat(path);
      if (!fileStat.isFile() || fileStat.size > maxFileBytes) continue;
      const raw = await readFile(path, "utf8");
      const parsed = parseAgent(
        raw, entry.name, scope, path, maxInstructionChars, supportedProviders, availableTools,
      );
      if (parsed !== undefined) agents.push(parsed);
    } catch {
      // Optional agent definitions must not prevent the CLI from starting.
    }
  }
  return agents;
}

function parseAgent(
  raw: string,
  fallbackId: string,
  scope: AgentDefinitionScope,
  path: string,
  maxInstructionChars: number,
  supportedProviders?: ReadonlySet<string>,
  availableTools?: ReadonlySet<string>,
): AgentDefinition | undefined {
  const parsed = parseDocument(raw);
  if (parsed === undefined) return undefined;

  const id = parsed.fields.get("name") ?? fallbackId;
  if (!isAgentId(id)) return undefined;
  const description =
    parsed.fields.get("description") ??
    parsed.body.match(/^#\s+(.+)$/mu)?.[1]?.trim() ??
    `${id} agent`;
  if (description.length === 0 || description.length > MAX_DESCRIPTION_CHARS) return undefined;

  const instructions = parsed.body.trim();
  if (instructions.length === 0) return undefined;

  const provider = readBoundedSelector(parsed.fields.get("provider"), MAX_PROVIDER_CHARS);
  const model = readBoundedSelector(parsed.fields.get("model"), MAX_MODEL_CHARS);
  if (parsed.fields.has("provider") && provider === undefined) return undefined;
  if (provider !== undefined && supportedProviders !== undefined && !supportedProviders.has(provider)) return undefined;
  if (parsed.fields.has("model") && model === undefined) return undefined;

  const toolAllowlist = readToolAllowlist(parsed.fields.get("toolAllowlist"));
  if (parsed.fields.has("toolAllowlist") && toolAllowlist === undefined) return undefined;
  if (toolAllowlist !== undefined && availableTools !== undefined &&
      toolAllowlist.some((tool) => !availableTools.has(tool))) return undefined;

  const budget = readBudget(parsed.fields);
  if (budget === INVALID) return undefined;

  return {
    id,
    description,
    instructions: instructions.slice(0, maxInstructionChars),
    scope,
    path,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(toolAllowlist === undefined ? {} : { toolAllowlist }),
    ...(budget === undefined ? {} : { budget }),
  };
}

function parseDocument(raw: string):
  | { readonly fields: ReadonlyMap<string, string>; readonly body: string }
  | undefined {
  if (!/^---[ \t]*\r?\n/u.test(raw)) return { fields: new Map(), body: raw };
  const match = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u);
  if (!match) return undefined;

  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) return undefined;
    const key = trimmed.slice(0, separator).trim();
    if (!FRONT_MATTER_FIELDS.has(key) || fields.has(key)) return undefined;
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/gu, "");
    if (value === "") return undefined;
    fields.set(key, value);
  }
  return { fields, body: raw.slice(match[0].length) };
}

function readBoundedSelector(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined || value.length === 0 || value.length > maxLength) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value) ? value : undefined;
}

function readToolAllowlist(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  let entries: unknown;
  if (value.startsWith("[")) {
    try {
      entries = JSON.parse(value);
    } catch {
      if (!value.endsWith("]")) return undefined;
      entries = value.slice(1, -1).split(",").map((entry) => entry.trim().replace(/^["']|["']$/gu, ""));
    }
  } else {
    entries = value.split(",").map((entry) => entry.trim());
  }
  if (!Array.isArray(entries) || entries.length > MAX_TOOL_ALLOWLIST) {
    return undefined;
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0 || !TOOL_NAME_PATTERN.test(entry)) {
      return undefined;
    }
    if (seen.has(entry)) return undefined;
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized;
}

const INVALID = Symbol("invalid-agent-field");

function readBudget(
  fields: ReadonlyMap<string, string>,
): AgentLoopBudget | typeof INVALID | undefined {
  const keys = ["maxTurns", "maxTokens", "maxDurationMs", "maxOutputChars"] as const;
  const values: Partial<Record<(typeof keys)[number], number>> = {};
  for (const key of keys) {
    const value = fields.get(key);
    if (value === undefined) continue;
    if (!/^\d+$/u.test(value)) return INVALID;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > MAX_BUDGET_VALUE) return INVALID;
    if (key === "maxTurns" && parsed < 1) return INVALID;
    values[key] = parsed;
  }
  return Object.keys(values).length === 0 ? undefined : values;
}

function isAgentId(value: string): boolean {
  return value === value.toLowerCase() && AGENT_ID_PATTERN.test(value);
}

function cloneAgent(agent: AgentDefinition): AgentDefinition {
  return {
    ...agent,
    ...(agent.toolAllowlist === undefined ? {} : { toolAllowlist: [...agent.toolAllowlist] }),
    ...(agent.budget === undefined ? {} : { budget: { ...agent.budget } }),
  };
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
