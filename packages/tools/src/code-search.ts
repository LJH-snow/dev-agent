import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import {
  InMemoryCodeIndex,
  TypeScriptReferenceIndex,
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
      const index = new InMemoryCodeIndex();
      const files = await collectFiles(root, 0, maxDepth);
      for (const [filePath, source] of files) {
        index.addSource(source, filePath);
      }
      const matches = index.searchSymbols({
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
    const files = await collectFiles(root, 0, maxDepth);
    const referenceIndex = new TypeScriptReferenceIndex({ files });

    if (mode === "references") {
      const references = referenceIndex.findReferences(file, line, column);
      return { mode, file, line, column, count: references.length, references };
    }

    const definition = referenceIndex.findDefinition(file, line, column);
    return { mode, file, line, column, definition };
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

async function collectFiles(
  dir: string,
  depth: number,
  maxDepth: number
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  if (depth > maxDepth) {
    return files;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        const nested = await collectFiles(join(dir, entry.name), depth + 1, maxDepth);
        for (const [filePath, source] of nested) {
          files.set(filePath, source);
        }
      }
      continue;
    }

    if (!entry.isFile() || !supportedExtensions.has(extname(entry.name))) {
      continue;
    }

    const filePath = join(dir, entry.name);
    try {
      files.set(filePath, await readFile(filePath, "utf8"));
    } catch {
      // Skip unreadable files instead of failing the whole project scan.
    }
  }
  return files;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}
