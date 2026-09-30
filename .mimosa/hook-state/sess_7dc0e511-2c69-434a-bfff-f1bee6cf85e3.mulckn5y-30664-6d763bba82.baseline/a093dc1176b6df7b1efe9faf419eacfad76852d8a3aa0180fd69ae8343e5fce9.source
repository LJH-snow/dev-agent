import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Directories that are generated, vendored, or cache-only by default. */
export const DEFAULT_IGNORED_DIRECTORIES = Object.freeze([
  ".cache",
  ".dev-agent",
  ".git",
  ".next",
  ".nox",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
] as const);

interface IgnoreRule {
  readonly regex: RegExp;
  readonly negated: boolean;
}

export interface ProjectIgnoreMatcher {
  /** Accepts a project-relative POSIX path and never returns absolute data. */
  isIgnored(relativePath: string, isDirectory?: boolean): boolean;
}

/**
 * Loads the root `.gitignore` and `.ignore` rules without invoking git or
 * executing project code. Rule order is deterministic: built-in generated
 * directories, `.gitignore`, `.ignore`, then explicit excludes. A later rule
 * wins, so an explicit exclude cannot be undone by a negation rule.
 */
export async function createProjectIgnoreMatcher(
  root: string,
  explicitExcludes: readonly string[] = [],
): Promise<ProjectIgnoreMatcher> {
  const resolvedRoot = resolve(root);
  const rules: IgnoreRule[] = DEFAULT_IGNORED_DIRECTORIES.map((name) => ({
    regex: globToRegex(name, false, true),
    negated: false,
  }));

  for (const fileName of [".gitignore", ".ignore"] as const) {
    const content = await readIgnoreFile(resolvedRoot, fileName);
    for (const pattern of parseIgnorePatterns(content)) {
      const rule = compileIgnoreRule(pattern);
      if (rule) rules.push(rule);
    }
  }

  for (const rawPath of explicitExcludes) {
    const candidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(resolvedRoot, rawPath);
    const relativePath = normalizeRelativePath(relative(resolvedRoot, candidate));
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      continue;
    }
    rules.push({
      regex: exactPathRegex(relativePath),
      negated: false,
    });
  }

  return {
    isIgnored(relativePath, isDirectory = false): boolean {
      const normalized = normalizeRelativePath(relativePath);
      if (!normalized || normalized === ".") return false;
      const candidate = isDirectory ? `${normalized}/` : normalized;
      let ignored = false;
      for (const rule of rules) {
        if (rule.regex.test(candidate) || rule.regex.test(normalized)) {
          ignored = !rule.negated;
        }
      }
      return ignored;
    },
  };
}

async function readIgnoreFile(root: string, name: ".gitignore" | ".ignore"): Promise<string> {
  try {
    return await readFile(resolve(root, name), "utf8");
  } catch {
    return "";
  }
}

function parseIgnorePatterns(content: string): readonly string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function compileIgnoreRule(rawPattern: string): IgnoreRule | undefined {
  let pattern = rawPattern;
  let negated = false;
  if (pattern.startsWith("\\#") || pattern.startsWith("\\!")) {
    pattern = pattern.slice(1);
  } else if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }
  pattern = pattern.trim();
  if (!pattern || pattern === ".") return undefined;

  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);
  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);
  pattern = pattern.replace(/^\.\//u, "");
  if (!pattern) return undefined;

  return { regex: globToRegex(pattern, anchored, directoryOnly), negated };
}

function globToRegex(pattern: string, anchored: boolean, directoryOnly: boolean): RegExp {
  const hasSlash = pattern.includes("/");
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        source += ".*";
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegex(char);
  }

  const suffix = directoryOnly ? "(?:/.*)?" : "";
  if (anchored || hasSlash) {
    return new RegExp(`^${source}${suffix}/?$`, "u");
  }
  return new RegExp(`(?:^|/)${source}${suffix}/?$`, "u");
}

function exactPathRegex(path: string): RegExp {
  const source = path
    .split("/")
    .map((segment) => escapeRegex(segment))
    .join("/");
  return new RegExp(`^${source}(?:/.*)?/?$`, "u");
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
}
