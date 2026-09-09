export type ToolName = "filesystem" | "shell" | "git" | "search" | "code-search";

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly workingDirectory: string;
}

export interface Tool {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters?: Record<string, unknown>;
  execute(input: unknown, context?: ToolExecutionContext): Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<ToolName, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: ToolName): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }
}

export * from "./filesystem.js";
export * from "./shell.js";
export * from "./git.js";
export * from "./search.js";
export * from "./code-search.js";
export * from "./create-default-tools.js";
