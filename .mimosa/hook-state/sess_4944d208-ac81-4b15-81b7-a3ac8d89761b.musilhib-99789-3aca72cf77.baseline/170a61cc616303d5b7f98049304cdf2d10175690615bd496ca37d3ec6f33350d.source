import { opendir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  createProjectIgnoreMatcher,
  InMemoryCodeIndex,
  TypeScriptReferenceIndex,
  type CodeSymbol,
  type ProjectIgnoreMatcher,
  type SymbolKind,
} from "@dev-agent/code-intelligence";

import type { Tool, ToolExecutionContext } from "./index.js";
import { resolveWorkspacePath } from "./workspace-path.js";

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
const defaultMaxDepth = 8;
const defaultLimit = 50;
const maxScanFileBytes = 16 * 1024 * 1024;
const maxPersistedIndexBytes = 16 * 1024 * 1024; // 16 MiB
const defaultMaxScanFiles = 100_000;
const defaultMaxScanSourceBytes = 256 * 1024 * 1024;
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
  readonly ctimeMs?: number;
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

export const CODE_SEARCH_SCAN_LIMIT_ERROR_CODE =
  "CODE_SEARCH_SCAN_LIMIT_EXCEEDED" as const;

export type CodeSearchScanLimitDimension = "files" | "bytes";

export class CodeSearchScanLimitError extends Error {
  readonly code = CODE_SEARCH_SCAN_LIMIT_ERROR_CODE;
  readonly dimension: CodeSearchScanLimitDimension;
  readonly limit: number;
  readonly observed: number;

  constructor(
    dimension: CodeSearchScanLimitDimension,
    limit: number,
    observed: number
  ) {
    super(`code-search scan ${dimension} limit exceeded`);
    this.name = "CodeSearchScanLimitError";
    this.dimension = dimension;
    this.limit = limit;
    this.observed = observed;
  }
}

export interface CodeSearchToolOptions {
  /** Internal test seam; tool input never exposes scan-budget controls. */
  readonly maxFiles?: number;
  /** Internal test seam; tool input never exposes scan-budget controls. */
  readonly maxSourceBytes?: number;
}

interface ScanBudget {
  readonly maxFiles: number;
  readonly maxSourceBytes: number;
  files: number;
  sourceBytes: number;
}

export class CodeSearchTool implements Tool {
  readonly name = "code-search" as const;
  readonly description =
    "Scan TypeScript/JavaScript/Python/Rust source files. The path defaults to the project working directory. Search and query-based definition lookup use the shared symbol index; TypeScript/JavaScript use position-based reference and definition lookup, while Python uses conservative lexical lookup by position or query.";
  readonly metadata = {
    risk: "read-only" as const,
    confirmation: "never" as const,
    resultFormat: "json" as const,
    supportsProgress: false,
  };
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      mode: {
        enum: [...modes],
        type: "string",
        description:
          "Use search for symbol lookup, definition with a query or file position, or references with a file position; Python references also accept a symbol query. Query and line/column inputs are mutually exclusive.",
      },
      query: {
        type: "string",
        description:
          "Required for search mode and query-based definition lookup; the symbol name or search text. Do not combine it with line or column.",
      },
      path: {
        type: "string",
        description:
          "Directory to scan, or a source file to scope search/query-based definition; defaults to the project working directory. Use file for position-based references and definition.",
      },
      maxDepth: {
        type: "integer",
        minimum: 0,
        description: "Maximum directory depth for the scan.",
      },
      kind: {
        enum: [...symbolKinds],
        type: "string",
        description: "Optional symbol kind filter for search mode.",
      },
      limit: {
        type: "integer",
        minimum: 0,
        description: "Maximum number of search results.",
      },
      file: {
        type: "string",
        description:
          "Required for position-based references and definition; a TypeScript/JavaScript/Python source file. Use this field instead of path for the source file.",
      },
      line: {
        type: "integer",
        minimum: 1,
        description: "Required for position-based references and definition; 1-based source line.",
      },
      column: {
        type: "integer",
        minimum: 1,
        description: "Required for position-based references and definition; 1-based source column.",
      },
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

  private readonly maxScanFiles: number;
  private readonly maxScanSourceBytes: number;

  constructor(options: CodeSearchToolOptions = {}) {
    this.maxScanFiles = normalizeScanLimit(
      options.maxFiles,
      defaultMaxScanFiles,
      "maxFiles"
    );
    this.maxScanSourceBytes = normalizeScanLimit(
      options.maxSourceBytes,
      defaultMaxScanSourceBytes,
      "maxSourceBytes"
    );
  }

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
    const hasPositionInput = record.line !== undefined || record.column !== undefined;
    if (
      (mode === "references" || mode === "definition") &&
      record.query !== undefined &&
      hasPositionInput
    ) {
      throw new Error(
        `code-search ${mode} mode cannot combine query with line or column; omit query for position lookup or omit line/column for query lookup`
      );
    }
    const pathValue = typeof record.path === "string" && record.path.length > 0 ? record.path : ".";
    const workingDirectory = context?.workingDirectory ?? process.cwd();
    const enforceWorkingDirectory = context !== undefined;
    let scanPath = pathValue;
    let fileFromPath: string | undefined;
    let fileScope: string | undefined;
    if (pathValue !== ".") {
      const pathCandidate = await resolveWorkspacePath(
        workingDirectory,
        pathValue,
        enforceWorkingDirectory
      );
      if (await isRegularFile(pathCandidate)) {
        scanPath = dirname(pathCandidate);
        if (
          mode === "search" ||
          (mode === "definition" && record.line === undefined && record.column === undefined)
        ) {
          fileScope = pathCandidate;
        } else if (record.file === undefined) {
          fileFromPath = pathCandidate;
        }
      }
    }
    const root = await resolveWorkspacePath(
      workingDirectory,
      scanPath,
      enforceWorkingDirectory
    );
    const maxDepth = record.maxDepth === undefined
      ? defaultMaxDepth
      : parsePositiveInt(record.maxDepth, "maxDepth");
    const scan = await this.loadScan(root, maxDepth);

    if (mode === "search") {
      const query = requireString(record.query, "query");
      const limit = record.limit === undefined ? defaultLimit : parsePositiveInt(record.limit, "limit");
      const kind = record.kind === undefined ? undefined : parseSymbolKind(record.kind);
      const matches = scan.index.searchSymbols({
        query,
        limit,
        kinds: kind ? [kind] : undefined,
      });
      const scopedMatches = fileScope
        ? matches.filter(({ symbol }) => symbol.filePath === fileScope)
        : matches;
      return {
        mode,
        query,
        path: fileScope ?? root,
        count: scopedMatches.length,
        results: scopedMatches.map(({ symbol, score, reasons }) => ({
          ...symbol,
          score,
          reasons,
        })),
      };
    }

    if (
      mode === "definition" &&
      record.line === undefined &&
      record.column === undefined &&
      record.query !== undefined
    ) {
      const query = requireString(record.query, "query");
      const limit = record.limit === undefined ? defaultLimit : parsePositiveInt(record.limit, "limit");
      const kind = record.kind === undefined ? undefined : parseSymbolKind(record.kind);
      const matches = scan.index.searchSymbols({
        query,
        limit,
        kinds: kind ? [kind] : undefined,
      });
      const scopedMatches = fileScope
        ? matches.filter(({ symbol }) => symbol.filePath === fileScope)
        : matches;
      return {
        mode,
        query,
        path: fileScope ?? root,
        count: scopedMatches.length,
        definition: scopedMatches[0]?.symbol,
        results: scopedMatches.map(({ symbol, score, reasons }) => ({
          ...symbol,
          score,
          reasons,
        })),
      };
    }

    if (
      mode === "references" &&
      record.query !== undefined &&
      record.line === undefined &&
      record.column === undefined
    ) {
      const query = requireString(record.query, "query");
      const queryFileInput = record.file === undefined ? fileFromPath : record.file;
      let queryFile: string | undefined;
      if (queryFileInput !== undefined) {
        queryFile = await resolveWorkspacePath(
          workingDirectory,
          resolve(root, requireString(queryFileInput, "file")),
          enforceWorkingDirectory
        );
        assertSourceAvailable(scan.sources, queryFile);
        if (extname(queryFile) !== ".py") {
          throw new Error(
            `code-search references query lookup only supports Python source files; use file and line for TypeScript/JavaScript`
          );
        }
      }
      const sources = queryFile
        ? new Map([[queryFile, scan.sources.get(queryFile)!]])
        : scan.sources;
      const limit = record.limit === undefined ? defaultLimit : parsePositiveInt(record.limit, "limit");
      const references = findPythonReferences(sources, query).slice(0, limit);
      return {
        mode,
        query,
        path: queryFile ?? root,
        resolution: "lexical",
        approximate: true,
        count: references.length,
        references,
      };
    }

    // The scan indexes absolute paths, so a relative `file` must be resolved
    // against the scanned root (the working directory by default).
    const fileInput = record.file === undefined ? fileFromPath : record.file;
    if (fileInput === undefined) {
      throw new Error(
        `code-search ${mode} mode requires file and line; use search mode or definition with query for query-only lookup`
      );
    }
    const file = await resolveWorkspacePath(
      workingDirectory,
      resolve(root, requireString(fileInput, "file")),
      enforceWorkingDirectory
    );
    const line = parseLineOrColumn(record.line, "line");
    const column = extname(file) === ".py" && record.column === 0
      ? 1
      : record.column === undefined
        ? 1
        : parseLineOrColumn(record.column, "column");
    assertPositionWithinSource(scan.sources.get(file), file, line, column);
    if (extname(file) === ".py") {
      const source = scan.sources.get(file);
      const symbol = pythonIdentifierAtPosition(source, line, column, file);
      if (mode === "references") {
        const references = findPythonReferences(scan.sources, symbol);
        return {
          mode,
          file,
          line,
          column,
          symbol,
          resolution: "lexical",
          approximate: true,
          count: references.length,
          references,
        };
      }

      const matches = scan.index.searchSymbols({
        query: symbol,
        limit: record.limit === undefined ? defaultLimit : parsePositiveInt(record.limit, "limit"),
      });
      const definition =
        matches.find(({ symbol: match }) => match.name === symbol && match.filePath === file)?.symbol ??
        matches.find(({ symbol: match }) => match.name === symbol)?.symbol;
      return {
        mode,
        file,
        line,
        column,
        symbol,
        resolution: "index",
        definition,
        results: matches.map(({ symbol: match, score, reasons }) => ({
          ...match,
          score,
          reasons,
        })),
      };
    }

    if (!typeScriptExtensions.has(extname(file))) {
      throw new Error(
        `code-search ${mode} mode only supports TypeScript/JavaScript/Python source files; use search mode for ${file}`
      );
    }
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
   * the files whose mtime, size, or ctime changed since the previous call.
   * Legacy entries without ctime are re-read because mtime and size alone
   * cannot prove that a file is unchanged. Deleted files are dropped from
   * both the index and the cached sources.
   */
  private async loadScan(root: string, maxDepth: number): Promise<CachedScan> {
    const cacheKey = `${root}\u0000${maxDepth}`;
    const ignore = await createProjectIgnoreMatcher(root);
    const signatures = await collectSignatures(
      root,
      0,
      maxDepth,
      ignore,
      root,
      {
        maxFiles: this.maxScanFiles,
        maxSourceBytes: this.maxScanSourceBytes,
        files: 0,
        sourceBytes: 0,
      }
    );
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
        await this.persistScan(root, scan, maxDepth, ignore);
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
      if (
        previous &&
        previous.ctimeMs !== undefined &&
        signature.ctimeMs !== undefined &&
        previous.mtimeMs === signature.mtimeMs &&
        previous.size === signature.size &&
        previous.ctimeMs === signature.ctimeMs
      ) {
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
      await this.persistScan(root, cached, maxDepth, ignore);
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
    maxDepth: number,
    ignore: ProjectIgnoreMatcher
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
          if (!isWithinDepth(root, filePath, maxDepth) && !ignore.isIgnored(relative(root, filePath))) {
            files.set(filePath, source);
          }
        }
        for (const [filePath, signature] of existing.signatures) {
          if (!isWithinDepth(root, filePath, maxDepth) && !ignore.isIgnored(relative(root, filePath))) {
            const normalized = await normalizePreservedSignature(filePath, signature);
            if (normalized === undefined) {
              continue;
            }
            signatures.set(filePath, normalized);
          }
        }
        for (const symbol of existing.index.listSymbols()) {
          if (!isWithinDepth(root, symbol.filePath, maxDepth) && !ignore.isIgnored(relative(root, symbol.filePath))) {
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
      const contents = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
      if (contents.byteLength > maxPersistedIndexBytes) {
        return;
      }
      await writeFile(indexPath, contents);
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

async function normalizePreservedSignature(
  filePath: string,
  signature: FileSignature
): Promise<FileSignature | undefined> {
  if (signature.ctimeMs !== undefined) {
    return signature;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return undefined;
    }
    return {
      mtimeMs: info.mtimeMs,
      size: info.size,
      ctimeMs: info.ctimeMs,
    };
  } catch {
    return undefined;
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`code-search ${field} must be a non-empty string`);
  }
  return value;
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function parsePositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`code-search ${field} must be a non-negative integer`);
  }
  return value;
}

/** Line and column numbers are 1-based; 0 would crash the TS language service. */
function parseLineOrColumn(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`code-search ${field} must be a positive integer`);
  }
  return value;
}

/** The TypeScript language service throws a debug failure on a bad position. */
function assertPositionWithinSource(
  source: string | undefined,
  file: string,
  line: number,
  column: number
): void {
  if (source === undefined) {
    return;
  }
  const lines = source.split("\n");
  if (line > lines.length) {
    throw new Error(
      `code-search line ${line} is beyond the end of ${file} (${lines.length} lines)`
    );
  }
  const lineText = lines[line - 1] ?? "";
  if (column > lineText.length + 1) {
    throw new Error(
      `code-search column ${column} is beyond the end of line ${line} in ${file}`
    );
  }
}

interface PythonToken {
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly lineText: string;
}

/**
 * Python does not have a language service in this package yet. Keep the
 * fallback deliberately conservative and label its results as lexical so
 * callers do not mistake token matches for semantic references.
 */
function findPythonReferences(
  sources: ReadonlyMap<string, string>,
  symbol: string
): Array<{
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly isWriteAccess: boolean;
  readonly snippet: string;
}> {
  const references: Array<{
    readonly filePath: string;
    readonly line: number;
    readonly column: number;
    readonly isWriteAccess: boolean;
    readonly snippet: string;
  }> = [];

  for (const [filePath, source] of sources) {
    if (extname(filePath) !== ".py") {
      continue;
    }
    for (const token of scanPythonTokens(source)) {
      if (token.name !== symbol) {
        continue;
      }
      references.push({
        filePath,
        line: token.line,
        column: token.column,
        isWriteAccess: isPythonWriteAccess(token, symbol),
        snippet: compactSnippet(token.lineText),
      });
    }
  }

  return references;
}

function pythonIdentifierAtPosition(
  source: string | undefined,
  line: number,
  column: number,
  file: string
): string {
  if (source === undefined) {
    throw new Error(`code-search could not read source file ${file}`);
  }
  const lineText = source.split("\n")[line - 1] ?? "";
  const target = column - 1;
  const tokens = scanPythonTokens(lineText);
  const declaration = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(lineText);
  if (declaration?.[1] && (column <= 1 || target < lineText.search(/\S/))) {
    return declaration[1];
  }
  const match = tokens.find(
    (candidate) => target >= candidate.column - 1 && target < candidate.column - 1 + candidate.name.length
  );
  if (match) {
    return match.name;
  }
  if (column <= 1 && tokens[0]) {
    return tokens[0].name;
  }
  throw new Error(
    `code-search could not identify a Python symbol at ${file}:${line}:${column}; use search mode with a query`
  );
}

function assertSourceAvailable(
  sources: ReadonlyMap<string, string>,
  file: string
): void {
  if (!sources.has(file)) {
    throw new Error(`code-search could not read source file ${file}`);
  }
}

function scanPythonTokens(source: string): PythonToken[] {
  const tokens: PythonToken[] = [];
  const lines = source.split("\n");
  let tripleQuote: "'" | '"' | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex] ?? "";
    let index = 0;

    while (index < lineText.length) {
      if (tripleQuote !== undefined) {
        const end = lineText.indexOf(tripleQuote.repeat(3), index);
        if (end < 0) {
          break;
        }
        index = end + 3;
        tripleQuote = undefined;
        continue;
      }

      const character = lineText[index] ?? "";
      if (character === "#") {
        break;
      }
      if (character === "'" || character === '"') {
        if (lineText.slice(index, index + 3) === character.repeat(3)) {
          tripleQuote = character;
          index += 3;
          continue;
        }
        index = skipPythonString(lineText, index, character);
        continue;
      }
      if (isIdentifierStart(character)) {
        const start = index;
        index += 1;
        while (index < lineText.length && isIdentifierPart(lineText[index] ?? "")) {
          index += 1;
        }
        tokens.push({
          name: lineText.slice(start, index),
          line: lineIndex + 1,
          column: start + 1,
          lineText,
        });
        continue;
      }
      index += 1;
    }
  }

  return tokens;
}

function skipPythonString(line: string, start: number, quote: "'" | '"'): number {
  let escaped = false;
  for (let index = start + 1; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === quote) {
      return index + 1;
    }
  }
  return line.length;
}

function isIdentifierStart(value: string): boolean {
  return /^[A-Za-z_]$/.test(value);
}

function isIdentifierPart(value: string): boolean {
  return /^[A-Za-z0-9_]$/.test(value);
}

function isPythonWriteAccess(token: PythonToken, symbol: string): boolean {
  const trimmed = token.lineText.trimStart();
  return (
    new RegExp(`^(?:async\\s+)?(?:def|class)\\s+${escapeRegExp(symbol)}\\b`).test(trimmed) ||
    new RegExp(`\\b${escapeRegExp(symbol)}\\s*=(?!=)`).test(token.lineText)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactSnippet(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
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
  maxDepth: number,
  ignore: ProjectIgnoreMatcher,
  root: string = dir,
  budget: ScanBudget
): Promise<Map<string, FileSignature>> {
  const signatures = new Map<string, FileSignature>();
  if (depth > maxDepth) {
    return signatures;
  }

  const directory = await opendir(dir);
  try {
    for await (const entry of directory) {
      const entryPath = join(dir, entry.name);
      const relativePath = relative(root, entryPath);
      if (
        skippedDirectories.has(entry.name) ||
        ignore.isIgnored(relativePath, entry.isDirectory())
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        const nested = await collectSignatures(
          entryPath,
          depth + 1,
          maxDepth,
          ignore,
          root,
          budget
        );
        for (const [filePath, signature] of nested) {
          signatures.set(filePath, signature);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      if (!supportedExtensions.has(extname(entry.name))) {
        continue;
      }

      const filePath = entryPath;
      let info;
      try {
        info = await stat(filePath);
      } catch {
        // Skip files that disappear or cannot be inspected mid-scan.
        continue;
      }
      if (!info.isFile()) {
        continue;
      }
      if (info.size > maxScanFileBytes) {
        continue;
      }
      const observedFiles = budget.files + 1;
      if (observedFiles > budget.maxFiles) {
        throw new CodeSearchScanLimitError(
          "files",
          budget.maxFiles,
          observedFiles
        );
      }
      const observedSourceBytes = budget.sourceBytes + info.size;
      if (observedSourceBytes > budget.maxSourceBytes) {
        throw new CodeSearchScanLimitError(
          "bytes",
          budget.maxSourceBytes,
          observedSourceBytes
        );
      }
      budget.files = observedFiles;
      budget.sourceBytes = observedSourceBytes;
      signatures.set(filePath, {
        mtimeMs: info.mtimeMs,
        size: info.size,
        ctimeMs: info.ctimeMs,
      });
    }
  } finally {
    await directory.close().catch(() => undefined);
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

function normalizeScanLimit(
  value: number | undefined,
  fallback: number,
  field: string
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`code-search ${field} must be a non-negative integer`);
  }
  return value;
}

/**
 * Loads the index written by `dev-agent --index`. Anything unexpected makes the
 * caller fall back to a full scan instead of failing the search.
 */
async function readPersistedScan(root: string): Promise<CachedScan | undefined> {
  try {
    const indexPath = join(root, ".dev-agent", "index.json");
    const info = await stat(indexPath);
    if (info.size > maxPersistedIndexBytes) {
      return undefined;
    }
    const raw = await readFile(indexPath, "utf8");
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
          Number.isFinite(value.mtimeMs) &&
          typeof value.size === "number" &&
          Number.isFinite(value.size) &&
          (value.ctimeMs === undefined ||
            (typeof value.ctimeMs === "number" && Number.isFinite(value.ctimeMs)))
        ) {
          signatures.set(filePath, {
            mtimeMs: value.mtimeMs,
            size: value.size,
            ...(value.ctimeMs === undefined ? {} : { ctimeMs: value.ctimeMs }),
          });
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
