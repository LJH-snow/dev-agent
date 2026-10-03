import type { ToolCall } from "@dev-agent/model";

export interface ToolDefaults {
  readonly maxOutputChars?: number;
  readonly timeoutMs?: number;
}

export type AgentToolRisk = "read-only" | "mutating" | "dangerous";
export type AgentToolConfirmation = "never" | "on-risk" | "always";
export type AgentToolResultFormat = "text" | "json" | "diff";

export interface AgentToolMetadata {
  readonly risk: AgentToolRisk;
  readonly confirmation: AgentToolConfirmation;
  readonly resultFormat: AgentToolResultFormat;
  readonly supportsProgress: boolean;
}

const DEFAULT_TOOL_METADATA: AgentToolMetadata = {
  // A tool that has not declared its capabilities is not safe to treat as a
  // reader. Callers must opt into read-only behavior explicitly.
  risk: "dangerous",
  confirmation: "always",
  resultFormat: "text",
  supportsProgress: false,
};

const DEFAULT_MAX_OUTPUT_CHARS = 50000;
const DEFAULT_TIMEOUT_MS = 30000;

export interface ToolProgress {
  readonly progress: number;
  readonly total?: number;
}

export type ToolSandboxNetworkPolicy = "enabled" | "disabled" | "loopback";
export type SandboxDenialCapability = "network" | "path" | "unknown";

/**
 * UI- and executor-neutral restrictions for one tool invocation.
 *
 * The executor adapter decides how to enforce this profile. Agent Core only
 * carries the bounded intent across the tool boundary.
 */
export interface ToolSandboxProfile {
  readonly name: string;
  readonly network?: ToolSandboxNetworkPolicy;
  readonly writablePaths?: readonly string[];
  readonly readonlyPaths?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly workingDirectory: string;
  /** Aborted when the surrounding run is interrupted. */
  readonly signal?: AbortSignal;
  /** Reports incremental progress from a long-running tool. */
  readonly onProgress?: (progress: ToolProgress) => void;
  /** Optional executor-level restrictions selected by the application edge. */
  readonly sandbox?: ToolSandboxProfile;
}

export interface SandboxDeniedErrorShape {
  readonly message: string;
  readonly code?: string;
  readonly originalCode?: string;
  readonly capability: SandboxDenialCapability;
  readonly command?: string;
}

export interface SandboxExpansionRequest {
  readonly toolName: string;
  readonly input: unknown;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly profile: ToolSandboxProfile;
  readonly error: SandboxDeniedErrorShape;
}

export interface SandboxExpansionDecision {
  readonly decision: "allow" | "deny";
  readonly reason?: string;
  readonly profile?: ToolSandboxProfile;
}

export function isSandboxDeniedError(error: unknown): error is SandboxDeniedErrorShape {
  if (!(error instanceof Error)) {
    return false;
  }
  const candidate = error as Error & Partial<SandboxDeniedErrorShape>;
  return (
    candidate.code === "SANDBOX_DENIED" &&
    (candidate.capability === "network" ||
      candidate.capability === "path" ||
      candidate.capability === "unknown")
  );
}

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters?: Record<string, unknown>;
  readonly metadata?: Partial<AgentToolMetadata>;
  execute(input: unknown, context?: ToolExecutionContext): Promise<unknown>;
}

export interface ToolLookup {
  get(name: string): AgentTool | undefined;
  metadata?(name: string): AgentToolMetadata | undefined;
}

export interface ToolCollection extends ToolLookup {
  list(): AgentTool[];
}

export class AgentToolRegistry implements ToolCollection {
  private readonly tools = new Map<string, AgentTool>();
  private readonly toolMetadata = new Map<string, AgentToolMetadata>();

  register(tool: AgentTool): this {
    this.tools.set(tool.name, tool);
    this.toolMetadata.set(tool.name, normalizeToolMetadata(tool));
    return this;
  }

  unregister(name: string): boolean {
    this.toolMetadata.delete(name);
    return this.tools.delete(name);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  metadata(name: string): AgentToolMetadata | undefined {
    const metadata = this.toolMetadata.get(name);
    return metadata === undefined ? undefined : { ...metadata };
  }
}

export function normalizeToolMetadata(tool: Pick<AgentTool, "name" | "metadata">): AgentToolMetadata {
  const declaredConfirmation = tool.metadata?.confirmation;
  const inferredConfirmation = tool.metadata?.risk === "read-only"
    ? "never"
    : tool.metadata?.risk === "mutating"
      ? "on-risk"
      : DEFAULT_TOOL_METADATA.confirmation;
  return {
    ...DEFAULT_TOOL_METADATA,
    ...(tool.metadata ?? {}),
    ...(declaredConfirmation === undefined ? { confirmation: inferredConfirmation } : {}),
    ...(tool.name === "shell" && tool.metadata === undefined
      ? { risk: "dangerous", confirmation: "on-risk" }
      : {}),
    ...(tool.name === "filesystem" && tool.metadata === undefined
      ? { risk: "mutating", confirmation: "on-risk", resultFormat: "json" }
      : {}),
    ...(tool.name === "git" && tool.metadata === undefined
      ? { risk: "mutating", confirmation: "on-risk" }
      : {}),
  };
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

  // A timeout must stop the work, not just tell the model it stopped. Racing a
  // promise left the tool running, so a "timed out" shell command still wrote
  // its side effects afterwards. Abort the tool instead: executors kill the
  // child (LocalExecutor) or send a cancel envelope (RustExecutor).
  const controller = new AbortController();
  const outer = context?.signal;
  const onOuterAbort = (): void => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) {
      controller.abort(outer.reason);
    } else {
      outer.addEventListener("abort", onOuterAbort, { once: true });
    }
  }
  const toolContext: ToolExecutionContext | undefined = context
    ? { ...context, signal: controller.signal }
    : undefined;

  // Aborting the tool can make it settle (resolve or reject) at the same moment
  // the timeout fires, and which one wins a Promise.race is a coin flip. Track
  // the timeout explicitly so the reported outcome is deterministic.
  let timedOut = false;
  const timeoutError = (): string =>
    JSON.stringify({ error: `Tool "${call.name}" timed out after ${timeoutMs}ms` });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let result: unknown;
  try {
    result = await withTimeout(tool.execute(call.input, toolContext), timeoutMs, call.name);
  } catch (error) {
    if (timedOut || error instanceof ToolTimeoutError) {
      controller.abort();
      return timeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }

  // The tool may have "completed" because our abort stopped it; the caller must
  // still see the timeout, not a success it did not really earn.
  if (timedOut) {
    return timeoutError();
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
