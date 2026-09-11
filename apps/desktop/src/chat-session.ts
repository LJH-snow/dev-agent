import { homedir } from "node:os";
import { join } from "node:path";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  denyDangerousPolicy,
  FileMemory,
  type AgentContext,
  type ApprovalPolicy,
} from "@dev-agent/agent-core";
import { createExecutor } from "@dev-agent/executor";
import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
  type ModelProvider,
} from "@dev-agent/model";
import { createDefaultTools } from "@dev-agent/tools";

export interface StreamEvent {
  readonly type:
    | "token"
    | "tool"
    | "tool-result"
    | "turn"
    | "usage"
    | "approval"
    | "done"
    | "error";
  readonly data: Record<string, unknown>;
}

export type DesktopApprovalMode = "allow" | "deny-dangerous" | "ask";

export interface ChatSessionOptions {
  readonly sessionId?: string;
  readonly workingDirectory?: string;
  readonly systemPrompt?: string;
  readonly maxTurns?: number;
  readonly maxContextChars?: number;
  readonly summarizeContext?: boolean;
  readonly summaryMaxChars?: number;
  readonly approvalMode?: DesktopApprovalMode;
  readonly rustBinaryPath?: string;
}

export class ChatSession {
  private readonly model: ModelProvider;
  private readonly tools: AgentToolRegistry;
  private readonly memory: FileMemory;
  private readonly workingDirectory: string;
  private readonly systemPrompt: string;
  private readonly maxTurns: number;
  private readonly maxContextChars?: number;
  private readonly summarizeContext: boolean;
  private readonly summaryMaxChars?: number;
  private readonly approval?: ApprovalPolicy;
  private context: AgentContext;

  constructor(options: ChatSessionOptions = {}) {
    this.model = createProvider();
    const rustBinaryPath = options.rustBinaryPath ?? process.env.DEV_AGENT_RUST_BINARY;
    this.tools = new AgentToolRegistry();
    for (const tool of createDefaultTools(createExecutor({ rustBinaryPath }))) {
      this.tools.register(tool);
    }

    const sessionId = normalizeSessionId(options.sessionId ?? "desktop-default");
    const memoryFile = process.env.DEV_AGENT_MEMORY_FILE ?? defaultMemoryPath(sessionId);
    this.memory = new FileMemory({ filePath: memoryFile });
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.systemPrompt = options.systemPrompt ?? defaultSystemPrompt;
    this.maxTurns = options.maxTurns ?? 12;
    this.maxContextChars =
      options.maxContextChars ?? parsePositiveInt(process.env.DEV_AGENT_MAX_CONTEXT_CHARS);
    this.summarizeContext =
      options.summarizeContext ?? parseBoolean(process.env.DEV_AGENT_SUMMARIZE_CONTEXT);
    this.summaryMaxChars =
      options.summaryMaxChars ?? parsePositiveInt(process.env.DEV_AGENT_SUMMARY_MAX_CHARS);
    this.approval = resolveApprovalPolicy(options.approvalMode);
    this.context = createAgentContext("desktop", this.memory, {
      sessionId,
      workingDirectory: this.workingDirectory,
      metadata: { desktopVersion: "0.1.0", provider: this.model.id },
    });
  }

  async run(
    message: string,
    emit: (event: StreamEvent) => void,
    options: { readonly signal?: AbortSignal } = {}
  ): Promise<void> {
    let turns = this.context.state.turns;
    const loop = new AgentLoop({
      model: this.model,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      maxTurns: this.maxTurns,
      contextBudget:
        this.maxContextChars === undefined && !this.summarizeContext
          ? undefined
          : {
              maxChars: this.maxContextChars,
              summarize: this.summarizeContext,
              summaryMaxChars: this.summaryMaxChars,
            },
      onTurn: (turn) => {
        turns = turn;
        emit({ type: "turn", data: { turn } });
      },
      onToken: (token) => emit({ type: "token", data: { token } }),
      onToolCall: (call) => emit({ type: "tool", data: { name: call.name, input: call.input } }),
      onToolResult: (result) => emit({ type: "tool-result", data: { name: result.name, output: result.output } }),
      onUsage: (usage) =>
        emit({
          type: "usage",
          data: {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
          },
        }),
      approval: this.approval,
      onApproval: (request, outcome) =>
        emit({
          type: "approval",
          data: {
            tool: request.toolName,
            decision: outcome.decision,
            reason: outcome.reason,
          },
        }),
    });

    try {
      const result = await loop.run(this.context, message, { signal: options.signal });
      this.context = result;
      emit({
        type: "done",
        data: { status: result.state.status, turns: result.state.turns },
      });
    } catch (error) {
      if (options.signal?.aborted) {
        // The interrupted run keeps its previous context; tell the client the
        // stream is over instead of leaving it waiting for more events.
        emit({ type: "done", data: { status: "aborted", turns } });
        return;
      }
      throw error;
    }
  }
}

const defaultSystemPrompt =
  "You are dev-agent, a coding agent running in a desktop chat UI. Use tools when they help answer the user.";

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? "desktop-default" : normalized;
}

function defaultMemoryPath(sessionId: string): string {
  return join(homedir(), ".dev-agent", "sessions", `${sessionId}.json`);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

/**
 * The web UI has no approval prompt yet, so "ask" maps to the conservative
 * deny-only policy instead of silently running the command.
 */
function resolveApprovalPolicy(mode: DesktopApprovalMode | undefined): ApprovalPolicy | undefined {
  const resolved = (mode ?? process.env.DEV_AGENT_APPROVAL ?? "allow").trim().toLowerCase();
  if (resolved === "deny-dangerous" || resolved === "ask") {
    return denyDangerousPolicy();
  }
  return undefined;
}

function createProvider(): ModelProvider {
  const providerId = process.env.DEV_AGENT_MODEL_PROVIDER ?? "ollama";
  const model = process.env.DEV_AGENT_MODEL;

  if (providerId === "ollama") {
    return createOllamaProvider({
      model: model ?? "qwen3:4b-instruct",
      baseUrl: process.env.OLLAMA_BASE_URL,
    });
  }

  if (providerId === "openai") {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.DEV_AGENT_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when DEV_AGENT_MODEL_PROVIDER=openai");
    }
    return createOpenAIProvider({ model: model ?? "gpt-4o-mini", apiKey, baseUrl: process.env.OPENAI_BASE_URL });
  }

  if (providerId === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.DEV_AGENT_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when DEV_AGENT_MODEL_PROVIDER=anthropic");
    }
    return createAnthropicProvider({
      model: model ?? "claude-sonnet-4-20250514",
      apiKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    });
  }

  if (providerId === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.DEV_AGENT_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required when DEV_AGENT_MODEL_PROVIDER=gemini");
    }
    return createGeminiProvider({ model: model ?? "gemini-2.0-flash", apiKey, baseUrl: process.env.GEMINI_BASE_URL });
  }

  throw new Error(
    `Unsupported model provider '${providerId}'. Supports ollama, openai, anthropic, and gemini.`
  );
}
