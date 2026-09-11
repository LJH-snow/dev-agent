import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { scanFile, type CodeSymbol } from "@dev-agent/code-intelligence";

export interface IndexReport {
  readonly path: string;
  readonly indexPath: string;
  readonly files: number;
  readonly symbols: number;
  /** Files whose stored source and symbols were reused because nothing changed. */
  readonly reused: number;
  readonly languages: Readonly<Record<string, number>>;
}

const DEFAULT_MAX_DEPTH = 8;

/** Directories that never belong in a source index. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  ".cache",
  ".dev-agent",
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
}

interface FileSignature {
  readonly mtimeMs: number;
  readonly size: number;
}

/**
 * Scans a directory and writes a JSON symbol index to
 * `<root>/.dev-agent/index.json`, using the same ignore rules as the
 * `code-search` tool. The file format matches `JsonFileCodeIndex`, so it can be
 * loaded by that class later.
 */
export async function indexDirectory(
  rootInput: string,
  maxDepth: number = DEFAULT_MAX_DEPTH
): Promise<IndexReport> {
  const root = resolve(rootInput);
  const info = await stat(root);
  if (!info.isDirectory()) {
    throw new Error(`${root} is not a directory`);
  }

  const signatures = new Map<string, FileSignature>();
  await collectFiles(root, 0, maxDepth, signatures);

  const previous = await readPersistedIndex(root);
  const previousSymbols = groupSymbolsByFile(previous?.symbols ?? []);
  const files = new Map<string, string>();
  const symbols: CodeSymbol[] = [];
  let reused = 0;

  for (const [filePath, signature] of signatures) {
    const previousSource = previous?.files[filePath];
    const previousSignature = previous?.signatures[filePath];
    if (
      typeof previousSource === "string" &&
      previousSignature &&
      previousSignature.mtimeMs === signature.mtimeMs &&
      previousSignature.size === signature.size
    ) {
      files.set(filePath, previousSource);
      symbols.push(...(previousSymbols.get(filePath) ?? []));
      reused += 1;
      continue;
    }

    const source = await readSource(filePath);
    if (source === undefined) {
      // The file vanished or is unreadable: leave it out of the index instead
      // of claiming a signature for a source we never stored.
      signatures.delete(filePath);
      continue;
    }
    files.set(filePath, source);
    symbols.push(...scanFile(source, filePath));
  }

  const indexPath = join(root, ".dev-agent", "index.json");
  await mkdir(join(root, ".dev-agent"), { recursive: true });
  const payload: IndexFile = {
    version: 1,
    files: Object.fromEntries(files),
    symbols,
    signatures: Object.fromEntries(signatures),
  };
  await writeFile(indexPath, `${JSON.stringify(payload)}\n`, "utf8");

  return {
    path: root,
    indexPath,
    files: files.size,
    symbols: symbols.length,
    reused,
    languages: countLanguages(files.keys()),
  };
}

async function collectFiles(
  dir: string,
  depth: number,
  maxDepth: number,
  signatures: Map<string, FileSignature>
): Promise<void> {
  if (depth > maxDepth) {
    return;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        await collectFiles(
          join(dir, entry.name),
          depth + 1,
          maxDepth,
          signatures
        );
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const language = LANGUAGE_BY_EXTENSION[extname(entry.name)];
    if (!language) {
      continue;
    }

    const filePath = join(dir, entry.name);
    try {
      const info = await stat(filePath);
      signatures.set(filePath, { mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      // Skip unreadable files instead of failing the whole scan.
    }
  }
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
async function readPersistedIndex(root: string): Promise<PersistedIndex | undefined> {
  try {
    const raw = await readFile(join(root, ".dev-agent", "index.json"), "utf8");
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
        signatures[filePath] = { mtimeMs: value.mtimeMs, size: value.size };
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

async function readSource(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
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
    Number.isFinite(value.size)
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
