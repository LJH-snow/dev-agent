import type { ToolCall } from "@dev-agent/model";

export interface ToolDefaults {
  readonly maxOutputChars?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_OUTPUT_CHARS = 50000;
const DEFAULT_TIMEOUT_MS = 30000;

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly workingDirectory: string;
  /** Aborted when the surrounding run is interrupted. */
  readonly signal?: AbortSignal;
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
  context?: ToolExecutionContext,
  defaults?: ToolDefaults
): Promise<string> {
  const tool = tools.get(call.name);
  if (!tool) {
    throw new Error(`Tool not found: ${call.name}`);
  }
  const timeoutMs = defaults?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputChars = defaults?.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  let result: unknown;
  try {
    result = await withTimeout(tool.execute(call.input, context), timeoutMs, call.name);
  } catch (error) {
    if (error instanceof ToolTimeoutError) {
      return JSON.stringify({ error: `Tool "${call.name}" timed out after ${timeoutMs}ms` });
    }
    throw error;
  }

  return truncateOutput(JSON.stringify(result), maxOutputChars, call.name);
}

class ToolTimeoutError extends Error {
  constructor(toolName: string, timeoutMs: number) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ToolTimeoutError(toolName, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function truncateOutput(output: string, maxChars: number, toolName: string): string {
  if (output.length <= maxChars) return output;
  const keepChars = Math.floor(maxChars * 0.8);
  const tailChars = maxChars - keepChars;
  const head = output.slice(0, keepChars);
  const tail = output.slice(-tailChars);
  const notice = `\n[truncated ${output.length - maxChars} chars from tool "${toolName}"]\n`;
  return head + notice + tail;
}
