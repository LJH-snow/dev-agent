import { randomUUID } from "node:crypto";

import {
  connectAcpStdio,
  createAcpAgent,
  type AcpRuntimeFactory,
  type AcpSessionRuntime,
} from "@dev-agent/acp";
import type * as acp from "@dev-agent/acp";
import {
  AgentHookRegistry,
  AgentLoop,
  AgentToolRegistry,
  composePrompt,
  createAgentContext,
  createApprovalPolicy,
  DEFAULT_CLI_PROMPT_MODULES,
  normalizeApprovalKey,
  type AgentContext,
  type AgentLoopBudget,
  type AgentMemory,
  type ApprovalPolicy,
  type ApprovalRequest,
  type CompiledApprovalConfig,
  type ContextBudget,
  type RuntimeEvent,
  type ValidationAdapter,
} from "@dev-agent/agent-core";
import { assertWorkingDirectory, isSandboxExecutor, type Executor } from "@dev-agent/executor";
import type { ChatUsage, ModelProvider } from "@dev-agent/model";
import {
  createBuiltInToolSandboxProfile,
  expandBuiltInToolSandboxProfile,
  FilesystemTool,
} from "@dev-agent/tools";
import type { ApprovalMode } from "./config.js";
import type { ProjectContextManager } from "./project-context.js";
import { redactSensitiveText, sanitizeTerminalText } from "./tui-renderer.js";

export interface AcpServerOptions {
  readonly name: string;
  readonly version: string;
  readonly provider: ModelProvider;
  readonly tools: AgentToolRegistry;
  readonly executor: Executor;
  readonly validation: ValidationAdapter;
  readonly approvalMode: ApprovalMode;
  readonly approvalConfig: CompiledApprovalConfig;
  readonly mcpSupplement: string;
  readonly maxTurns: number;
  readonly budget?: AgentLoopBudget;
  readonly contextBudget?: ContextBudget;
  readonly createMemory: (sessionId: string, workingDirectory: string) => AgentMemory;
  readonly projectContext?: ProjectContextManager;
  readonly restoreChangeSets?: (
    filesystem: FilesystemTool,
    context: AgentContext
  ) => Promise<unknown>;
}

interface PromptState {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly emit: (update: acp.SessionUpdate) => Promise<void>;
  readonly enqueue: (update: acp.SessionUpdate) => void;
  readonly toolIds: Map<string, string[]>;
  readonly answerMessageId: string;
  readonly reasoningMessageId: string;
  answerChunks: number;
}

type PermissionRequester = (
  request: acp.RequestPermissionRequest,
  options?: { readonly signal?: AbortSignal }
) => Promise<acp.RequestPermissionResponse>;

function safeAcpText(value: string): string {
  return redactSensitiveText(sanitizeTerminalText(value));
}

function permissionKind(toolName: string): acp.ToolKind {
  if (toolName === "filesystem") return "edit";
  if (toolName === "search" || toolName === "code-search") return "search";
  if (toolName === "git" || toolName === "shell") return "execute";
  return "other";
}

function textChunk(
  sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk",
  messageId: string,
  text: string
): acp.SessionUpdate {
  return {
    sessionUpdate,
    messageId,
    content: { type: "text", text: safeAcpText(text) },
  };
}

function toolCallContent(text: string): acp.ToolCallContent {
  return {
    type: "content",
    content: { type: "text", text: safeAcpText(text) },
  };
}

function pushToolId(state: PromptState, tool: string, id: string): void {
  const ids = state.toolIds.get(tool) ?? [];
  ids.push(id);
  state.toolIds.set(tool, ids);
}

function takeToolId(state: PromptState, tool: string): string | undefined {
  const ids = state.toolIds.get(tool);
  const id = ids?.shift();
  if (ids?.length === 0) {
    state.toolIds.delete(tool);
  }
  return id;
}

function latestToolId(state: PromptState, tool: string): string | undefined {
  const ids = state.toolIds.get(tool);
  return ids?.[ids.length - 1];
}

function emitRuntimeEvent(state: PromptState, event: RuntimeEvent): void {
  switch (event.type) {
    case "assistant.delta":
      if (event.data.channel === "answer") {
        state.answerChunks += event.data.text.length > 0 ? 1 : 0;
        state.enqueue(textChunk("agent_message_chunk", state.answerMessageId, event.data.text));
      } else {
        state.enqueue(textChunk("agent_thought_chunk", state.reasoningMessageId, event.data.text));
      }
      return;
    case "assistant.completed":
      if (state.answerChunks === 0 && event.data.text.length > 0) {
        state.enqueue(textChunk("agent_message_chunk", state.answerMessageId, event.data.text));
      }
      return;
    case "run.status":
      if (event.data.status === "thinking") {
        state.enqueue(textChunk("agent_thought_chunk", state.reasoningMessageId, "Thinking..."));
      } else if (event.data.status === "waiting-approval") {
        state.enqueue(
          textChunk(
            "agent_thought_chunk",
            state.reasoningMessageId,
            "Waiting for approval..."
          )
        );
      }
      return;
    case "run.failed":
      if (event.data.error.length > 0) {
        state.enqueue(
          textChunk("agent_message_chunk", state.answerMessageId, `[error] ${event.data.error}`)
        );
      }
      return;
    case "tool.started": {
      const toolCallId = `tool-${event.sequence}`;
      pushToolId(state, event.data.tool, toolCallId);
      state.enqueue({
        sessionUpdate: "tool_call",
        toolCallId,
        title: event.data.tool,
        name: event.data.tool,
        kind: permissionKind(event.data.tool),
        status: "in_progress",
      });
      return;
    }
    case "tool.progress": {
      const toolCallId = latestToolId(state, event.data.tool);
      if (toolCallId === undefined) return;
      const total = event.data.total === undefined ? "" : `/${event.data.total}`;
      state.enqueue({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "in_progress",
        content: [
          toolCallContent(
            `${event.data.tool}: ${event.data.progress}${total}${
              event.data.detail === undefined ? "" : ` ${event.data.detail}`
            }`
          ),
        ],
      });
      return;
    }
    case "tool.completed": {
      const toolCallId = takeToolId(state, event.data.tool);
      if (toolCallId === undefined) return;
      state.enqueue({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        ...(event.data.output === undefined
          ? {}
          : { rawOutput: safeAcpText(event.data.output) }),
      });
      return;
    }
    case "tool.failed": {
      const toolCallId = takeToolId(state, event.data.tool);
      if (toolCallId === undefined) return;
      state.enqueue({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "failed",
        rawOutput: safeAcpText(event.data.error),
      });
      return;
    }
    case "usage.reported":
      if (event.data.totalTokens === undefined) return;
      state.enqueue({
        sessionUpdate: "usage_update",
        used: event.data.totalTokens,
        size: Math.max(event.data.totalTokens, 1),
      });
      return;
    case "tool.approval-requested":
    case "tool.approval-resolved":
    case "tool.sandbox-expansion-requested":
    case "tool.sandbox-expansion-resolved":
    case "validation.started":
    case "validation.completed":
    case "session.started":
    case "input.submitted":
    case "input.queued":
    case "run.started":
    case "run.completed":
    case "run.interrupted":
    case "checkpoint.created":
      return;
  }
}

function toAcpUsage(usage: ChatUsage | undefined): acp.PromptResponse["usage"] {
  if (usage === undefined) return undefined;
  return {
    totalTokens: usage.totalTokens,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    ...(usage.cachedPromptTokens === undefined
      ? {}
      : { cachedReadTokens: usage.cachedPromptTokens }),
    ...(usage.cacheCreationPromptTokens === undefined
      ? {}
      : { cachedWriteTokens: usage.cacheCreationPromptTokens }),
  };
}

function createAcpApprovalPolicy(
  mode: ApprovalMode,
  approvalConfig: CompiledApprovalConfig,
  filesystem: FilesystemTool | undefined,
  sessionId: string,
  requestPermission: PermissionRequester,
  getSignal: () => AbortSignal | undefined
): ApprovalPolicy | undefined {
  const sessionAllowed = new Set<string>();
  const prepare = filesystem
    ? (request: ApprovalRequest) =>
        filesystem.prepareChangeSet(request.input, {
          sessionId: request.sessionId,
          workingDirectory: request.workingDirectory,
        })
    : undefined;
  const ask = async (
    request: ApprovalRequest,
    reason: string | undefined
  ): Promise<{ decision: "allow" | "deny"; reason?: string }> => {
    const review = request.review !== undefined;
    const key = review ? undefined : normalizeApprovalKey(request);
    if (key !== undefined && sessionAllowed.has(key)) {
      return { decision: "allow" };
    }

    const allowOnce = {
      optionId: "allow-once",
      name: "Allow once",
      kind: "allow_once" as const,
    };
    const allowAlways = {
      optionId: "allow-always",
      name: "Always allow this command",
      kind: "allow_always" as const,
    };
    const rejectOnce = {
      optionId: "reject-once",
      name: "Reject",
      kind: "reject_once" as const,
    };
    const options = review ? [allowOnce, rejectOnce] : [allowOnce, allowAlways, rejectOnce];
    const detail = review
      ? `Review ${request.toolName}: ${request.review?.files.length ?? 0} file(s), +${
          request.review?.additions ?? 0
        }/-${request.review?.deletions ?? 0}`
      : reason ?? `Approve ${request.toolName}`;
    const response = await requestPermission(
      {
        sessionId,
        toolCall: {
          toolCallId: `permission-${randomUUID()}`,
          title: detail,
          name: request.toolName,
          kind: permissionKind(request.toolName),
          status: "pending",
          ...(review
            ? {
                content: request.review?.files
                  .filter((file) => file.diff.length > 0)
                  .slice(0, 16)
                  .map((file) => toolCallContent(`${file.path}\n${file.diff}`)),
              }
            : {}),
        },
        options,
      },
      getSignal() === undefined ? undefined : { signal: getSignal() }
    );
    if (response.outcome.outcome !== "selected") {
      return { decision: "deny", reason: `${detail} (cancelled)` };
    }
    const selectedOptionId =
      response.outcome.outcome === "selected" ? response.outcome.optionId : undefined;
    const selected = options.find((option) => option.optionId === selectedOptionId);
    if (selected === undefined || selected.kind.startsWith("reject")) {
      return { decision: "deny", reason: `${detail} (declined)` };
    }
    if (selected.kind === "allow_always" && key !== undefined) {
      sessionAllowed.add(key);
    }
    return { decision: "allow" };
  };

  return createApprovalPolicy({
    mode,
    patterns: approvalConfig.patterns,
    allowlist: approvalConfig.allowlist,
    prepare,
    requestApproval: mode === "allow" || mode === "deny-dangerous" ? undefined : ask,
  });
}

async function createAcpSession(
  options: AcpServerOptions,
  request: acp.NewSessionRequest,
  sessionId: string,
  emit: (update: acp.SessionUpdate) => Promise<void>,
  requestPermission: PermissionRequester
): Promise<AcpSessionRuntime> {
  assertWorkingDirectory(request.cwd);
  const memory = options.createMemory(sessionId, request.cwd);
  const contextMetadata = {
    client: "acp",
    provider: options.provider.id,
    model: options.provider.model,
  };
  let context = createAgentContext("acp", memory, {
    sessionId,
    workingDirectory: request.cwd,
    metadata: contextMetadata,
  });
  const filesystem = options.tools.get("filesystem");
  if (filesystem instanceof FilesystemTool && options.restoreChangeSets !== undefined) {
    await options.restoreChangeSets(filesystem, context);
  }

  let activePrompt: PromptState | undefined;
  const hooks = new AgentHookRegistry();
  const approval = createAcpApprovalPolicy(
    options.approvalMode,
    options.approvalConfig,
    filesystem instanceof FilesystemTool ? filesystem : undefined,
    sessionId,
    requestPermission,
    () => activePrompt?.signal
  );
  const loop = new AgentLoop({
    model: options.provider,
    tools: options.tools,
    hooks,
    eventSink: (event) => {
      if (activePrompt !== undefined) {
        emitRuntimeEvent(activePrompt, event);
      }
    },
    systemPromptProvider: () =>
      composePrompt([
        ...DEFAULT_CLI_PROMPT_MODULES,
        ...(options.projectContext?.promptModules() ?? []),
        { id: "mcp", content: options.mcpSupplement },
      ]),
    maxTurns: options.maxTurns,
    budget: options.budget,
    contextBudget: options.contextBudget,
    approval,
    validation: options.validation,
    toolSandboxProfile: isSandboxExecutor(options.executor)
      ? (_toolName, toolContext) =>
          createBuiltInToolSandboxProfile(_toolName, toolContext.workingDirectory)
      : undefined,
    onSandboxExpansion: async (sandboxRequest) => {
      const response = await requestPermission(
        {
          sessionId,
          toolCall: {
            toolCallId: `sandbox-${randomUUID()}`,
            title: `Sandbox expansion: ${sandboxRequest.error.capability}`,
            name: sandboxRequest.toolName,
            kind: "execute",
            status: "pending",
          },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        },
        activePrompt === undefined ? undefined : { signal: activePrompt.signal }
      );
      const optionId =
        response.outcome.outcome === "selected" ? response.outcome.optionId : undefined;
      if (optionId !== "allow-once") {
        return { decision: "deny", reason: "sandbox expansion declined" };
      }
      const profile = expandBuiltInToolSandboxProfile(
        sandboxRequest.profile,
        sandboxRequest.error.capability
      );
      return profile === undefined
        ? { decision: "deny", reason: "sandbox expansion is unavailable" }
        : { decision: "allow", profile };
    },
  });

  const runtime: AcpSessionRuntime = {
    sessionId,
    async prompt(prompt, promptOptions) {
      const runId = `acp-${randomUUID()}`;
      let updateChain = Promise.resolve();
      const enqueue = (update: acp.SessionUpdate): void => {
        updateChain = updateChain.then(() => emit(update));
      };
      activePrompt = {
        runId,
        signal: promptOptions.signal,
        emit,
        enqueue,
        toolIds: new Map(),
        answerMessageId: `answer-${runId}`,
        reasoningMessageId: `reasoning-${runId}`,
        answerChunks: 0,
      };
      try {
        await emit(textChunk("user_message_chunk", `user-${runId}`, prompt));
        await options.projectContext?.refresh();
        const updated = await loop.run(context, prompt, {
          runId,
          signal: promptOptions.signal,
        });
        context = updated;
        await updateChain;
        const stopReason: acp.StopReason =
          promptOptions.signal.aborted
            ? "cancelled"
            : updated.state.status === "error"
              ? updated.state.lastError?.includes("maxTurns") ||
                  updated.state.lastError?.includes("maximum number of turns")
                ? "max_turn_requests"
                : "refusal"
              : "end_turn";
        return {
          stopReason,
          usage: toAcpUsage(updated.usage),
        };
      } finally {
        activePrompt = undefined;
      }
    },
    cancel() {
      // The ACP bridge owns the per-request AbortController and forwards it to
      // AgentLoop. This hook is intentionally idempotent for close/cancel.
    },
    close() {
      activePrompt = undefined;
    },
  };
  return runtime;
}

export async function runAcpServer(options: AcpServerOptions): Promise<void> {
  const runtime: AcpRuntimeFactory = {
    createSession: async ({ request, sessionId, emit, requestPermission }) =>
      createAcpSession(options, request, sessionId, emit, requestPermission),
  };
  const agent = createAcpAgent({
    name: options.name,
    version: options.version,
    runtime,
  });
  const connection = connectAcpStdio(agent);
  await connection.closed;
}
