import type { Executor } from "@dev-agent/executor";

import type { Tool, ToolExecutionContext } from "./index.js";
import { resolveWorkspacePath } from "./workspace-path.js";

interface SearchInput {
  readonly query: string;
  readonly path: string;
  readonly filesOnly?: boolean;
}

export class SearchTool implements Tool {
  readonly name = "search" as const;
  readonly description =
    "Search code and text with ripgrep. Use a short literal or symbol pattern; if there are no matches, inspect the directory or file layout instead of repeating near-identical natural-language queries.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A short literal, symbol, filename, or ripgrep pattern to search for.",
      },
      path: {
        type: "string",
        description: "Directory or file to search; defaults to the project working directory.",
      },
      filesOnly: {
        type: "boolean",
        description: "Return matching file paths without matching lines.",
      },
    },
    required: ["query"],
  };

  constructor(private readonly executor: Executor) {}

  async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
    const params = parseSearchInput(input);
    const args = ["--line-number", "--color", "never"];
    if (params.filesOnly) {
      args.push("-l");
    }
    // `--` keeps a query (or path) that starts with `-` a positional argument
    // instead of a ripgrep option like `--files` or `--pre`.
    const workingDirectory = context?.workingDirectory ?? process.cwd();
    await resolveWorkspacePath(workingDirectory, params.path, context !== undefined);
    // Preserve the caller's relative spelling for executor adapters and tests;
    // validation above has already checked its project boundary.
    args.push("--", params.query, params.path);
    return this.executor.run("rg", args, {
      cwd: workingDirectory,
      ...(context?.signal ? { signal: context.signal } : {}),
    });
  }
}

function parseSearchInput(input: unknown): SearchInput {
  const record = asRecord(input);
  if (typeof record.query !== "string" || record.query.length === 0) {
    throw new Error("search query must be a non-empty string");
  }
  return {
    query: record.query,
    path: typeof record.path === "string" && record.path.length > 0 ? record.path : ".",
    filesOnly: record.filesOnly === true,
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}
