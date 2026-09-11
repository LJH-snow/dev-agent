import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Tool, ToolExecutionContext } from "./index.js";

type FilesystemAction = "read" | "write" | "edit" | "list" | "stat" | "mkdir";

/** Reading without an explicit limit stops after this many lines. */
const DEFAULT_READ_LIMIT = 2000;

interface FilesystemInput {
  readonly action: FilesystemAction;
  readonly path: string;
  readonly content?: string;
  readonly oldText?: string;
  readonly newText?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export class FilesystemTool implements Tool {
  readonly name = "filesystem" as const;
  readonly description =
    "Read (optionally a line range), write, edit by replacing a unique snippet, list, stat, or create directories on the local filesystem.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "write", "edit", "list", "stat", "mkdir"] },
      path: { type: "string" },
      content: { type: "string" },
      oldText: { type: "string", description: "Text to replace in an edit; must match exactly once." },
      newText: { type: "string", description: "Replacement text for an edit; may be empty." },
      offset: { type: "integer", minimum: 1, description: "First line to read (1-based)." },
      limit: { type: "integer", minimum: 1, description: "Maximum lines to read." },
    },
    required: ["action", "path"],
  };

  async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
    const params = parseFilesystemInput(input);
    const cwd = context?.workingDirectory ?? process.cwd();
    const target = resolve(cwd, params.path);

    switch (params.action) {
      case "read":
        return readFileRange(target, params.offset ?? 1, params.limit ?? DEFAULT_READ_LIMIT);
      case "write":
        await writeFile(target, params.content ?? "", "utf8");
        return { ok: true, path: target };
      case "edit":
        return editFile(target, params.oldText ?? "", params.newText ?? "");
      case "list": {
        const entries = await readdir(target, { withFileTypes: true });
        return {
          path: target,
          entries: entries.map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
          })),
        };
      }
      case "stat": {
        const fileStat = await stat(target);
        return {
          path: target,
          size: fileStat.size,
          isDirectory: fileStat.isDirectory(),
          isFile: fileStat.isFile(),
        };
      }
      case "mkdir":
        await mkdir(target, { recursive: true });
        return { ok: true, path: target };
    }
  }
}

function parseFilesystemInput(input: unknown): FilesystemInput {
  const record = asRecord(input);
  const action = record.action;
  if (
    action !== "read" &&
    action !== "write" &&
    action !== "edit" &&
    action !== "list" &&
    action !== "stat" &&
    action !== "mkdir"
  ) {
    throw new Error("filesystem action must be one of: read, write, edit, list, stat, mkdir");
  }
  if (typeof record.path !== "string" || record.path.length === 0) {
    throw new Error("filesystem path must be a non-empty string");
  }
  const content = record.content;
  if (content !== undefined && typeof content !== "string") {
    throw new Error("filesystem content must be a string when provided");
  }

  const oldText = record.oldText;
  const newText = record.newText;
  if (action === "edit") {
    if (typeof oldText !== "string" || oldText.length === 0) {
      throw new Error("filesystem edit requires a non-empty oldText");
    }
    if (typeof newText !== "string") {
      throw new Error("filesystem edit requires newText (use an empty string to delete)");
    }
  }

  const offset = parseOptionalPositiveInt(record.offset, "offset");
  const limit = parseOptionalPositiveInt(record.limit, "limit");

  return {
    action,
    path: record.path,
    content,
    oldText: typeof oldText === "string" ? oldText : undefined,
    newText: typeof newText === "string" ? newText : undefined,
    offset,
    limit,
  };
}

function parseOptionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`filesystem ${field} must be a positive integer`);
  }
  return value;
}

async function readFileRange(
  path: string,
  offset: number,
  limit: number
): Promise<Record<string, unknown>> {
  const source = await readFile(path, "utf8");
  const lines = source.split("\n");
  const totalLines = lines.length;
  if (offset > totalLines) {
    return {
      path,
      content: "",
      startLine: offset,
      endLine: offset - 1,
      totalLines,
      truncated: false,
    };
  }
  const startLine = Math.min(offset, totalLines);
  const endLine = Math.min(startLine + limit - 1, totalLines);

  return {
    path,
    content: lines.slice(startLine - 1, endLine).join("\n"),
    startLine,
    endLine,
    totalLines,
    truncated: endLine < totalLines,
  };
}

/**
 * Replaces `oldText` with `newText`, but only when the snippet is unique:
 * a missing or ambiguous match is an error the model can correct.
 */
async function editFile(
  path: string,
  oldText: string,
  newText: string
): Promise<Record<string, unknown>> {
  const source = await readFile(path, "utf8");
  const first = source.indexOf(oldText);
  if (first < 0) {
    throw new Error(`filesystem edit: the search text was not found in ${path}`);
  }

  const matches = countOccurrences(source, oldText);
  if (matches > 1) {
    throw new Error(
      `filesystem edit: the search text matches ${matches} locations in ${path}; include more surrounding context to make it unique`
    );
  }

  const updated = source.slice(0, first) + newText + source.slice(first + oldText.length);
  await writeFile(path, updated, "utf8");
  return { ok: true, path, replacements: 1 };
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = source.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}
