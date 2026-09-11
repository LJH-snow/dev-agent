import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { scanFile, type CodeSymbol } from "@dev-agent/code-intelligence";

export interface IndexReport {
  readonly path: string;
  readonly indexPath: string;
  readonly files: number;
  readonly symbols: number;
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

  const files = new Map<string, string>();
  const languages: Record<string, number> = {};
  await collectFiles(root, 0, maxDepth, files, languages);

  const symbols: CodeSymbol[] = [];
  for (const [filePath, source] of files) {
    symbols.push(...scanFile(source, filePath));
  }

  const indexPath = join(root, ".dev-agent", "index.json");
  await mkdir(join(root, ".dev-agent"), { recursive: true });
  const payload: IndexFile = {
    version: 1,
    files: Object.fromEntries(files),
    symbols,
  };
  await writeFile(indexPath, `${JSON.stringify(payload)}\n`, "utf8");

  return {
    path: root,
    indexPath,
    files: files.size,
    symbols: symbols.length,
    languages,
  };
}

async function collectFiles(
  dir: string,
  depth: number,
  maxDepth: number,
  files: Map<string, string>,
  languages: Record<string, number>
): Promise<void> {
  if (depth > maxDepth) {
    return;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        await collectFiles(join(dir, entry.name), depth + 1, maxDepth, files, languages);
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
      files.set(filePath, await readFile(filePath, "utf8"));
      languages[language] = (languages[language] ?? 0) + 1;
    } catch {
      // Skip unreadable files instead of failing the whole scan.
    }
  }
}
