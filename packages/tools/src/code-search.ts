import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  InMemoryCodeIndex,
  TypeScriptReferenceIndex,
  type CodeSymbol,
  type SymbolKind,
} from "@dev-agent/code-intelligence";

import type { Tool, ToolExecutionContext } from "./index.js";

type Mode = "search" | "references" | "definition";

const typeScriptExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/** Matches the scope of `dev-agent --index`, so both can share one file. */
const supportedExtensions = new Set([...typeScriptExtensions, ".py", ".rs"]);

const skippedDirectories = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  ".cache",
  ".dev-agent",
]);
const defaultMaxDepth = 8;
const defaultLimit = 50;
const modes: readonly Mode[] = ["search", "references", "definition"];
const symbolKinds = new Set<SymbolKind>([
  "function",
  "class",
  "variable",
  "interface",
  "type",
  "enum",
  "method",
  "property",
]);

interface FileSignature {
  readonly mtimeMs: number;
  readonly size: number;
}

interface CachedScan {
  readonly index: InMemoryCodeIndex;
  readonly signatures: Map<string, FileSignature>;
  readonly sources: Map<string, string>;
  /** True when this cache entry started from `<root>/.dev-agent/index.json`. */
  readonly fromDisk: boolean;
}

/** Read-only cache counters for diagnostics and tests. */
export interface CodeSearchCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly rescanned: number;
  /** Times a scan started from `<root>/.dev-agent/index.json`. */
  readonly loadedFromDisk: number;
  /** Times a changed scan was written back to that file. */
  readonly persisted: number;
}

export class CodeSearchTool implements Tool {
  readonly name = "code-search" as const;
  readonly description =
    "Scan TypeScript/JavaScript/Python/Rust source files. Supports symbol search by name; reference lookup and go-to-definition cover TypeScript/JavaScript.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      mode: { enum: [...modes], type: "string" },
      query: { type: "string" },
      path: { type: "string" },
      maxDepth: { type: "integer", minimum: 0 },
      kind: {
        enum: [...symbolKinds],
        type: "string",
      },
      limit: { type: "integer", minimum: 0 },
      file: { type: "string" },
      line: { type: "integer", minimum: 1 },
      column: { type: "integer", minimum: 1 },
    },
    required: [],
  };

  private readonly cache = new Map<string, CachedScan>();
  private readonly cacheStats = {
    hits: 0,
    misses: 0,
    rescanned: 0,
    loadedFromDisk: 0,
    persisted: 0,
  };

  /**
   * Returns how often a scan was served from cache, built from scratch, or
   * partially re-read because files changed.
   */
  getCacheStats(): CodeSearchCacheStats {
    return { ...this.cacheStats };
  }

  async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
    const record = asRecord(input);
    const mode = parseMode(record.mode);
    const pathValue = typeof record.path === "string" && record.path.length > 0 ? record.path : ".";
    const root = resolve(context?.workingDirectory ?? process.cwd(), pathValue);
    const maxDepth = record.maxDepth === undefined
      ? defaultMaxDepth
      : parsePositiveInt(record.maxDepth, "maxDepth");

    if (mode === "search") {
      const query = requireString(record.query, "query");
      const limit = record.limit === undefined ? defaultLimit : parsePositiveInt(record.limit, "limit");
      const kind = record.kind === undefined ? undefined : parseSymbolKind(record.kind);
      const scan = await this.loadScan(root, maxDepth);
      const matches = scan.index.searchSymbols({
        query,
        limit,
        kinds: kind ? [kind] : undefined,
      });
      return {
        mode,
        query,
        path: root,
        count: matches.length,
        results: matches.map(({ symbol, score, reasons }) => ({
          ...symbol,
          score,
          reasons,
        })),
      };
    }

    // The scan indexes absolute paths, so a relative `file` must be resolved
    // against the scanned root (the working directory by default).
    const file = resolve(root, requireString(record.file, "file"));
    const line = parsePositiveInt(record.line, "line");
    const column = record.column === undefined ? 1 : parsePositiveInt(record.column, "column");
    const scan = await this.loadScan(root, maxDepth);
    const referenceIndex = new TypeScriptReferenceIndex({
      files: typeScriptSources(scan.sources),
    });

    if (mode === "references") {
      const references = referenceIndex.findReferences(file, line, column);
      return { mode, file, line, column, count: references.length, references };
    }

    const definition = referenceIndex.findDefinition(file, line, column);
    return { mode, file, line, column, definition };
  }

  /**
   * Returns the symbol index and file sources for a scan root, re-reading only
   * the files whose size or mtime changed since the previous call. Deleted
   * files are dropped from both the index and the cached sources.
   */
  private async loadScan(root: string, maxDepth: number): Promise<CachedScan> {
    const cacheKey = `${root}\u0000${maxDepth}`;
    const signatures = await collectSignatures(root, 0, maxDepth);
    let cached = this.cache.get(cacheKey);
    let replaceBrokenIndex = false;

    if (!cached) {
      const persisted = await readPersistedScan(root);
      if (persisted) {
        this.cacheStats.loadedFromDisk += 1;
        cached = restrictToDepth(root, persisted, maxDepth);
        this.cache.set(cacheKey, cached);
      } else if (await isFile(join(root, ".dev-agent", "index.json"))) {
        // The index exists but could not be used; the full scan below replaces
        // it, so the next process starts from a valid cache instead of
        // scanning everything again.
        replaceBrokenIndex = true;
      }
    }

    if (!cached) {
      const index = new InMemoryCodeIndex();
      const sources = new Map<string, string>();
      for (const filePath of signatures.keys()) {
        const source = await readSource(filePath);
        if (source === undefined) {
          continue;
        }
        sources.set(filePath, source);
        index.addSource(source, filePath);
      }
      this.cacheStats.misses += 1;
      // A repaired index is treated as disk-backed so later changes are
      // written back too.
      const scan: CachedScan = { index, signatures, sources, fromDisk: replaceBrokenIndex };
      this.cache.set(cacheKey, scan);
      if (replaceBrokenIndex) {
        await this.persistScan(root, scan, maxDepth);
      }
      return scan;
    }

    this.cacheStats.hits += 1;
    let changed = 0;

    // Anything the cache knows about but the disk no longer has is dropped;
    // that includes files that only appear in the persisted index.
    const knownFiles = new Set([...cached.signatures.keys(), ...cached.sources.keys()]);
    for (const filePath of knownFiles) {
      if (!signatures.has(filePath)) {
        cached.index.removeFile(filePath);
        cached.signatures.delete(filePath);
        cached.sources.delete(filePath);
        this.cacheStats.rescanned += 1;
        changed += 1;
      }
    }

    for (const [filePath, signature] of signatures) {
      const previous = cached.signatures.get(filePath);
      if (previous && previous.mtimeMs === signature.mtimeMs && previous.size === signature.size) {
        continue;
      }
      const source = await readSource(filePath);
      if (source === undefined) {
        continue;
      }
      cached.index.removeFile(filePath);
      cached.index.addSource(source, filePath);
      cached.sources.set(filePath, source);
      cached.signatures.set(filePath, signature);
      this.cacheStats.rescanned += 1;
      changed += 1;
    }

    if (changed > 0 && cached.fromDisk) {
      await this.persistScan(root, cached, maxDepth);
    }

    return cached;
  }

  /**
   * Refreshes the index file this scan started from, so the next process does
   * not have to re-read the same changed files. Only an existing index is
   * touched, and a failure never fails the search.
   */
  private async persistScan(
    root: string,
    scan: CachedScan,
    maxDepth: number
  ): Promise<void> {
    const indexPath = join(root, ".dev-agent", "index.json");
    try {
      const info = await stat(indexPath);
      if (!info.isFile()) {
        return;
      }
      // Keep entries deeper than this scan: a narrow `maxDepth` must not
      // delete what a wider scan indexed.
      const files = new Map<string, string>();
      const symbols: CodeSymbol[] = [];
      const signatures = new Map<string, FileSignature>();
      const existing = await readPersistedScan(root);
      if (existing) {
        for (const [filePath, source] of existing.sources) {
          if (!isWithinDepth(root, filePath, maxDepth)) {
            files.set(filePath, source);
          }
        }
        for (const [filePath, signature] of existing.signatures) {
          if (!isWithinDepth(root, filePath, maxDepth)) {
            signatures.set(filePath, signature);
          }
        }
        for (const symbol of existing.index.listSymbols()) {
          if (!isWithinDepth(root, symbol.filePath, maxDepth)) {
            symbols.push(symbol);
          }
        }
      }

      for (const [filePath, source] of scan.sources) {
        files.set(filePath, source);
      }
      for (const [filePath, signature] of scan.signatures) {
        signatures.set(filePath, signature);
      }
      symbols.push(...scan.index.listSymbols());

      const payload = {
        version: 1,
        files: Object.fromEntries(files),
        symbols,
        signatures: Object.fromEntries(signatures),
      };
      await writeFile(indexPath, `${JSON.stringify(payload)}\n`, "utf8");
      this.cacheStats.persisted += 1;
    } catch {
      // Refreshing the on-disk cache is best-effort; the search result stands.
    }
  }
}

function parseMode(value: unknown): Mode {
  if (value === undefined) {
    return "search";
  }
  if (typeof value !== "string" || !modes.includes(value as Mode)) {
    throw new Error(`code-search mode must be one of: ${modes.join(", ")}`);
  }
  return value as Mode;
}

/** The TS/JS subset handed to the TypeScript language service. */
function typeScriptSources(sources: ReadonlyMap<string, string>): Map<string, string> {
  const files = new Map<string, string>();
  for (const [filePath, source] of sources) {
    if (typeScriptExtensions.has(extname(filePath))) {
      files.set(filePath, source);
    }
  }
  return files;
}

/** Whether `filePath` sits at or above `maxDepth` below `root`. */
function isWithinDepth(root: string, filePath: string, maxDepth: number): boolean {
  const relativePath = relative(root, filePath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return false;
  }
  return relativePath.split(sep).length - 1 <= maxDepth;
}

/**
 * Drops everything deeper than the requested scan depth, so a narrow scan
 * neither returns stale deep symbols nor mistakes them for deleted files.
 */
function restrictToDepth(root: string, scan: CachedScan, maxDepth: number): CachedScan {
  const sources = new Map<string, string>();
  for (const [filePath, source] of scan.sources) {
    if (isWithinDepth(root, filePath, maxDepth)) {
      sources.set(filePath, source);
    }
  }

  const signatures = new Map<string, FileSignature>();
  for (const [filePath, signature] of scan.signatures) {
    if (isWithinDepth(root, filePath, maxDepth)) {
      signatures.set(filePath, signature);
    }
  }

  const index = new InMemoryCodeIndex();
  for (const symbol of scan.index.listSymbols()) {
    if (sources.has(symbol.filePath)) {
      index.addSymbol(symbol);
    }
  }

  return { index, sources, signatures, fromDisk: scan.fromDisk };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`code-search ${field} must be a non-empty string`);
  }
  return value;
}

function parsePositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`code-search ${field} must be a non-negative integer`);
  }
  return value;
}

function parseSymbolKind(value: unknown): SymbolKind {
  if (typeof value !== "string" || !symbolKinds.has(value as SymbolKind)) {
    throw new Error("code-search kind must be a valid symbol kind");
  }
  return value as SymbolKind;
}

/**
 * Walks the scan root and records a cheap signature per file, so a later call
 * can tell which files actually changed without reading any of them.
 */
async function collectSignatures(
  dir: string,
  depth: number,
  maxDepth: number
): Promise<Map<string, FileSignature>> {
  const signatures = new Map<string, FileSignature>();
  if (depth > maxDepth) {
    return signatures;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        const nested = await collectSignatures(join(dir, entry.name), depth + 1, maxDepth);
        for (const [filePath, signature] of nested) {
          signatures.set(filePath, signature);
        }
      }
      continue;
    }

    if (!entry.isFile() || !supportedExtensions.has(extname(entry.name))) {
      continue;
    }

    const filePath = join(dir, entry.name);
    try {
      const info = await stat(filePath);
      signatures.set(filePath, { mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      // Skip files that disappear or cannot be inspected mid-scan.
    }
  }
  return signatures;
}

async function readSource(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    // Skip unreadable files instead of failing the whole project scan.
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Loads the index written by `dev-agent --index`. Anything unexpected makes the
 * caller fall back to a full scan instead of failing the search.
 */
async function readPersistedScan(root: string): Promise<CachedScan | undefined> {
  try {
    const raw = await readFile(join(root, ".dev-agent", "index.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      files?: unknown;
      symbols?: unknown;
      signatures?: unknown;
    };

    if (parsed.version !== 1 || !isRecord(parsed.files) || !Array.isArray(parsed.symbols)) {
      return undefined;
    }

    const index = new InMemoryCodeIndex();
    for (const symbol of parsed.symbols) {
      if (isCodeSymbol(symbol)) {
        index.addSymbol(symbol);
      }
    }

    const sources = new Map<string, string>();
    for (const [filePath, source] of Object.entries(parsed.files)) {
      if (typeof source === "string") {
        sources.set(filePath, source);
      }
    }

    const signatures = new Map<string, FileSignature>();
    if (isRecord(parsed.signatures)) {
      for (const [filePath, value] of Object.entries(parsed.signatures)) {
        if (
          isRecord(value) &&
          typeof value.mtimeMs === "number" &&
          typeof value.size === "number"
        ) {
          signatures.set(filePath, { mtimeMs: value.mtimeMs, size: value.size });
        }
      }
    }

    return { index, sources, signatures, fromDisk: true };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCodeSymbol(value: unknown): value is CodeSymbol {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.name === "string" &&
    typeof value.kind === "string" &&
    typeof value.filePath === "string" &&
    typeof value.line === "number"
  );
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}
