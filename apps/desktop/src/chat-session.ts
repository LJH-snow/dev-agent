import { homedir } from "node:os";
import { join } from "node:path";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  FileMemory,
  type AgentContext,
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
  readonly type: "token" | "tool" | "tool-result" | "turn" | "done" | "error";
  readonly data: Record<string, unknown>;
}

export interface ChatSessionOptions {
  readonly sessionId?: string;
  readonly workingDirectory?: string;
  readonly systemPrompt?: string;
  readonly maxTurns?: number;
  readonly rustBinaryPath?: string;
}

export class ChatSession {
  private readonly model: ModelProvider;
  private readonly tools: AgentToolRegistry;
  private readonly memory: FileMemory;
  private readonly workingDirectory: string;
  private readonly systemPrompt: string;
  private readonly maxTurns: number;
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
    this.context = createAgentContext("desktop", this.memory, {
      sessionId,
      workingDirectory: this.workingDirectory,
      metadata: { desktopVersion: "0.1.0", provider: this.model.id },
    });
  }

  async run(message: string, emit: (event: StreamEvent) => void): Promise<void> {
    const loop = new AgentLoop({
      model: this.model,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      maxTurns: this.maxTurns,
      onTurn: (turn) => emit({ type: "turn", data: { turn } }),
      onToken: (token) => emit({ type: "token", data: { token } }),
      onToolCall: (call) => emit({ type: "tool", data: { name: call.name, input: call.input } }),
      onToolResult: (result) => emit({ type: "tool-result", data: { name: result.name, output: result.output } }),
    });

    const result = await loop.run(this.context, message);
    this.context = result;
    emit({
      type: "done",
      data: { status: result.state.status, turns: result.state.turns },
    });
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
