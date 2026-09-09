import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Tool, ToolExecutionContext } from "./index.js";

interface FilesystemInput {
  readonly action: "read" | "write" | "list" | "stat" | "mkdir";
  readonly path: string;
  readonly content?: string;
}

export class FilesystemTool implements Tool {
  readonly name = "filesystem" as const;
  readonly description = "Read, write, list, stat, or create directories on the local filesystem.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "write", "list", "stat", "mkdir"] },
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["action", "path"],
  };

  async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
    const params = parseFilesystemInput(input);
    const cwd = context?.workingDirectory ?? process.cwd();
    const target = resolve(cwd, params.path);

    switch (params.action) {
      case "read":
        return { content: await readFile(target, "utf8") };
      case "write":
        await writeFile(target, params.content ?? "", "utf8");
        return { ok: true, path: target };
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
    action !== "list" &&
    action !== "stat" &&
    action !== "mkdir"
  ) {
    throw new Error("filesystem action must be one of: read, write, list, stat, mkdir");
  }
  if (typeof record.path !== "string" || record.path.length === 0) {
    throw new Error("filesystem path must be a non-empty string");
  }
  return {
    action,
    path: record.path,
    content: typeof record.content === "string" ? record.content : undefined,
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}
