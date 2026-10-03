import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { scanTypeScriptSymbols, type CodeSymbol, type SymbolKind } from "./index.js";

export interface JsonFileCodeIndexOptions {
  readonly filePath: string;
}

interface IndexFile {
  readonly version: 1;
  readonly files: Record<string, string>;
  readonly symbols: CodeSymbol[];
}

export class JsonFileCodeIndex {
  private readonly filePath: string;
  private readonly fileContents = new Map<string, string>();
  private symbols: CodeSymbol[] = [];

  constructor(options: JsonFileCodeIndexOptions) {
    this.filePath = options.filePath;
  }

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid index file: ${this.filePath}`);
    }
    if (!isIndexFile(parsed)) {
      throw new Error(`Invalid index file: ${this.filePath}`);
    }
    this.fileContents.clear();
    for (const [key, value] of Object.entries(parsed.files)) {
      this.fileContents.set(key, value);
    }
    this.symbols = [...parsed.symbols];
  }

  async addSource(source: string, filePath: string): Promise<void> {
    this.fileContents.set(filePath, source);
    for (const symbol of scanTypeScriptSymbols(source, filePath)) {
      this.symbols.push(symbol);
    }
  }

  async removeFile(filePath: string): Promise<void> {
    this.fileContents.delete(filePath);
    this.symbols = this.symbols.filter((symbol) => symbol.filePath !== filePath);
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const files: Record<string, string> = {};
    for (const [key, value] of this.fileContents) {
      files[key] = value;
    }
    const payload: IndexFile = { version: 1, files, symbols: this.symbols };
    await writeFile(this.filePath, `${JSON.stringify(payload)}\n`, "utf8");
  }

  searchByName(query: string, limit = 20): CodeSymbol[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return this.symbols
      .filter((symbol) => symbol.name.toLowerCase().includes(normalized))
      .slice(0, limit);
  }

  getSymbolCount(): number {
    return this.symbols.length;
  }

  getFileCount(): number {
    return this.fileContents.size;
  }

  getSymbols(): readonly CodeSymbol[] {
    return [...this.symbols];
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isIndexFile(value: unknown): value is IndexFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.files === "object" &&
    candidate.files !== null &&
    Array.isArray(candidate.symbols)
  );
}
