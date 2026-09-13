import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AgentLoop,
  AgentToolRegistry,
  compileApprovalConfig,
  normalizeApprovalKey,
  createAgentContext,
  denyDangerousPolicy,
  reviewWritesPolicy,
  FileMemory,
  type AgentContext,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ChangeSetReview,
} from "@dev-agent/agent-core";
import { createExecutor } from "@dev-agent/executor";
import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
  estimateCost as estimateUsageCost,
  type ChatUsage,
  type PriceTable,
  type ModelProvider,
} from "@dev-agent/model";
import { createDefaultTools, FilesystemTool } from "@dev-agent/tools";
import { McpStdioClient, type McpClientConfig } from "@dev-agent/mcp";

export interface StreamEvent {
  readonly type:
    | "token"
    | "tool"
    | "tool-progress"
    | "tool-result"
    | "turn"
    | "usage"
    | "approval"
    | "approval-request"
    | "done"
    | "error";
  readonly data: Record<string, unknown>;
}

export type DesktopApprovalMode = "allow" | "deny-dangerous" | "ask" | "review-writes";

export interface ApprovalPrompt {
  readonly tool: string;
  readonly reason?: string;
  readonly input: unknown;
  /** Normalized command key, used to remember "always allow" decisions. */
  readonly key?: string;
  /** Real change-set review shown before a filesystem mutation is applied. */
  readonly review?: ChangeSetReview;
}

export type ApprovalRequester = (prompt: ApprovalPrompt) => Promise<"allow" | "deny">;

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
  /** Overrides where the session history is stored. */
  readonly memoryFilePath?: string;
  /** Optional MCP stdio servers; defaults to DEV_AGENT_MCP_SERVERS/config.json. */
  readonly mcpServers?: readonly McpClientConfig[];
}

export class ChatSession {
  private readonly model: ModelProvider;
  private readonly tools: AgentToolRegistry;
  private readonly filesystem: FilesystemTool;
  private readonly memory: FileMemory;
  private readonly workingDirectory: string;
  private readonly systemPrompt: string;
  private readonly maxTurns: number;
  private readonly maxContextChars?: number;
  private readonly summarizeContext: boolean;
  private readonly summaryMaxChars?: number;
  private readonly approvalMode: DesktopApprovalMode;
  private readonly compiledApproval: { patterns: readonly RegExp[]; allowlist: readonly string[] };
  private readonly pricing?: PriceTable;
  private readonly mcpServers: readonly McpClientConfig[];
  private readonly mcpClients: McpStdioClient[] = [];
  private mcpToolsReady?: Promise<void>;
  private context: AgentContext;
  private readonly sessionId: string;

  constructor(options: ChatSessionOptions = {}) {
    this.model = createProvider();
    const rustBinaryPath = options.rustBinaryPath ?? process.env.DEV_AGENT_RUST_BINARY;
    this.tools = new AgentToolRegistry();
    for (const tool of createDefaultTools(createExecutor({ rustBinaryPath }))) {
      this.tools.register(tool);
    }
    const filesystem = this.tools.get("filesystem");
    if (!(filesystem instanceof FilesystemTool)) {
      throw new Error("filesystem tool is unavailable for write review");
    }
    this.filesystem = filesystem;

    const sessionId = normalizeSessionId(options.sessionId ?? "desktop-default");
    const memoryFile =
      options.memoryFilePath ?? process.env.DEV_AGENT_MEMORY_FILE ?? defaultMemoryPath(sessionId);
    this.memory = new FileMemory({ filePath: memoryFile });
    this.sessionId = sessionId;
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.systemPrompt = options.systemPrompt ?? defaultSystemPrompt;
    this.maxTurns = options.maxTurns ?? 12;
    this.maxContextChars =
      options.maxContextChars ?? parsePositiveInt(process.env.DEV_AGENT_MAX_CONTEXT_CHARS);
    this.summarizeContext =
      options.summarizeContext ?? parseBoolean(process.env.DEV_AGENT_SUMMARIZE_CONTEXT);
    this.summaryMaxChars =
      options.summaryMaxChars ?? parsePositiveInt(process.env.DEV_AGENT_SUMMARY_MAX_CHARS);
    const config = loadConfigFile();
    this.approvalMode = resolveApprovalMode(options.approvalMode, config.approvalMode);
    this.compiledApproval = compileApprovalConfig(config.approval);
    this.pricing = config.pricing;
    this.mcpServers = options.mcpServers ?? loadMcpServers(config.mcpServers);
    this.context = createAgentContext("desktop", this.memory, {
      sessionId,
      workingDirectory: this.workingDirectory,
      metadata: { desktopVersion: "0.1.0", provider: this.model.id },
    });
  }

  async run(
    message: string,
    emit: (event: StreamEvent) => void,
    options: {
      readonly signal?: AbortSignal;
      readonly requestApproval?: ApprovalRequester;
    } = {}
  ): Promise<void> {
    let turns = this.context.state.turns;
    const approval = buildApprovalPolicy(
      this.approvalMode,
      options.requestApproval,
      this.compiledApproval,
      this.filesystem
    );
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
      onToolProgress: (progress) =>
        emit({
          type: "tool-progress",
          data: {
            name: progress.name,
            progress: progress.progress,
            ...(progress.total === undefined ? {} : { total: progress.total }),
          },
        }),
      onToolResult: (result) => emit({ type: "tool-result", data: { name: result.name, output: result.output } }),
      onUsage: (usage) => {
        const cost = estimateUsageCost(usage, this.model.model, this.pricing);
        emit({
          type: "usage",
          data: {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            ...(cost === undefined ? {} : { cost }),
          },
        });
      },
      approval,
      onApproval: (request, outcome) =>
        emit({
          type: "approval",
          data: {
            tool: request.toolName,
            decision: outcome.decision,
            reason: outcome.reason,
            ...(request.review === undefined ? {} : { review: request.review }),
          },
        }),
    });

    try {
      await this.ensureMcpTools(options.signal);
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

  private async ensureMcpTools(signal?: AbortSignal): Promise<void> {
    if (this.mcpServers.length === 0) {
      return;
    }
    if (signal?.aborted) {
      throw signal.reason ?? new Error("The operation was aborted");
    }
    if (!this.mcpToolsReady) {
      const ready = this.connectMcpTools();
      this.mcpToolsReady = ready.catch((error) => {
        this.mcpToolsReady = undefined;
        throw error;
      });
    }
    await this.mcpToolsReady;
    if (signal?.aborted) {
      throw signal.reason ?? new Error("The operation was aborted");
    }
  }

  private async connectMcpTools(): Promise<void> {
    const prefixes = assignMcpPrefixes(this.mcpServers.map((server) => server.name));
    try {
      for (const [index, serverConfig] of this.mcpServers.entries()) {
        const prefix = prefixes[index] ?? "mcp";
        const client = new McpStdioClient();
        this.mcpClients.push(client);
        await client.connect({
          ...serverConfig,
          name: prefix,
          rootDirectory: this.workingDirectory,
          env: {
            DEV_AGENT_SESSION_ID: this.sessionId,
            DEV_AGENT_WORKING_DIRECTORY: this.workingDirectory,
            ...(serverConfig.env ?? {}),
          },
        });
        const tools = await client.listTools();
        for (const tool of tools) {
          this.tools.register({
            name: `${prefix}:${tool.name}`,
            description: tool.description,
            parameters: tool.parameters,
            async execute(input, context) {
              return tool.execute(input, {
                signal: context?.signal,
                onProgress: context?.onProgress,
              });
            },
          });
        }
      }
    } catch (error) {
      await this.closeMcpClients();
      throw error;
    }
  }

  private async closeMcpClients(): Promise<void> {
    const clients = this.mcpClients.splice(0);
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  }

  /** Closes any configured MCP stdio children owned by this session. */
  async close(): Promise<void> {
    await this.mcpToolsReady?.catch(() => undefined);
    const clients = this.mcpClients.splice(0);
    this.mcpToolsReady = undefined;
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  }

  get id(): string {
    return this.sessionId;
  }

  /** Prices a usage total with this session's model and shared price table. */
  estimateCost(usage: ChatUsage): number | undefined {
    return estimateUsageCost(usage, this.model.model, this.pricing);
  }
}

const defaultSystemPrompt =
  "You are dev-agent, a coding agent running in a desktop chat UI. Use tools when they help answer the user.";

export function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? "desktop-default" : normalized;
}

function defaultMemoryPath(sessionId: string): string {
  const dir = process.env.DEV_AGENT_SESSION_DIR ?? join(homedir(), ".dev-agent", "sessions");
  return join(dir, `${sessionId}.json`);
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

function resolveApprovalMode(
  mode: DesktopApprovalMode | undefined,
  configuredMode?: DesktopApprovalMode
): DesktopApprovalMode {
  const resolved = (mode ?? process.env.DEV_AGENT_APPROVAL ?? configuredMode ?? "allow")
    .trim()
    .toLowerCase();
  if (
    resolved === "allow" ||
    resolved === "deny-dangerous" ||
    resolved === "ask" ||
    resolved === "review-writes"
  ) {
    return resolved;
  }
  return "allow";
}

/**
 * Builds the policy for one run. `ask` needs a way to reach the user; without
 * a requester it stays conservative and behaves like `deny-dangerous`.
 */
function buildApprovalPolicy(
  mode: DesktopApprovalMode,
  requestApproval: ApprovalRequester | undefined,
  compiled: { patterns: readonly RegExp[]; allowlist: readonly string[] },
  filesystem: FilesystemTool
): ApprovalPolicy | undefined {
  if (mode === "allow") {
    return undefined;
  }

  const dangerous = denyDangerousPolicy({
    patterns: [...compiled.patterns],
    allowlist: [...compiled.allowlist],
  });
  if (mode === "deny-dangerous") {
    return dangerous;
  }

  if (mode === "review-writes") {
    return reviewWritesPolicy({
      prepare: (request) =>
        filesystem.prepareChangeSet(request.input, {
          sessionId: request.sessionId,
          workingDirectory: request.workingDirectory,
        }),
      patterns: [...compiled.patterns],
      allowlist: [...compiled.allowlist],
      requestApproval: requestApproval
        ? async (request, reason) => {
            const answer = await requestApproval({
              tool: request.toolName,
              reason,
              input: request.input,
              key: normalizeApprovalKey(request),
              ...(request.review === undefined ? {} : { review: request.review }),
            });
            return answer === "allow"
              ? { decision: "allow" }
              : {
                  decision: "deny",
                  reason: request.review
                    ? `filesystem ${reviewAction(request)} review declined`
                    : `${reason ?? "dangerous call"} (declined)`,
                };
          }
        : undefined,
    });
  }

  if (!requestApproval) {
    return dangerous;
  }

  return {
    async decide(request) {
      const outcome = await dangerous.decide(request);
      const decision = typeof outcome === "string" ? outcome : outcome.decision;
      if (decision === "allow") {
        return { decision: "allow" };
      }

      const reason = typeof outcome === "string" ? undefined : outcome.reason;
      const answer = await requestApproval({
        tool: request.toolName,
        reason,
        input: request.input,
        key: normalizeApprovalKey(request),
      });
      return answer === "allow"
        ? { decision: "allow" }
        : { decision: "deny", reason: `${reason ?? "dangerous call"} (declined)` };
    },
  };
}

function reviewAction(request: ApprovalRequest): string {
  if (typeof request.input === "object" && request.input !== null) {
    const action = (request.input as Record<string, unknown>).action;
    if (typeof action === "string") {
      return action;
    }
  }
  return "write";
}

interface DesktopConfigFile {
  readonly approvalMode?: DesktopApprovalMode;
  readonly approval?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
  readonly pricing?: PriceTable;
  readonly mcpServers?: readonly McpClientConfig[];
}

function loadMcpServers(fromConfig: readonly McpClientConfig[] | undefined): McpClientConfig[] {
  const raw = process.env.DEV_AGENT_MCP_SERVERS;
  if (!raw) {
    return (fromConfig ?? []).map(normalizeMcpServer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DEV_AGENT_MCP_SERVERS must be valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("DEV_AGENT_MCP_SERVERS must be a JSON array");
  }
  return parsed.map(normalizeMcpServer);
}

function normalizeMcpServer(entry: unknown): McpClientConfig {
  if (typeof entry !== "object" || entry === null) {
    throw new Error("Each MCP server entry must be an object with a string command");
  }
  const config = entry as Record<string, unknown>;
  if (typeof config.command !== "string" || config.command.trim() === "") {
    throw new Error("Each MCP server entry must be an object with a string command");
  }
  return {
    name: typeof config.name === "string" ? config.name : undefined,
    command: config.command,
    args: Array.isArray(config.args) ? config.args.map((arg) => String(arg)) : undefined,
    env:
      typeof config.env === "object" && config.env !== null
        ? Object.fromEntries(
            Object.entries(config.env as Record<string, unknown>).map(([key, value]) => [
              key,
              String(value),
            ])
          )
        : undefined,
    timeoutMs:
      typeof config.timeoutMs === "number" && Number.isInteger(config.timeoutMs) && config.timeoutMs > 0
        ? config.timeoutMs
        : undefined,
  };
}

function assignMcpPrefixes(names: readonly (string | undefined)[]): readonly string[] {
  const unnamed = names.filter((name) => name === undefined || name.trim() === "").length;
  const used = new Set<string>();
  return names.map((name, index) => {
    const base = name?.trim() || (unnamed > 1 ? `mcp-${index + 1}` : "mcp");
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

/** Reads the shared sections of ~/.dev-agent/config.json. */
function loadConfigFile(): DesktopConfigFile {
  try {
    const raw = readFileSync(join(homedir(), ".dev-agent", "config.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as DesktopConfigFile;
    }
    return {};
  } catch {
    // A missing or malformed config just means no extra rules.
    return {};
  }
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
