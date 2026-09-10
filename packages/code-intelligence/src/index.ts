import { scanTypeScriptSymbols } from "./scanner.js";
import { scanPythonSymbols } from "./python-scanner.js";
import { scanRustSymbols } from "./rust-scanner.js";

export function scanFile(source: string, filePath: string): CodeSymbol[] {
  if (filePath.endsWith(".py")) {
    return scanPythonSymbols(source, filePath);
  }
  if (filePath.endsWith(".rs")) {
    return scanRustSymbols(source, filePath);
  }
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".js") || filePath.endsWith(".jsx") || filePath.endsWith(".mts") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return scanTypeScriptSymbols(source, filePath);
  }
  return [];
}

export type SymbolKind =
  | "function"
  | "class"
  | "variable"
  | "interface"
  | "type"
  | "enum"
  | "method"
  | "property";

export interface CodeSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly filePath: string;
  readonly line: number;
  readonly column?: number;
  readonly containerName?: string;
  readonly signature?: string;
}

export interface CodeQueryOptions {
  readonly query: string;
  readonly limit?: number;
  readonly kinds?: readonly SymbolKind[];
}

export interface RankedSymbolMatch {
  readonly symbol: CodeSymbol;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface CodeIndex {
  addSymbol(symbol: CodeSymbol): void;
  addSource(source: string, filePath: string): void;
  removeFile(filePath: string): boolean;
  search(query: string | CodeQueryOptions): CodeSymbol[];
  searchSymbols(query: CodeQueryOptions): RankedSymbolMatch[];
}

export class InMemoryCodeIndex implements CodeIndex {
  private readonly symbols = new Map<string, CodeSymbol[]>();

  addSymbol(symbol: CodeSymbol): void {
    const current = this.symbols.get(symbol.filePath) ?? [];
    current.push(symbol);
    this.symbols.set(symbol.filePath, current);
  }

  addSource(source: string, filePath: string): void {
    for (const symbol of scanFile(source, filePath)) {
      this.addSymbol(symbol);
    }
  }

  /**
   * Drops every symbol recorded for a file, e.g. after it was deleted or
   * changed on disk. Returns whether the file was indexed at all.
   */
  removeFile(filePath: string): boolean {
    return this.symbols.delete(filePath);
  }

  search(query: string | CodeQueryOptions): CodeSymbol[] {
    return this.searchSymbols(
      typeof query === "string" ? { query } : query
    ).map((match) => match.symbol);
  }

  searchSymbols(options: CodeQueryOptions): RankedSymbolMatch[] {
    const normalized = options.query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const matches: RankedSymbolMatch[] = [];

    for (const symbols of this.symbols.values()) {
      for (const symbol of symbols) {
        if (options.kinds?.length && !options.kinds.includes(symbol.kind)) {
          continue;
        }

        const ranked = scoreSymbol(symbol, normalized, options.query.trim());
        if (ranked.score > 0) {
          matches.push({
            symbol,
            ...ranked,
          });
        }
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (a.symbol.filePath !== b.symbol.filePath) {
        return a.symbol.filePath.localeCompare(b.symbol.filePath);
      }

      if (a.symbol.line !== b.symbol.line) {
        return a.symbol.line - b.symbol.line;
      }

      return a.symbol.name.localeCompare(b.symbol.name);
    });

    if (options.limit === undefined) {
      return matches;
    }

    return matches.slice(0, Math.max(0, options.limit));
  }
}

function scoreSymbol(symbol: CodeSymbol, normalizedQuery: string, originalQuery: string): Omit<RankedSymbolMatch, "symbol"> {
  const name = symbol.name.toLowerCase();
  const filePath = symbol.filePath.toLowerCase();
  const container = symbol.containerName?.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (name === normalizedQuery) {
    score += 100;
    reasons.push("name:exact");
    if (symbol.name === originalQuery) {
      score += 15;
      reasons.push("name:case-sensitive");
    }
  } else if (name.startsWith(normalizedQuery)) {
    score += 80;
    reasons.push("name:prefix");
  } else if (name.includes(normalizedQuery)) {
    score += 60;
    reasons.push("name:substring");
  }

  const tokens = tokenize(symbol.name).map((token) => token.toLowerCase());
  if (tokens.length > 1 && tokens.includes(normalizedQuery)) {
    score += 75;
    reasons.push("name:token");
  } else if (tokens.length > 1 && tokens.some((token) => token.startsWith(normalizedQuery))) {
    score += 65;
    reasons.push("name:token-prefix");
  }

  if (container?.includes(normalizedQuery)) {
    score += 25;
    reasons.push("container");
  }

  if (filePath.includes(normalizedQuery)) {
    score += 20;
    reasons.push("path");
  }

  const depth = symbol.filePath.split("/").length;
  if (depth > 8) {
    const penalty = Math.min(15, (depth - 8) * 3);
    score -= penalty;
    reasons.push(`path:depth-penalty(${penalty})`);
  }

  if (isTestFile(symbol.filePath)) {
    score = Math.round(score * 0.5);
    reasons.push("test-file:demoted");
  }

  return { score, reasons };
}

function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return /(\.test\.|\.spec\.|_test\.|_spec\.|\/tests?\/|\/__tests__\/)/.test(lower);
}

function tokenize(value: string): string[] {
  const camelSplit = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return camelSplit.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

export * from "./scanner.js";
export * from "./reference-index.js";
export * from "./json-file-index.js";
