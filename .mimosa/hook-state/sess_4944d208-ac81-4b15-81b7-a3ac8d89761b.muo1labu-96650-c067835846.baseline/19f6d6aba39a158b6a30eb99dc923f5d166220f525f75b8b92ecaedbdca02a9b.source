import { createHash, randomUUID } from "node:crypto";

import {
  createAgentCard,
  startA2aServer,
  type A2aRuntimeFactory,
  type A2aRuntimeSession,
  type A2aRuntimeUpdate,
} from "@dev-agent/a2a";
import {
  AgentHookRegistry,
  AgentLoop,
  AgentToolRegistry,
  composePrompt,
  createAgentContext,
  createApprovalPolicy,
  DEFAULT_CLI_PROMPT_MODULES,
  type AgentContext,
  type AgentLoopBudget,
  type AgentMemory,
  type ApprovalRequest,
  type ApprovalPolicy,
  type CompiledApprovalConfig,
  type ContextBudget,
  type RuntimeEvent,
  type ValidationAdapter,
} from "@dev-agent/agent-core";
import { isSandboxExecutor, type Executor } from "@dev-agent/executor";
import type { ModelProvider } from "@dev-agent/model";
import {
  createBuiltInToolSandboxProfile,
  FilesystemTool,
} from "@dev-agent/tools";
import type { ApprovalMode } from "./config.js";
import type { ProjectContextManager } from "./project-context.js";

export interface A2aServerOptions {
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
  readonly restoreChangeSets?: (
    filesystem: FilesystemTool,
    context: AgentContext
  ) => Promise<unknown>;
  readonly workingDirectory: string;
  readonly projectContext?: ProjectContextManager;
  readonly host?: string;
  readonly port?: number;
}

function createA2aApprovalPolicy(
  mode: ApprovalMode,
  approvalConfig: CompiledApprovalConfig,
  filesystem: FilesystemTool | undefined,
): ApprovalPolicy | undefined {
  const prepare = filesystem
    ? (request: ApprovalRequest) =>
        filesystem.prepareChangeSet(request.input, {
          sessionId: request.sessionId,
          workingDirectory: request.workingDirectory,
        })
    : undefined;
  return createApprovalPolicy({
    mode,
    patterns: approvalConfig.patterns,
    allowlist: approvalConfig.allowlist,
    prepare,
    requestApproval:
      mode === "allow" || mode === "deny-dangerous"
        ? undefined
        : async (_request, reason) => ({
            decision: "deny",
            reason:
              reason === undefined
                ? "interactive approval is unavailable in A2A mode"
                : `${reason} (interactive approval is unavailable in A2A mode)`,
          }),
  });
}

async function createA2aSession(
  options: A2aServerOptions,
  contextId: string,
): Promise<A2aRuntimeSession> {
  const sessionId = createA2aSessionId(contextId);
  const memory = options.createMemory(sessionId, options.workingDirectory);
  let context = createAgentContext("a2a", memory, {
    sessionId,
    workingDirectory: options.workingDirectory,
    metadata: {
      client: "a2a",
      provider: options.provider.id,
      model: options.provider.model,
      contextId: createA2aSessionId(contextId),
    },
  });
  const filesystem = options.tools.get("filesystem");
  if (filesystem instanceof FilesystemTool && options.restoreChangeSets !== undefined) {
    await options.restoreChangeSets(filesystem, context);
  }

  let emitRuntimeEvent: ((event: RuntimeEvent) => void) | undefined;
  const hooks = new AgentHookRegistry();
  const approval = createA2aApprovalPolicy(
    options.approvalMode,
    options.approvalConfig,
    filesystem instanceof FilesystemTool ? filesystem : undefined,
  );
  const loop = new AgentLoop({
    model: options.provider,
    tools: options.tools,
    hooks,
    eventSink: (event) => emitRuntimeEvent?.(event),
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
      ? (toolName, toolContext) =>
          createBuiltInToolSandboxProfile(toolName, toolContext.workingDirectory)
      : undefined,
    onSandboxExpansion: () => ({
      decision: "deny",
      reason: "sandbox expansion requires an interactive approval channel",
    }),
  });

  return {
    async run({ prompt, signal, emit }) {
      const runId = `a2a-${randomUUID()}`;
      emitRuntimeEvent = (event) => forwardRuntimeEvent(event, emit);
      try {
        await options.projectContext?.refresh();
        context = await loop.run(context, prompt, { runId, signal });
        if (context.state.status === "error") {
          throw new Error("agent execution failed");
        }
      } finally {
        emitRuntimeEvent = undefined;
      }
    },
    close() {
      emitRuntimeEvent = undefined;
    },
  };
}

export function createA2aSessionId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  const prefix = normalized === "" ? "default" : normalized.slice(0, 56);
  return `a2a-${prefix}-${digest}`;
}

export async function runA2aServer(options: A2aServerOptions): Promise<void> {
  const runtime: A2aRuntimeFactory = {
    createSession: ({ contextId }) => createA2aSession(options, contextId),
  };
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4320;
  const authToken = process.env.DEV_AGENT_A2A_TOKEN?.trim() || undefined;
  const app = await startA2aServer({
    agentCard: createAgentCard({
      name: options.name,
      version: options.version,
      url: `http://${host}:${port}/`,
      description: "A local coding agent with bounded task streaming.",
      authRequired: authToken !== undefined,
    }),
    runtime,
    host,
    port,
    authToken,
  });
  process.stderr.write(
    `A2A server listening at http://${host}:${app.port}/ ` +
      `(agent card: /.well-known/agent-card.json)\n`,
  );

  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    void app.close().catch(() => undefined);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  try {
    await new Promise<void>((resolve) => {
      app.server.once("close", resolve);
    });
  } finally {
    process.removeListener("SIGINT", close);
    process.removeListener("SIGTERM", close);
    if (!closing) {
      await app.close();
    }
  }
}

function forwardRuntimeEvent(
  event: RuntimeEvent,
  emit: (update: A2aRuntimeUpdate) => void,
): void {
  switch (event.type) {
    case "assistant.delta":
      if (event.data.channel === "reasoning") return;
      emit({ type: "text", text: event.data.text });
      return;
    case "run.status":
      emit({
        type: "status",
        status: event.data.status === "waiting-approval" ? "waiting-approval" : "working",
      });
      return;
    case "tool.started":
      emit({ type: "tool", tool: event.data.tool });
      return;
    case "tool.progress":
      emit({
        type: "tool",
        tool: event.data.tool,
        progress: event.data.progress,
        ...(event.data.total === undefined ? {} : { total: event.data.total }),
      });
      return;
    case "tool.approval-requested":
      emit({
        type: "status",
        status: "waiting-approval",
      });
      return;
    default:
      return;
  }
}
