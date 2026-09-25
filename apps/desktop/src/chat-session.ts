import { homedir } from "node:os";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import {
  AgentLoop,
  AgentHookRegistry,
  AgentRunTrace,
  AgentToolRegistry,
  compileApprovalConfig,
  normalizeApprovalKey,
  createApprovalPolicy,
  createAgentContext,
  createBlockedValidationResult,
  createValidationAttemptId,
  composePrompt,
  DEFAULT_DESKTOP_PROMPT_MODULES,
  FileMemoryCheckpointStore,
  FileMemory,
  type AgentContext,
  type ApprovalPolicy,
  type EvidencePruneOptions,
  type EvidencePruneResult,
  type EvidenceSummary,
  runValidationAttempt,
  type ValidationAdapter,
  type ValidationResult,
  type ApprovalRequest,
  type ChangeSetReview,
  type RuntimeEvent,
  type AgentTraceSnapshot,
  type AgentTraceLifecycleKind,
  type AgentTraceLifecycleStatus,
  type SandboxExpansionDecision,
  type SandboxExpansionRequest,
} from "@dev-agent/agent-core";
import {
  createExecutor,
  getExecutorMode,
  isSandboxExecutor,
  type Executor,
  type ExecutorMode,
} from "@dev-agent/executor";
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
import {
  createBuiltInToolSandboxProfile,
  expandBuiltInToolSandboxProfile,
  createDefaultTools,
  createValidationRunner,
  deriveValidationPlan,
  normalizeValidationPolicySettings,
  parseValidationPolicy,
  resolveValidationPolicy,
  FilesystemTool,
  type ValidationPolicy,
  type ValidationPolicySettings,
} from "@dev-agent/tools";
import {
  buildMcpSystemPromptSupplement,
  McpServerSession,
  type McpClientConfig,
  type McpPromptPromptLine,
  type McpResourcePromptLine,
  type McpSessionSnapshot,
} from "@dev-agent/mcp";
import {
  createDesktopStatus,
  type DesktopStatusSnapshot,
  type DesktopStatusValidationResult,
} from "./status.js";
import {
  createMcpHealthSnapshot,
  type McpHealthServerInput,
  type McpHealthSnapshot,
} from "./mcp-health.js";

const MCP_HEALTH_PING_TIMEOUT_MS = 2_500;

export interface StreamEvent {
  readonly type:
    | "token"
    | "reasoning"
    | "tool"
    | "tool-progress"
    | "tool-result"
    | "turn"
    | "usage"
    | "approval"
    | "approval-request"
    | "plan-review"
    | "validation"
    | "runtime"
    | "done"
    | "error";
  readonly data: Record<string, unknown>;
}

/** Projects the versioned core event into the Desktop SSE transport. */
export function projectRuntimeEvent(event: RuntimeEvent): StreamEvent {
  return {
    type: "runtime",
    data: { event },
  };
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
  readonly validationPolicy?: ValidationPolicy;
  readonly approvalMode?: DesktopApprovalMode;
  readonly rustBinaryPath?: string;
  /** Overrides where the session history is stored. */
  readonly memoryFilePath?: string;
  /** Optional MCP stdio servers; defaults to DEV_AGENT_MCP_SERVERS/config.json. */
  readonly mcpServers?: readonly McpClientConfig[];
}

export class ChatSession {
  readonly executorMode: ExecutorMode;
  private readonly model: ModelProvider;
  private readonly executor: Executor;
  private readonly validation: ValidationAdapter;
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
  private readonly validationPolicy: ValidationPolicy;
  private lastValidationResult: DesktopStatusValidationResult = "unknown";
  private readonly compiledApproval: { patterns: readonly RegExp[]; allowlist: readonly string[] };
  private readonly pricing?: PriceTable;
  private readonly mcpServers: readonly McpClientConfig[];
  private readonly mcpSessions: McpServerSession[] = [];
  private readonly mcpSnapshots = new Map<string, McpSessionSnapshot>();
  private readonly mcpHealthRecords = new Map<string, McpHealthServerInput>();
  private readonly hooks: AgentHookRegistry;
  private readonly trace: AgentRunTrace;
  private mcpToolsReady?: Promise<void>;
  private mcpHealthCheck?: Promise<McpHealthSnapshot>;
  private lastMcpHealthCheckedAt?: string;
  private mcpSystemPromptSupplement = "";
  private context: AgentContext;
  private readonly sessionId: string;

  constructor(options: ChatSessionOptions = {}) {
    const config = loadConfigFile();
    const validationPolicy = options.validationPolicy === undefined
      ? resolveValidationPolicy(config)
      : parseValidationPolicy(options.validationPolicy);
    this.model = createProvider();
    this.validationPolicy = validationPolicy;
    const rustBinaryPath = options.rustBinaryPath ?? process.env.DEV_AGENT_RUST_BINARY;
    this.executor = createExecutor({ rustBinaryPath });
    this.executorMode = getExecutorMode(this.executor);
    const validationRunner = createValidationRunner(this.executor);
    this.validation = {
      prepare: (review, context, options) =>
        deriveValidationPlan(review, {
          workingDirectory: context.workingDirectory,
          isGitRepository: existsSync(join(context.workingDirectory, ".git")),
          policy: validationPolicy,
          validationId: options?.validationId,
        }),
      run: (plan, runOptions) => validationRunner.run(plan, runOptions),
    };
    this.tools = new AgentToolRegistry();
    for (const tool of createDefaultTools(this.executor)) {
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
    this.sessionId = sessionId;
    this.memory = new FileMemory({ filePath: memoryFile, sessionId });
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.systemPrompt =
      options.systemPrompt ?? composePrompt(DEFAULT_DESKTOP_PROMPT_MODULES);
    this.maxTurns = options.maxTurns ?? 12;
    this.maxContextChars =
      options.maxContextChars ?? parsePositiveInt(process.env.DEV_AGENT_MAX_CONTEXT_CHARS);
    this.summarizeContext =
      options.summarizeContext ?? parseBoolean(process.env.DEV_AGENT_SUMMARIZE_CONTEXT);
    this.summaryMaxChars =
      options.summaryMaxChars ?? parsePositiveInt(process.env.DEV_AGENT_SUMMARY_MAX_CHARS);
    this.approvalMode = resolveApprovalMode(options.approvalMode, config.approvalMode);
    this.compiledApproval = compileApprovalConfig(config.approval);
    this.pricing = config.pricing;
    this.mcpServers = options.mcpServers ?? loadMcpServers(config.mcpServers);
    this.hooks = new AgentHookRegistry();
    this.trace = new AgentRunTrace(this.hooks);
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
      readonly runId?: string;
      readonly mode?: "normal" | "plan";
    } = {}
  ): Promise<void> {
    await this.restorePersistedChangeSets();
    let turns = this.context.state.turns;
    const loop = this.createLoop(emit, options, (turn) => {
      turns = turn;
      emit({ type: "turn", data: { turn } });
    });

    try {
      await this.ensureMcpTools(options.signal);
      const result = await loop.run(this.context, message, {
        signal: options.signal,
        mode: options.mode ?? "normal",
        ...(options.runId === undefined ? {} : { runId: options.runId }),
      });
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

  /** Applies a reviewed plan without asking the model to recreate the mutation. */
  async applyPlannedChangeSet(
    review: ChangeSetReview,
    prompt: string,
    emit: (event: StreamEvent) => void,
    options: {
      readonly signal?: AbortSignal;
      readonly runId?: string;
    } = {},
  ): Promise<void> {
    await this.restorePersistedChangeSets();
    const loop = this.createLoop(emit, options);
    const turns = this.context.state.turns;
    try {
      const result = await loop.applyPlannedChangeSet(this.context, {
        prompt,
        review,
        signal: options.signal,
        ...(options.runId === undefined ? {} : { runId: options.runId }),
      });
      this.context = result;
      emit({
        type: "done",
        data: { status: result.state.status, turns: result.state.turns },
      });
    } catch (error) {
      if (options.signal?.aborted) {
        emit({ type: "done", data: { status: "aborted", turns } });
        return;
      }
      throw error;
    }
  }

  private createLoop(
    emit: (event: StreamEvent) => void,
    options: {
      readonly signal?: AbortSignal;
      readonly requestApproval?: ApprovalRequester;
      readonly runId?: string;
    },
    onTurn?: (turn: number) => void,
  ): AgentLoop {
    const approval = buildApprovalPolicy(
      this.approvalMode,
      options.requestApproval,
      this.compiledApproval,
      this.filesystem
    );
    return new AgentLoop({
      model: this.model,
      tools: this.tools,
      hooks: this.hooks,
      toolSandboxProfile: isSandboxExecutor(this.executor)
        ? (_toolName, toolContext) =>
            createBuiltInToolSandboxProfile(_toolName, toolContext.workingDirectory)
        : undefined,
      onSandboxExpansion: (request) =>
        requestDesktopSandboxExpansion(request, options.requestApproval, emit),
      systemPromptProvider: () =>
        composePrompt([
          { id: "desktop", content: this.systemPrompt },
          { id: "mcp", content: this.mcpSystemPromptSupplement },
        ]),
      maxTurns: this.maxTurns,
      contextBudget:
        this.maxContextChars === undefined && !this.summarizeContext
          ? undefined
          : {
              maxChars: this.maxContextChars,
              summarize: this.summarizeContext,
              summaryMaxChars: this.summaryMaxChars,
            },
      onTurn: onTurn === undefined
        ? undefined
        : (turn) => onTurn(turn),
      onToken: (token) => emit({ type: "token", data: { token } }),
      onReasoning: (token) => emit({ type: "reasoning", data: { reasoning: token } }),
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
      onToolResult: (result) =>
        emit({ type: "tool-result", data: { name: result.name, output: result.output } }),
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
      onPlanReview: (review) => emit({ type: "plan-review", data: { review } }),
      validation: this.validation,
      onValidation: (result) => {
        this.lastValidationResult = result.status;
        emitValidation(emit, this.sessionId, result);
      },
      eventSink: (event) => {
        try {
          this.trace.recordRuntimeEvent(event);
        } catch {
          // Observability must never change the AgentLoop execution result.
        }
        emit(projectRuntimeEvent(event));
      },
    });
  }

  /** Rolls back the most recently prepared change set when its postimage still matches. */
  async rollbackChangeSet(changeSetId: string): Promise<unknown> {
    await this.restorePersistedChangeSets();
    const result = await this.filesystem.rollbackChangeSet(changeSetId);
    try {
      await this.memory.markChangeSetRolledBack?.(changeSetId);
    } catch {
      // The guarded filesystem rollback already succeeded; durable evidence
      // sync is best-effort and must not turn a safe rollback into a failure.
    }
    return result;
  }

  /** Removes bounded, metadata-only evidence without touching the workspace. */
  async pruneEvidence(
    options: EvidencePruneOptions = {}
  ): Promise<EvidencePruneResult> {
    if (!this.memory.pruneEvidence) {
      throw new Error("evidence cleanup is unavailable");
    }
    return this.memory.pruneEvidence(options);
  }

  /** Returns non-executable evidence counts and the effective retention limits. */
  async evidenceSummary(): Promise<EvidenceSummary> {
    if (!this.memory.evidenceSummary) {
      throw new Error("evidence summary is unavailable");
    }
    return this.memory.evidenceSummary();
  }

  /** Reruns trusted checks for an applied change set without changing files. */
  async rerunValidation(
    changeSetId: string,
    options: { readonly signal?: AbortSignal } = {}
  ): Promise<ValidationResult> {
    const startedAt = Date.now();
    const validationId = createValidationAttemptId(changeSetId);
    let result: ValidationResult;
    const restoreResults = await this.restorePersistedChangeSets();
    const blockedRestore = restoreResults.find(
      (candidate) => candidate.changeSetId === changeSetId && candidate.status === "blocked"
    );
    if (blockedRestore) {
      result = createBlockedValidationResult(
        changeSetId,
        validationId,
        `validation rerun blocked: ${blockedRestore.reason ?? "persisted change-set evidence could not be restored"}`,
        startedAt
      );
    } else {
      try {
        result = await this.filesystem.withAppliedChangeSet(changeSetId, (review) =>
          runValidationAttempt(this.validation, review, this.context, {
            signal: options.signal,
            validationId,
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isPostimageConflict(message)) {
          throw error;
        }
        result = createBlockedValidationResult(
          changeSetId,
          validationId,
          `validation rerun blocked: ${message}`,
          startedAt
        );
      }
    }

    this.lastValidationResult = result.status;
    try {
      await this.memory.recordValidation?.(result);
    } catch {
      // Evidence persistence is best-effort; never turn a safe rerun into a
      // filesystem error or an implicit rollback.
    }
    return result;
  }

  /** Creates a metadata-only conversation checkpoint without touching files. */
  async createCheckpoint() {
    const store = new FileMemoryCheckpointStore(this.memory);
    return await store.create();
  }

  /** Returns the bounded checkpoint records attached to this session. */
  async listCheckpoints() {
    const store = new FileMemoryCheckpointStore(this.memory);
    return await store.list();
  }

  /** Truncates conversation history at a validated anchor; files are unchanged. */
  async rewindToCheckpoint(checkpointId: string) {
    const store = new FileMemoryCheckpointStore(this.memory);
    return await store.rewind(checkpointId);
  }

  private async restorePersistedChangeSets() {
    const records = (await this.memory.changeSets?.()) ?? [];
    return this.filesystem.restoreAppliedChangeSets(records, {
      sessionId: this.sessionId,
      workingDirectory: this.workingDirectory,
    });
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
        const session = new McpServerSession({
          config: {
            ...serverConfig,
            name: prefix,
            rootDirectory: this.workingDirectory,
            env: {
              DEV_AGENT_SESSION_ID: this.sessionId,
              DEV_AGENT_WORKING_DIRECTORY: this.workingDirectory,
              ...(serverConfig.env ?? {}),
            },
          },
        });
        const connectedAt = Date.now();
        let snapshot: McpSessionSnapshot;
        try {
          snapshot = await session.connect();
        } catch (error) {
          this.mcpHealthRecords.set(prefix, {
            name: prefix,
            state: "degraded",
            error: "connect-failed",
            lastCheckedAt: new Date().toISOString(),
          });
          throw error;
        }
        this.mcpSessions.push(session);
        this.mcpSnapshots.set(prefix, snapshot);
        this.mcpHealthRecords.set(prefix, {
          name: prefix,
          state: "connected",
          tools: snapshot.tools.length,
          resources: snapshot.resources.length,
          prompts: snapshot.prompts.length,
          latencyMs: Date.now() - connectedAt,
          lastCheckedAt: new Date().toISOString(),
        });
        this.registerMcpCapabilities(session, prefix, snapshot);
        session.onChange((updated) => {
          if (!this.mcpSessions.includes(session)) {
            return;
          }
          this.unregisterMcpTools(prefix);
          this.mcpSnapshots.set(prefix, updated);
          this.updateMcpHealthRecord(prefix, updated);
          this.registerMcpCapabilities(session, prefix, updated);
          this.rebuildMcpSystemPrompt();
        });
      }
      this.rebuildMcpSystemPrompt();
    } catch (error) {
      await this.closeMcpSessions();
      throw error;
    }
  }

  private updateMcpHealthRecord(prefix: string, snapshot: McpSessionSnapshot): void {
    const previous = this.mcpHealthRecords.get(prefix);
    this.mcpHealthRecords.set(prefix, {
      name: prefix,
      state: previous?.state ?? "connected",
      tools: snapshot.tools.length,
      resources: snapshot.resources.length,
      prompts: snapshot.prompts.length,
      ...(previous?.latencyMs === undefined ? {} : { latencyMs: previous.latencyMs }),
      ...(previous?.lastCheckedAt === undefined ? {} : { lastCheckedAt: previous.lastCheckedAt }),
      ...(previous?.error === undefined ? {} : { error: previous.error }),
    });
  }

  private registerMcpCapabilities(
    session: McpServerSession,
    prefix: string,
    snapshot: McpSessionSnapshot,
  ): void {
    const client = session.getClient();
    for (const tool of snapshot.tools) {
      this.tools.register({
        name: `${prefix}:${tool.name}`,
        description: tool.description,
        parameters: tool.parameters,
        metadata: {
          // MCP server actions are arbitrary remote behavior. Never downgrade
          // their risk based on annotations supplied by the server itself.
          risk: "dangerous",
          confirmation: "always",
          resultFormat: "text",
          supportsProgress: true,
        },
        async execute(input, context) {
          return tool.execute(input, {
            signal: context?.signal,
            onProgress: context?.onProgress,
          });
        },
      });
    }

    this.tools.register({
      name: `${prefix}:resource`,
      description: `Read an MCP resource from server ${prefix} by URI.`,
      parameters: {
        type: "object",
        properties: { uri: { type: "string" } },
        required: ["uri"],
      },
      metadata: {
        risk: "read-only",
        confirmation: "never",
        resultFormat: "json",
        supportsProgress: false,
      },
      async execute(input) {
        const uri = readMcpString(input, "uri");
        const contents = await client.readResourceContents(uri);
        return contents.length > 0 ? contents : [{ uri }];
      },
    });

    this.tools.register({
      name: `${prefix}:prompt`,
      description: `Get an MCP prompt from server ${prefix} by name.`,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          arguments: { type: "object" },
        },
        required: ["name"],
      },
      metadata: {
        risk: "read-only",
        confirmation: "never",
        resultFormat: "json",
        supportsProgress: false,
      },
      async execute(input) {
        const name = readMcpString(input, "name");
        return client.getPrompt(name, readMcpArguments(input));
      },
    });
  }

  private unregisterMcpTools(prefix: string): void {
    const marker = `${prefix}:`;
    for (const tool of this.tools.list()) {
      if (tool.name.startsWith(marker)) {
        this.tools.unregister(tool.name);
      }
    }
  }

  private rebuildMcpSystemPrompt(): void {
    const resources: McpResourcePromptLine[] = [];
    const prompts: McpPromptPromptLine[] = [];
    for (const [prefix, snapshot] of this.mcpSnapshots) {
      for (const resource of snapshot.resources) {
        resources.push({
          prefix,
          uri: resource.info.uri,
          name: resource.info.name,
          description: resource.info.description,
        });
      }
      for (const prompt of snapshot.prompts) {
        prompts.push({
          prefix,
          name: prompt.info.name,
          description: prompt.info.description,
          argumentNames: prompt.info.arguments?.map((argument) => argument.name),
        });
      }
    }
    this.mcpSystemPromptSupplement = buildMcpSystemPromptSupplement(resources, prompts);
  }

  private async closeMcpSessions(): Promise<void> {
    this.clearMcpCapabilities();
    const sessions = this.mcpSessions.splice(0);
    this.mcpSnapshots.clear();
    this.mcpSystemPromptSupplement = "";
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
  }

  /** Closes any configured MCP stdio children owned by this session. */
  async close(): Promise<void> {
    this.trace.dispose();
    await this.mcpToolsReady?.catch(() => undefined);
    this.clearMcpCapabilities();
    const sessions = this.mcpSessions.splice(0);
    this.mcpSnapshots.clear();
    this.mcpSystemPromptSupplement = "";
    this.mcpToolsReady = undefined;
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
    await this.executor.dispose?.();
  }

  private clearMcpCapabilities(): void {
    for (const prefix of this.mcpSnapshots.keys()) {
      this.unregisterMcpTools(prefix);
    }
  }

  get id(): string {
    return this.sessionId;
  }

  /** Returns the bounded, metadata-only lifecycle trace for this session. */
  getTraceSnapshot(): AgentTraceSnapshot {
    return this.trace.snapshot();
  }

  /** Records only allowlisted terminal/preview lifecycle metadata. */
  recordTraceLifecycle(kind: AgentTraceLifecycleKind, status: AgentTraceLifecycleStatus): void {
    this.trace.recordLifecycle(kind, status);
  }

  /** Returns the bounded, metadata-only MCP health snapshot for this session. */
  getMcpHealthSnapshot(): McpHealthSnapshot {
    const prefixes = assignMcpPrefixes(this.mcpServers.map((server) => server.name));
    const servers = prefixes.map((prefix) => {
      const session = this.mcpSessions.find((candidate) => candidate.prefix === prefix);
      const current = this.mcpHealthRecords.get(prefix);
      const snapshot = this.mcpSnapshots.get(prefix);
      const counts = {
        tools: snapshot?.tools.length ?? current?.tools ?? 0,
        resources: snapshot?.resources.length ?? current?.resources ?? 0,
        prompts: snapshot?.prompts.length ?? current?.prompts ?? 0,
      };
      if (session) {
        return {
          name: prefix,
          state: current?.state ?? "connected",
          ...counts,
          ...(current?.latencyMs === undefined ? {} : { latencyMs: current.latencyMs }),
          ...(current?.lastCheckedAt === undefined ? {} : { lastCheckedAt: current.lastCheckedAt }),
          ...(current?.error === undefined ? {} : { error: current.error }),
        } satisfies McpHealthServerInput;
      }
      if (current?.error === "connect-failed") {
        return {
          name: prefix,
          state: "degraded",
          ...counts,
          error: current.error,
          ...(current.lastCheckedAt === undefined ? {} : { lastCheckedAt: current.lastCheckedAt }),
        } satisfies McpHealthServerInput;
      }
      return {
        name: prefix,
        state: "disconnected",
        ...counts,
        error: "not-connected",
        ...(current?.lastCheckedAt === undefined ? {} : { lastCheckedAt: current.lastCheckedAt }),
      } satisfies McpHealthServerInput;
    });
    return createMcpHealthSnapshot(servers, this.lastMcpHealthCheckedAt);
  }

  /** Pings each connected MCP server with a bounded timeout and returns metadata only. */
  async checkMcpHealth(): Promise<McpHealthSnapshot> {
    if (this.mcpHealthCheck) return this.mcpHealthCheck;
    const check = this.performMcpHealthCheck();
    this.mcpHealthCheck = check;
    try {
      return await check;
    } finally {
      if (this.mcpHealthCheck === check) this.mcpHealthCheck = undefined;
    }
  }

  private async performMcpHealthCheck(): Promise<McpHealthSnapshot> {
    const prefixes = assignMcpPrefixes(this.mcpServers.map((server) => server.name));
    await Promise.all(prefixes.map(async (prefix) => {
      const session = this.mcpSessions.find((candidate) => candidate.prefix === prefix);
      const snapshot = this.mcpSnapshots.get(prefix);
      const counts = {
        tools: snapshot?.tools.length ?? 0,
        resources: snapshot?.resources.length ?? 0,
        prompts: snapshot?.prompts.length ?? 0,
      };
      if (!session) {
        this.mcpHealthRecords.set(prefix, {
          name: prefix,
          state: "disconnected",
          ...counts,
          error: "not-connected",
          lastCheckedAt: new Date().toISOString(),
        });
        return;
      }

      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), MCP_HEALTH_PING_TIMEOUT_MS);
      try {
        await session.getClient().ping({ signal: controller.signal });
        this.mcpHealthRecords.set(prefix, {
          name: prefix,
          state: "connected",
          ...counts,
          latencyMs: Date.now() - startedAt,
          lastCheckedAt: new Date().toISOString(),
        });
      } catch {
        this.mcpHealthRecords.set(prefix, {
          name: prefix,
          state: "degraded",
          ...counts,
          error: controller.signal.aborted ? "ping-timeout" : "ping-failed",
          latencyMs: Date.now() - startedAt,
          lastCheckedAt: new Date().toISOString(),
        });
      } finally {
        clearTimeout(timeout);
      }
    }));
    this.lastMcpHealthCheckedAt = new Date().toISOString();
    return this.getMcpHealthSnapshot();
  }

  /** Returns the allowlisted metadata exposed by the desktop status panel. */
  getStatus(): DesktopStatusSnapshot {
    return createDesktopStatus({
      sessionId: this.sessionId,
      workspaceLabel: basename(this.workingDirectory),
      mcpConfigured: this.mcpServers.length,
      mcpConnected: this.mcpSessions.length,
      executorMode: this.executorMode,
      providerId: this.model.id,
      model: this.model.model,
      approvalMode: this.approvalMode,
      validationPolicy: this.validationPolicy,
      validationResult: this.lastValidationResult,
    });
  }

  /** Prices a usage total with this session's model and shared price table. */
  estimateCost(usage: ChatUsage): number | undefined {
    return estimateUsageCost(usage, this.model.model, this.pricing);
  }
}

function isPostimageConflict(message: string): boolean {
  return /postimage|hash conflict|cannot rollback non-empty directory/i.test(message);
}

function emitValidation(
  emit: (event: StreamEvent) => void,
  sessionId: string,
  result: ValidationResult
): void {
  emit({
    type: "validation",
    data: { sessionId, ...result },
  });
}

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
  const approvalRequester = requestApproval
    ? async (request: ApprovalRequest, reason?: string) => {
        const answer = await requestApproval({
          tool: request.toolName,
          reason,
          input: request.input,
          key: normalizeApprovalKey(request),
          ...(request.review === undefined ? {} : { review: request.review }),
        });
        return answer === "allow"
          ? { decision: "allow" as const }
          : {
              decision: "deny" as const,
              reason: request.review
                ? `filesystem ${reviewAction(request)} review declined`
                : `${reason ?? "dangerous call"} (declined)`,
            };
      }
    : undefined;

  return createApprovalPolicy({
    mode,
    patterns: compiled.patterns,
    allowlist: compiled.allowlist,
    prepare: (request) =>
      filesystem.prepareChangeSet(request.input, {
        sessionId: request.sessionId,
        workingDirectory: request.workingDirectory,
      }),
    requestApproval: approvalRequester,
  });
}

async function requestDesktopSandboxExpansion(
  request: SandboxExpansionRequest,
  requestApproval: ApprovalRequester | undefined,
  emit: (event: StreamEvent) => void,
): Promise<SandboxExpansionDecision> {
  const expanded = expandBuiltInToolSandboxProfile(request.profile, request.error.capability);
  if (expanded === undefined) {
    return {
      decision: "deny",
      reason: `sandbox expansion for ${request.error.capability} is unavailable`,
    };
  }
  if (requestApproval === undefined) {
    return {
      decision: "deny",
      reason: "sandbox expansion requires an interactive approval requester",
    };
  }

  const reason =
    `Sandbox denied ${request.error.capability} access. ` +
    "Retry with network access while keeping the existing workspace boundary?";
  try {
    const answer = await requestApproval({
      tool: request.toolName,
      reason,
      input: request.input,
    });
    emit({
      type: "approval",
      data: {
        tool: request.toolName,
        decision: answer,
        reason: answer === "allow"
          ? "sandbox expansion approved"
          : "sandbox expansion declined",
      },
    });
    return answer === "allow"
      ? { decision: "allow", profile: expanded }
      : { decision: "deny", reason: "sandbox expansion declined" };
  } catch (error) {
    const failure =
      `sandbox expansion approval failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    emit({
      type: "approval",
      data: {
        tool: request.toolName,
        decision: "deny",
        reason: failure,
      },
    });
    return { decision: "deny", reason: failure };
  }
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

interface DesktopConfigFile extends ValidationPolicySettings {
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

function readMcpString(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) {
    throw new Error("MCP tool input must be an object");
  }
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`MCP tool input is missing required string field: ${key}`);
  }
  return value;
}

function readMcpArguments(
  input: unknown
): Record<string, string | number | boolean> | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const value = (input as Record<string, unknown>).arguments;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP prompt arguments must be an object");
  }
  return value as Record<string, string | number | boolean>;
}

/** Reads the shared sections of ~/.dev-agent/config.json. */
const MAX_CONFIG_FILE_BYTES = 1024 * 1024;

function loadConfigFile(): DesktopConfigFile {
  let raw: string;
  try {
    const path = join(homedir(), ".dev-agent", "config.json");
    if (statSync(path).size > MAX_CONFIG_FILE_BYTES) {
      return {};
    }
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed config just means no extra rules, matching the old behavior.
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  // Validation policy fields are normalized and allowlisted. Errors here are
  // intentional: a command/argument injection must not be silently ignored.
  return {
    ...(parsed as Record<string, unknown>),
    ...normalizeValidationPolicySettings(parsed),
  } as DesktopConfigFile;
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
