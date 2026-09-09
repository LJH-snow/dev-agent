import type { Executor } from "@dev-agent/executor";

import type { Tool, ToolExecutionContext } from "./index.js";

interface ShellInput {
  readonly command: string;
  readonly args?: readonly string[];
}

export class ShellTool implements Tool {
  readonly name = "shell" as const;
  readonly description = "Run a local command with optional arguments.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      command: { type: "string" },
      args: { type: "array", items: { type: "string" } },
    },
    required: ["command"],
  };

  constructor(private readonly executor: Executor) {}

  async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
    const params = parseShellInput(input);
    return this.executor.run(params.command, params.args, {
      cwd: context?.workingDirectory,
    });
  }
}

function parseShellInput(input: unknown): ShellInput {
  const record = asRecord(input);
  if (typeof record.command !== "string" || record.command.length === 0) {
    throw new Error("shell command must be a non-empty string");
  }
  return {
    command: record.command,
    args: parseStringArray(record.args),
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function parseStringArray(value: unknown): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("expected an array of strings");
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new Error("expected an array of strings");
    }
    return item;
  });
}
