import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import {
  InMemoryCodeIndex,
  TypeScriptReferenceIndex,
  type CodeSymbol,
  type SymbolKind,
} from "@dev-agent/code-intelligence";

import type { Tool, ToolExecutionContext } from "./index.js";

type Mode = "search" | "references" | "definition";

const supportedExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const skippedDirectories = new Set(["node_modules", "dist", ".git", ".next", ".cache"]);
const defaultMaxDepth = 6;
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
}

/** Read-only cache counters for diagnostics and tests. */
export interface CodeSearchCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly rescanned: number;
  /** Times a scan started from `<root>/.dev-agent/index.json`. */
  readonly loadedFromDisk: number;
}

export class CodeSearchTool implements Tool {
  readonly name = "code-search" as const;
  readonly description =
    "Scan TypeScript/JavaScript source files. Supports symbol search by name, reference lookup, and go-to-definition.";
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
  private readonly cacheStats = { hits: 0, misses: 0, rescanned: 0, loadedFromDisk: 0 };

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
    const referenceIndex = new TypeScriptReferenceIndex({ files: scan.sources });

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

    if (!cached) {
      const persisted = await readPersistedScan(root);
      if (persisted) {
        this.cacheStats.loadedFromDisk += 1;
        cached = persisted;
        this.cache.set(cacheKey, persisted);
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
      const scan: CachedScan = { index, signatures, sources };
      this.cache.set(cacheKey, scan);
      return scan;
    }

    this.cacheStats.hits += 1;

    // Anything the cache knows about but the disk no longer has is dropped;
    // that includes files that only appear in the persisted index.
    const knownFiles = new Set([...cached.signatures.keys(), ...cached.sources.keys()]);
    for (const filePath of knownFiles) {
      if (!signatures.has(filePath)) {
        cached.index.removeFile(filePath);
        cached.signatures.delete(filePath);
        cached.sources.delete(filePath);
        this.cacheStats.rescanned += 1;
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
    }

    return cached;
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

    return { index, sources, signatures };
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
