import { homedir } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_MAX_SKILL_FILE_BYTES = 128 * 1024;
const DEFAULT_MAX_INSTRUCTION_CHARS = 16 * 1024;

export type SkillScope = "project" | "user";

export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly scope: SkillScope;
  readonly path: string;
}

export interface SkillRegistryOptions {
  readonly workingDirectory: string;
  /** Directory containing user skill folders; defaults to ~/.dev-agent/skills. */
  readonly userSkillsDirectory?: string;
  readonly maxFileBytes?: number;
  readonly maxInstructionChars?: number;
}

/**
 * Loads bounded Markdown instructions without activating them. Project skills
 * shadow user skills with the same name so a repository can define its own
 * workflow contract.
 */
export class SkillRegistry {
  private constructor(private readonly skills: readonly SkillDefinition[]) {}

  static async load(options: SkillRegistryOptions): Promise<SkillRegistry> {
    const maxFileBytes = normalizePositiveLimit(
      options.maxFileBytes,
      DEFAULT_MAX_SKILL_FILE_BYTES,
    );
    const maxInstructionChars = normalizePositiveLimit(
      options.maxInstructionChars,
      DEFAULT_MAX_INSTRUCTION_CHARS,
    );
    const projectDirectory = join(resolve(options.workingDirectory), ".dev-agent", "skills");
    const userDirectory = options.userSkillsDirectory ?? join(homedir(), ".dev-agent", "skills");
    const projectSkills = await loadSkillDirectory(
      projectDirectory,
      "project",
      maxFileBytes,
      maxInstructionChars,
    );
    const userSkills = await loadSkillDirectory(
      userDirectory,
      "user",
      maxFileBytes,
      maxInstructionChars,
    );
    const byName = new Map<string, SkillDefinition>();
    for (const skill of [...userSkills, ...projectSkills]) {
      byName.set(skill.name, skill);
    }
    return new SkillRegistry([...byName.values()].sort((left, right) => left.name.localeCompare(right.name)));
  }

  list(): readonly SkillDefinition[] {
    return this.skills.map((skill) => ({ ...skill }));
  }

  get(name: string): SkillDefinition | undefined {
    const skill = this.skills.find((candidate) => candidate.name === name);
    return skill === undefined ? undefined : { ...skill };
  }

  activate(name: string): string {
    const skill = this.skills.find((candidate) => candidate.name === name);
    if (!skill) {
      throw new Error(`unknown skill: ${name}`);
    }
    return skill.instructions;
  }
}

async function loadSkillDirectory(
  directory: string,
  scope: SkillScope,
  maxFileBytes: number,
  maxInstructionChars: number,
): Promise<SkillDefinition[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    return [];
  }

  const skills: SkillDefinition[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = join(directory, entry.name, "SKILL.md");
    try {
      const fileStat = await stat(path);
      if (!fileStat.isFile() || fileStat.size > maxFileBytes) {
        continue;
      }
      const raw = await readFile(path, "utf8");
      const parsed = parseSkill(raw, entry.name, scope, path, maxInstructionChars);
      if (parsed) {
        skills.push(parsed);
      }
    } catch {
      // A broken optional skill must not stop the agent from starting.
    }
  }
  return skills;
}

function parseSkill(
  raw: string,
  fallbackName: string,
  scope: SkillScope,
  path: string,
  maxInstructionChars: number,
): SkillDefinition | undefined {
  const frontMatter = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const fields = new Map<string, string>();
  const header = frontMatter?.[1];
  if (header !== undefined) {
    for (const line of header.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && value) fields.set(key, value);
    }
  }
  const name = fields.get("name") ?? fallbackName;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    return undefined;
  }
  const instructions = (frontMatter ? raw.slice(frontMatter[0].length) : raw).trim();
  const description =
    fields.get("description") ??
    instructions.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
    `${name} skill`;
  return {
    name,
    description,
    instructions: instructions.slice(0, maxInstructionChars),
    scope,
    path,
  };
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
