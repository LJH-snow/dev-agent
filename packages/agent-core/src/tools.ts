import type { ToolCall } from "@dev-agent/model";

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly workingDirectory: string;
}

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters?: Record<string, unknown>;
  execute(input: unknown, context?: ToolExecutionContext): Promise<unknown>;
}

export interface ToolLookup {
  get(name: string): AgentTool | undefined;
}

export interface ToolCollection extends ToolLookup {
  list(): AgentTool[];
}

export class AgentToolRegistry implements ToolCollection {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }
}

export async function runTool(
  tools: ToolLookup,
  call: ToolCall,
  context?: ToolExecutionContext
): Promise<string> {
  const tool = tools.get(call.name);
  if (!tool) {
    throw new Error(`Tool not found: ${call.name}`);
  }
  const result = await tool.execute(call.input, context);
  return JSON.stringify(result);
}
