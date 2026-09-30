import { lstat, opendir, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  win32,
} from "node:path";

const DEFAULT_MAX_ENTRIES = 2_000;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_RESULTS = 12;
const MAX_TOKEN_CHARS = 160;

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".dev-agent",
  "node_modules",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "coverage",
]);

export interface PathSuggestion {
  readonly path: string;
  readonly isDirectory: boolean;
}

export interface PathCompletionOptions {
  readonly maxEntries?: number;
  readonly maxDepth?: number;
  readonly maxResults?: number;
}

export interface PathCompletionResult {
  readonly tokenStart: number;
  readonly tokenEnd: number;
  readonly token: string;
  readonly suggestions: readonly PathSuggestion[];
}

interface WorkspaceScanOptions {
  readonly root: string;
  readonly maxEntries: number;
  readonly maxDepth: number;
}

/**
 * Returns bounded, workspace-relative entries for the Ink composer.
 *
 * Symlinks are skipped deliberately. The actual attachment resolver performs
 * its own realpath checks, but refusing symlinks here keeps completion both
 * predictable and cheap for very large repositories.
 */
export async function scanWorkspacePaths(
  workingDirectory: string,
  options: PathCompletionOptions = {},
): Promise<readonly PathSuggestion[]> {
  const root = resolve(workingDirectory);
  const maxEntries = positiveLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxDepth = nonNegativeLimit(options.maxDepth, DEFAULT_MAX_DEPTH);
  const scanOptions: WorkspaceScanOptions = { root, maxEntries, maxDepth };
  const results: PathSuggestion[] = [];
  await collectWorkspacePaths(root, "", 0, scanOptions, results);

  return sortSuggestions(results).slice(
    0,
    positiveLimit(options.maxResults, DEFAULT_MAX_RESULTS),
  );
}

/**
 * Finds the `@path` token at the caret and returns matching workspace entries.
 * The replacement span covers the whole token even when the caret is in its
 * middle, so selecting a result never leaves a stale suffix behind.
 */
export async function completeWorkspacePath(
  value: string,
  cursor: number,
  workingDirectory: string,
  options: PathCompletionOptions = {},
): Promise<PathCompletionResult | undefined> {
  const boundedCursor = Math.max(0, Math.min(cursor, Array.from(value).length));
  const token = findAtToken(value, boundedCursor);
  if (!token) return undefined;

  const rawReference = token.token.slice(1);
  if (
    rawReference.length > MAX_TOKEN_CHARS ||
    rawReference.includes("\0") ||
    isAbsolute(rawReference) ||
    win32.isAbsolute(rawReference)
  ) {
    return undefined;
  }

  const root = resolve(workingDirectory);
  const normalizedReference = normalizeReference(rawReference);
  if (normalizedReference === undefined) return undefined;
  const candidates = await scanCompletionPaths(root, normalizedReference, options);
  const tokenIsComplete = token.tokenEnd === boundedCursor;

  const suggestions = candidates
    .filter((candidate) =>
      (
        normalizedReference.endsWith("/") ||
        !tokenIsComplete ||
        candidate.path !== normalizedReference
      ) &&
      candidate.path.startsWith(normalizedReference)
    )
    .sort((left, right) => compareMatches(left, right, normalizedReference))
    .slice(0, positiveLimit(options.maxResults, DEFAULT_MAX_RESULTS));

  if (suggestions.length === 0) return undefined;
  return {
    tokenStart: token.tokenStart,
    tokenEnd: token.tokenEnd,
    token: token.token,
    suggestions,
  };
}

async function scanCompletionPaths(
  root: string,
  reference: string,
  options: PathCompletionOptions,
): Promise<readonly PathSuggestion[]> {
  const maxEntries = positiveLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const directoryReference = reference.endsWith("/")
    ? reference.slice(0, -1)
    : dirname(reference).replaceAll("\\", "/");
  const normalizedDirectory = directoryReference === "." ? "" : directoryReference;
  let scanRoot = root;
  if (normalizedDirectory !== "") {
    const candidateRoot = resolve(root, normalizedDirectory);
    if (!isInsideRoot(root, candidateRoot)) return [];
    try {
      const [stats, realRoot, realCandidate] = await Promise.all([
        lstat(candidateRoot),
        realpath(root),
        realpath(candidateRoot),
      ]);
      if (!stats.isDirectory() || !isInsideRoot(realRoot, realCandidate)) {
        return [];
      }
      scanRoot = candidateRoot;
    } catch {
      return [];
    }
  }

  const results: PathSuggestion[] = [];
  await collectWorkspacePaths(
    scanRoot,
    normalizedDirectory,
    0,
    // Completion is intentionally one directory level at a time. The user
    // can type the next segment to inspect a child directory, which keeps the
    // composer responsive even in repositories with large build trees.
    { root, maxEntries, maxDepth: 0 },
    results,
  );
  return sortSuggestions(results);
}

function findAtToken(
  value: string,
  cursor: number,
): { tokenStart: number; tokenEnd: number; token: string } | undefined {
  const chars = Array.from(value);
  let start = -1;
  for (let index = cursor - 1; index >= 0; index -= 1) {
    const character = chars[index] ?? "";
    if (character === "@" && (index === 0 || isTokenBoundary(chars[index - 1] ?? ""))) {
      start = index;
      break;
    }
    if (isTokenBoundary(character)) break;
  }
  if (start < 0) return undefined;

  let end = cursor;
  while (end < chars.length && !isTokenBoundary(chars[end] ?? "")) {
    end += 1;
  }
  const token = chars.slice(start, end).join("");
  if (!token.startsWith("@") || token.length < 1) return undefined;
  return {
    tokenStart: start,
    tokenEnd: end,
    token,
  };
}

function isTokenBoundary(value: string): boolean {
  return /[\s"'`<>(){}[\],;]/u.test(value);
}

function normalizeReference(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/");
  if (normalized === "") return "";
  if (normalized === "." || normalized === "./") return "";
  if (normalized.startsWith("../") || normalized === "..") return undefined;
  const withoutDot = normalized.startsWith("./") ? normalized.slice(2) : normalized;
  if (withoutDot.startsWith("/") || withoutDot.includes("\0")) return undefined;
  return withoutDot;
}

async function collectWorkspacePaths(
  directory: string,
  relativeDirectory: string,
  depth: number,
  options: WorkspaceScanOptions,
  output: PathSuggestion[],
): Promise<void> {
  if (output.length >= options.maxEntries || depth > options.maxDepth) return;

  let handle;
  try {
    handle = await opendir(directory);
  } catch {
    return;
  }

  const entries: Array<{
    readonly name: string;
    readonly isDirectory: boolean;
  }> = [];
  try {
    for await (const entry of handle) {
      if (entry.isSymbolicLink() || shouldIgnore(entry.name, entry.isDirectory())) {
        continue;
      }
      entries.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      });
    }
  } catch {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (output.length >= options.maxEntries) return;
    const relativePath = join(relativeDirectory, entry.name).replaceAll("\\", "/");
    const absolutePath = resolve(options.root, relativePath);
    if (!isInsideRoot(options.root, absolutePath)) continue;

    let stats;
    try {
      stats = await lstat(absolutePath);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) continue;

    if (stats.isDirectory()) {
      output.push({ path: `${relativePath}/`, isDirectory: true });
      if (depth < options.maxDepth) {
        await collectWorkspacePaths(
          absolutePath,
          relativePath,
          depth + 1,
          options,
          output,
        );
      }
      continue;
    }
    if (stats.isFile()) {
      output.push({ path: relativePath, isDirectory: false });
    }
  }
}

function shouldIgnore(name: string, isDirectory: boolean): boolean {
  return isDirectory && (
    IGNORED_DIRECTORY_NAMES.has(name) ||
    (name.startsWith(".") && name !== "." && name !== "..")
  );
}

function isInsideRoot(root: string, target: string): boolean {
  const relativeTarget = relative(root, target).replaceAll("\\", "/");
  return (
    relativeTarget === "" ||
    (relativeTarget !== ".." &&
      !relativeTarget.startsWith("../") &&
      !win32.isAbsolute(relativeTarget))
  );
}

function sortSuggestions(items: readonly PathSuggestion[]): PathSuggestion[] {
  return [...items].sort((left, right) => {
    const leftDepth = left.path.split("/").length;
    const rightDepth = right.path.split("/").length;
    return leftDepth - rightDepth ||
      left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
  });
}

function compareMatches(
  left: PathSuggestion,
  right: PathSuggestion,
  reference: string,
): number {
  const leftExact = left.path === reference || left.path === `${reference}/`;
  const rightExact = right.path === reference || right.path === `${reference}/`;
  if (leftExact !== rightExact) return leftExact ? -1 : 1;

  const leftRemainder = left.path.slice(reference.length);
  const rightRemainder = right.path.slice(reference.length);
  const leftDirectory = left.isDirectory ? 0 : 1;
  const rightDirectory = right.isDirectory ? 0 : 1;
  return leftDirectory - rightDirectory ||
    leftRemainder.length - rightRemainder.length ||
    left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function nonNegativeLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0
    ? value
    : fallback;
}
