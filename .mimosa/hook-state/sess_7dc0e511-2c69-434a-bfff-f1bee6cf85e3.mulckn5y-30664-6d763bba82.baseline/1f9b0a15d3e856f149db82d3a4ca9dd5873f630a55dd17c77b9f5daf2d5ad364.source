import { homedir } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_EXTENSION_COUNT = 256;
const MAX_LABEL_COUNT = 64;
const MAX_LABEL_LENGTH = 128;
const MAX_NAME_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 512;
const SAFE_LABEL_PATTERN = /^[a-z0-9._:/-]+$/iu;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/iu;
const MANIFEST_FIELDS = new Set([
  "id",
  "name",
  "version",
  "description",
  "tools",
  "commands",
  "skills",
  "mcpServers",
  "config",
  "resources",
]);

export type ExtensionScope = "project" | "user";

export interface ExtensionSurfaceSummary {
  readonly tools: number;
  readonly commands: number;
  readonly skills: number;
  readonly mcpServers: number;
  readonly configKeys: number;
  readonly resources: number;
}

export interface ExtensionDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: string | null;
  readonly description: string;
  readonly scope: ExtensionScope;
  readonly surfaces: ExtensionSurfaceSummary;
}

export interface ExtensionRegistryOptions {
  readonly workingDirectory: string;
  /** Directory containing user extension folders; defaults to ~/.dev-agent/extensions. */
  readonly userExtensionsDirectory?: string;
  readonly maxManifestBytes?: number;
}

/**
 * Discovers extension manifests without loading executable code or starting
 * any declared tool/MCP process. Project extensions shadow user extensions.
 */
export class ExtensionRegistry {
  private constructor(private readonly extensions: readonly ExtensionDefinition[]) {}

  static async load(options: ExtensionRegistryOptions): Promise<ExtensionRegistry> {
    const maxManifestBytes = normalizePositiveLimit(
      options.maxManifestBytes,
      DEFAULT_MAX_MANIFEST_BYTES,
    );
    const projectDirectory = join(
      resolve(options.workingDirectory),
      ".dev-agent",
      "extensions",
    );
    const userDirectory = resolve(
      options.userExtensionsDirectory ?? join(homedir(), ".dev-agent", "extensions"),
    );

    const userExtensions = await loadExtensionDirectory(
      userDirectory,
      "user",
      maxManifestBytes,
    );
    const projectExtensions = await loadExtensionDirectory(
      projectDirectory,
      "project",
      maxManifestBytes,
    );
    const byId = new Map<string, ExtensionDefinition>();
    for (const extension of [...userExtensions, ...projectExtensions]) {
      byId.set(extension.id, extension);
    }

    return new ExtensionRegistry(
      [...byId.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, MAX_EXTENSION_COUNT),
    );
  }

  list(): readonly ExtensionDefinition[] {
    return this.extensions.map(cloneExtension);
  }

  get(id: string): ExtensionDefinition | undefined {
    const extension = this.extensions.find((candidate) => candidate.id === id.trim());
    return extension === undefined ? undefined : cloneExtension(extension);
  }
}

async function loadExtensionDirectory(
  directory: string,
  scope: ExtensionScope,
  maxManifestBytes: number,
): Promise<ExtensionDefinition[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    return [];
  }

  const extensions: ExtensionDefinition[] = [];
  for (const entry of entries
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (extensions.length >= MAX_EXTENSION_COUNT) {
      break;
    }
    const manifestPath = join(directory, entry.name, "extension.json");
    try {
      const fileStat = await stat(manifestPath);
      if (!fileStat.isFile() || fileStat.size > maxManifestBytes) {
        continue;
      }
      const raw = await readFile(manifestPath, "utf8");
      const parsed = parseManifest(raw, scope);
      if (parsed !== undefined) {
        extensions.push(parsed);
      }
    } catch {
      // Optional extensions must not prevent the agent from starting.
    }
  }
  return extensions;
}

function parseManifest(raw: string, scope: ExtensionScope): ExtensionDefinition | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isPlainRecord(parsed)) {
    return undefined;
  }
  if (Object.keys(parsed).some((key) => !MANIFEST_FIELDS.has(key))) {
    return undefined;
  }

  const id = readId(parsed.id);
  if (id === undefined) {
    return undefined;
  }
  const name = readHumanText(parsed.name, MAX_NAME_LENGTH) ?? id;
  const description =
    readHumanText(parsed.description, MAX_DESCRIPTION_LENGTH) ?? `${name} extension`;
  const version = readHumanText(parsed.version, MAX_NAME_LENGTH);
  const tools = readLabels(parsed.tools);
  const commands = readLabels(parsed.commands);
  const skills = readLabels(parsed.skills);
  const mcpServers = readLabels(parsed.mcpServers);
  const configKeys = readLabels(parsed.config);
  const resources = readLabels(parsed.resources);
  if (
    tools === undefined ||
    commands === undefined ||
    skills === undefined ||
    mcpServers === undefined ||
    configKeys === undefined ||
    resources === undefined
  ) {
    return undefined;
  }

  return {
    id,
    name,
    version: version ?? null,
    description,
    scope,
    surfaces: {
      tools: tools.length,
      commands: commands.length,
      skills: skills.length,
      mcpServers: mcpServers.length,
      configKeys: configKeys.length,
      resources: resources.length,
    },
  };
}

function readId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function readHumanText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return undefined;
  }
  return value.trim();
}

function readLabels(value: unknown): string[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_LABEL_COUNT) {
    return undefined;
  }
  const labels = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > MAX_LABEL_LENGTH ||
      !SAFE_LABEL_PATTERN.test(item.trim())
    ) {
      return undefined;
    }
    labels.add(item.trim());
  }
  return [...labels].sort((left, right) => left.localeCompare(right));
}

function cloneExtension(extension: ExtensionDefinition): ExtensionDefinition {
  return {
    ...extension,
    surfaces: { ...extension.surfaces },
  };
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
