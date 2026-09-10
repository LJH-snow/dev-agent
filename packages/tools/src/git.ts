import type { Executor } from "@dev-agent/executor";

import type { Tool, ToolExecutionContext } from "./index.js";

export class GitTool implements Tool {
  readonly name = "git" as const;
  readonly description = "Run git commands in the local repository.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      args: { type: "array", items: { type: "string" } },
    },
    required: ["args"],
  };

  constructor(private readonly executor: Executor) {}

  async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
    const record = asRecord(input);
    const args = parseStringArray(record.args);
    if (args.length === 0) {
      throw new Error("git tool requires args");
    }
    return this.executor.run("git", args, {
      cwd: context?.workingDirectory,
      ...(context?.signal ? { signal: context.signal } : {}),
    });
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function parseStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error("git args must be an array of strings");
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new Error("git args must be an array of strings");
    }
    return item;
  });
}
