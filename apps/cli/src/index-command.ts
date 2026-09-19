import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  createProjectIgnoreMatcher,
  scanFile,
  type CodeSymbol,
  type ProjectIgnoreMatcher,
} from "@dev-agent/code-intelligence";

export interface IndexWarning {
  readonly kind: "skipped-directory";
  /** A path relative to the indexed root; absolute paths are intentionally omitted. */
  readonly path: string;
  /** A stable filesystem error category, without the error message or path. */
  readonly code: "EACCES" | "EPERM" | "ENOENT" | "ENOTDIR" | "UNKNOWN";
}

export interface IndexReport {
  readonly path: string;
  readonly indexPath: string;
  readonly files: number;
  readonly symbols: number;
  /** Files whose stored source and symbols were reused because nothing changed. */
  readonly reused: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheHitRate: number;
  readonly languages: Readonly<Record<string, number>>;
  /** Number of child directories that could not be enumerated. */
  readonly skipped: number;
  /** Structured warnings for skipped child directories. */
  readonly warnings: readonly IndexWarning[];
  /** Number of distinct explicit exclude paths that matched a file or directory. */
  readonly excluded: number;
  readonly errors: number;
  readonly updatedAt: string;
}

export type IndexProgressPhase = "discovering" | "processing" | "persisting";

export interface IndexProgress {
  readonly phase: IndexProgressPhase;
  readonly completed: number;
  readonly total: number;
  readonly active: number;
  readonly reused: number;
  readonly rescanned: number;
}

export interface IndexDirectoryOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: IndexProgress) => void;
  readonly concurrency?: number;
}

export class IndexRefreshCancelledError extends Error {
  readonly code = "INDEX_REFRESH_CANCELLED" as const;
  readonly progress: IndexProgress;

  constructor(progress: IndexProgress) {
    super("index refresh cancelled");
    this.name = "IndexRefreshCancelledError";
    this.progress = progress;
  }
}

export type IndexRefreshResult =
  | { readonly status: "completed"; readonly report: IndexReport }
  | { readonly status: "cancelled"; readonly progress: IndexProgress };

export async function refreshIndexDirectory(
  rootInput: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
  excludeInputs: readonly string[] = [],
  indexPathInput?: string,
  options: IndexDirectoryOptions = {}
): Promise<IndexRefreshResult> {
  try {
    return {
      status: "completed",
      report: await indexDirectory(rootInput, maxDepth, excludeInputs, indexPathInput, options),
    };
  } catch (error) {
    if (error instanceof IndexRefreshCancelledError) {
      return { status: "cancelled", progress: error.progress };
    }
    throw error;
  }
}

const DEFAULT_MAX_DEPTH = 8;
const MAX_INDEX_INPUT_BYTES = 16 * 1024 * 1024; // 16 MiB
const DEFAULT_INDEX_CONCURRENCY = 4;
const MAX_INDEX_CONCURRENCY = 8;

/** Directories that never belong in a source index. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  ".cache",
  ".dev-agent",
  ".nox",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "out",
  "target",
  "venv",
]);

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
};

interface IndexFile {
  readonly version: 1;
  readonly files: Record<string, string>;
  readonly symbols: CodeSymbol[];
  /** Lets a later scan tell which files changed without re-reading them. */
  readonly signatures: Record<string, FileSignature>;
  /** Metadata used by `index status`; never contains source or absolute paths. */
  readonly refresh: {
    readonly updatedAt: string;
    readonly cacheHits: number;
    readonly cacheMisses: number;
    readonly errors: number;
    readonly excluded: number;
  };
}

interface FileSignature {
  readonly mtimeMs: number;
  readonly size: number;
  /** Changes when a file is rewritten even if its mtime and byte length are restored. */
  readonly ctimeMs: number;
}

/**
 * Scans a directory and writes a JSON symbol index to
 * `<root>/.dev-agent/index.json`, using the same ignore rules as the
 * `code-search` tool. The file format matches `JsonFileCodeIndex`, so it can be
 * loaded by that class later.
 */
export async function indexDirectory(
  rootInput: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
  excludeInputs: readonly string[] = [],
  indexPathInput?: string,
  options: IndexDirectoryOptions = {}
): Promise<IndexReport> {
  const root = resolve(rootInput);
  const excludes = normalizeExcludePaths(root, excludeInputs);
  const indexPath = indexPathInput === undefined
    ? join(root, ".dev-agent", "index.json")
    : resolve(indexPathInput);
  const concurrency = normalizeConcurrency(options.concurrency);
  let progress: IndexProgress = {
    phase: "discovering",
    completed: 0,
    total: 0,
    active: 0,
    reused: 0,
    rescanned: 0,
  };
  const reportProgress = (next: IndexProgress): void => {
    progress = next;
    options.onProgress?.(next);
  };
  const throwIfCancelled = (): void => {
    if (options.signal?.aborted) {
      throw new IndexRefreshCancelledError(progress);
    }
  };
  throwIfCancelled();

  const ignore = await createProjectIgnoreMatcher(root);
  const info = await stat(root);
  if (!info.isDirectory()) {
    throw new Error(`${root} is not a directory`);
  }

  const signatures = new Map<string, FileSignature>();
  const warnings: IndexWarning[] = [];
  const matchedExcludes = new Set<string>();
  let discovered = 0;
  await collectFiles(
    root,
    root,
    0,
    maxDepth,
    signatures,
    warnings,
    matchedExcludes,
    excludes,
    ignore,
    true,
    throwIfCancelled,
    () => {
      discovered += 1;
      reportProgress({
        phase: "discovering",
        completed: discovered,
        total: 0,
        active: 0,
        reused: 0,
        rescanned: 0,
      });
    }
  );

  throwIfCancelled();
  const previous = await readPersistedIndex(indexPath);
  const previousSymbols = groupSymbolsByFile(previous?.symbols ?? []);
  const entries = [...signatures.entries()];
  const processed: Array<{
    readonly filePath: string;
    readonly source: string;
    readonly symbols: readonly CodeSymbol[];
  } | undefined> = new Array(entries.length);
  let nextEntry = 0;
  let completed = 0;
  let active = 0;
  let reused = 0;
  let rescanned = 0;

  const processEntry = async (): Promise<void> => {
    for (;;) {
      throwIfCancelled();
      const entryIndex = nextEntry;
      nextEntry += 1;
      if (entryIndex >= entries.length) {
        return;
      }

      const entry = entries[entryIndex];
      if (!entry) {
        return;
      }
      const [filePath, signature] = entry;
      active += 1;
      try {
        reportProgress({
          phase: "processing",
          completed,
          total: entries.length,
          active,
          reused,
          rescanned,
        });
        throwIfCancelled();

        const previousSource = previous?.files[filePath];
        const previousSignature = previous?.signatures[filePath];
        if (
          typeof previousSource === "string" &&
          previousSignature &&
          previousSignature.mtimeMs === signature.mtimeMs &&
          previousSignature.size === signature.size &&
          previousSignature.ctimeMs === signature.ctimeMs
        ) {
          processed[entryIndex] = {
            filePath,
            source: previousSource,
            symbols: previousSymbols.get(filePath) ?? [],
          };
          reused += 1;
        } else {
          const source = await readSource(filePath);
          throwIfCancelled();
          if (source !== undefined) {
            processed[entryIndex] = {
              filePath,
              source,
              symbols: scanFile(source, filePath),
            };
            rescanned += 1;
          }
        }
      } finally {
        active -= 1;
        completed += 1;
        reportProgress({
          phase: "processing",
          completed,
          total: entries.length,
          active,
          reused,
          rescanned,
        });
      }
    }
  };

  const workerCount = Math.min(concurrency, Math.max(1, entries.length));
  await Promise.all(Array.from({ length: workerCount }, () => processEntry()));
  throwIfCancelled();

  const files = new Map<string, string>();
  const symbols: CodeSymbol[] = [];
  for (const [entryIndex, result] of processed.entries()) {
    if (!result) {
      const entry = entries[entryIndex];
      if (entry) {
        signatures.delete(entry[0]);
      }
      continue;
    }
    files.set(result.filePath, result.source);
    symbols.push(...result.symbols);
  }

  const updatedAt = new Date().toISOString();
  const cacheHits = reused;
  const cacheMisses = Math.max(0, files.size - reused);
  const errors = warnings.length;
  const payload: IndexFile = {
    version: 1,
    files: Object.fromEntries(files),
    symbols,
    signatures: Object.fromEntries(signatures),
    refresh: {
      updatedAt,
      cacheHits,
      cacheMisses,
      errors,
      excluded: matchedExcludes.size,
    },
  };
  throwIfCancelled();
  await mkdir(dirname(indexPath), { recursive: true });
  reportProgress({
    phase: "persisting",
    completed: entries.length,
    total: entries.length,
    active: 0,
    reused,
    rescanned,
  });
  throwIfCancelled();
  await writeIndexAtomically(indexPath, `${JSON.stringify(payload)}\n`, options.signal, progress);

  return {
    path: root,
    indexPath,
    files: files.size,
    symbols: symbols.length,
    reused,
    cacheHits,
    cacheMisses,
    cacheHitRate: cacheHits + cacheMisses === 0 ? 1 : cacheHits / (cacheHits + cacheMisses),
    languages: countLanguages(files.keys()),
    skipped: warnings.length,
    warnings,
    excluded: matchedExcludes.size,
    errors,
    updatedAt,
  };
}

async function collectFiles(
  dir: string,
  root: string,
  depth: number,
  maxDepth: number,
  signatures: Map<string, FileSignature>,
  warnings: IndexWarning[],
  matchedExcludes: Set<string>,
  excludes: ReadonlySet<string>,
  ignore: ProjectIgnoreMatcher,
  isRoot: boolean,
  throwIfCancelled: () => void,
  onFile: () => void
): Promise<void> {
  throwIfCancelled();
  if (depth > maxDepth) {
    return;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isRoot) {
      throw error;
    }
    warnings.push({
      kind: "skipped-directory",
      path: relative(root, dir) || ".",
      code: classifyDirectoryError(error),
    });
    return;
  }

  entries.sort((left, right) => comparePathNames(left.name, right.name));

  for (const entry of entries) {
    throwIfCancelled();
    const entryPath = join(dir, entry.name);
    if (excludes.has(entryPath)) {
      matchedExcludes.add(entryPath);
      continue;
    }

    const relativePath = relative(root, entryPath);
    if (SKIPPED_DIRECTORIES.has(entry.name) || ignore.isIgnored(relativePath, entry.isDirectory())) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectFiles(
        join(dir, entry.name),
        root,
        depth + 1,
        maxDepth,
        signatures,
        warnings,
        matchedExcludes,
        excludes,
        ignore,
        false,
        throwIfCancelled,
        onFile
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const language = LANGUAGE_BY_EXTENSION[extname(entry.name)];
    if (!language) {
      continue;
    }

    const filePath = entryPath;
    try {
      const info = await stat(filePath);
      if (info.size > MAX_INDEX_INPUT_BYTES) {
        continue;
      }
      signatures.set(filePath, {
        mtimeMs: info.mtimeMs,
        size: info.size,
        ctimeMs: info.ctimeMs,
      });
      onFile();
    } catch {
      // Skip unreadable files instead of failing the whole scan.
    }
  }
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_INDEX_CONCURRENCY;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("index refresh concurrency must be a positive integer");
  }
  return Math.min(value, MAX_INDEX_CONCURRENCY);
}

async function writeIndexAtomically(
  indexPath: string,
  contents: string,
  signal: AbortSignal | undefined,
  progress: IndexProgress
): Promise<void> {
  if (signal?.aborted) {
    throw new IndexRefreshCancelledError(progress);
  }
  const temporaryPath = `${indexPath}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    if (signal?.aborted) {
      throw new IndexRefreshCancelledError(progress);
    }
    await rename(temporaryPath, indexPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizeExcludePaths(root: string, inputs: readonly string[]): ReadonlySet<string> {
  const excludes = new Set<string>();
  for (const input of inputs) {
    const candidate = resolve(input);
    const relativePath = relative(root, candidate);
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error("--exclude paths must be inside the indexed directory and cannot exclude its root");
    }
    excludes.add(candidate);
  }
  return excludes;
}

function comparePathNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface PersistedIndex {
  readonly files: Record<string, string>;
  readonly symbols: CodeSymbol[];
  readonly signatures: Record<string, FileSignature>;
}

/**
 * Loads the index a previous run wrote. Anything unexpected returns undefined,
 * which makes the caller fall back to a full scan instead of failing.
 */
async function readPersistedIndex(indexPath: string): Promise<PersistedIndex | undefined> {
  try {
    const info = await stat(indexPath);
    if (!info.isFile() || info.size > MAX_INDEX_INPUT_BYTES) {
      return undefined;
    }
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      files?: unknown;
      symbols?: unknown;
      signatures?: unknown;
    };
    if (
      parsed.version !== 1 ||
      !isRecord(parsed.files) ||
      !Array.isArray(parsed.symbols) ||
      !isRecord(parsed.signatures)
    ) {
      return undefined;
    }

    const files: Record<string, string> = {};
    for (const [filePath, source] of Object.entries(parsed.files)) {
      if (typeof source === "string") {
        files[filePath] = source;
      }
    }

    const signatures: Record<string, FileSignature> = {};
    for (const [filePath, value] of Object.entries(parsed.signatures)) {
      if (isSignature(value)) {
        signatures[filePath] = {
          mtimeMs: value.mtimeMs,
          size: value.size,
          ctimeMs: value.ctimeMs,
        };
      }
    }

    return {
      files,
      symbols: parsed.symbols.filter(isCodeSymbol),
      signatures,
    };
  } catch {
    return undefined;
  }
}

function groupSymbolsByFile(symbols: readonly CodeSymbol[]): Map<string, CodeSymbol[]> {
  const byFile = new Map<string, CodeSymbol[]>();
  for (const symbol of symbols) {
    const current = byFile.get(symbol.filePath) ?? [];
    current.push(symbol);
    byFile.set(symbol.filePath, current);
  }
  return byFile;
}

function classifyDirectoryError(error: unknown): IndexWarning["code"] {
  if (!isNodeError(error)) {
    return "UNKNOWN";
  }
  switch (error.code) {
    case "EACCES":
    case "EPERM":
    case "ENOENT":
    case "ENOTDIR":
      return error.code;
    default:
      return "UNKNOWN";
  }
}

async function readSource(filePath: string): Promise<string | undefined> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > MAX_INDEX_INPUT_BYTES) {
      return undefined;
    }
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function countLanguages(files: Iterable<string>): Record<string, number> {
  const languages: Record<string, number> = {};
  for (const filePath of files) {
    const language = LANGUAGE_BY_EXTENSION[extname(filePath)];
    if (language) {
      languages[language] = (languages[language] ?? 0) + 1;
    }
  }
  return languages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSignature(value: unknown): value is FileSignature {
  return (
    isRecord(value) &&
    typeof value.mtimeMs === "number" &&
    Number.isFinite(value.mtimeMs) &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    typeof value.ctimeMs === "number" &&
    Number.isFinite(value.ctimeMs)
  );
}

function isCodeSymbol(value: unknown): value is CodeSymbol {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.filePath === "string" &&
    typeof value.kind === "string" &&
    typeof value.line === "number"
  );
}
