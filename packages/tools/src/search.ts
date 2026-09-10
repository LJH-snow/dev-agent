import type { Executor } from "@dev-agent/executor";

import type { Tool, ToolExecutionContext } from "./index.js";

interface SearchInput {
  readonly query: string;
  readonly path: string;
  readonly filesOnly?: boolean;
}

export class SearchTool implements Tool {
  readonly name = "search" as const;
  readonly description = "Search code and text with ripgrep.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      query: { type: "string" },
      path: { type: "string" },
      filesOnly: { type: "boolean" },
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
    args.push(params.query, params.path);
    return this.executor.run("rg", args, {
      cwd: context?.workingDirectory,
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
