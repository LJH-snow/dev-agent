import {
  AgentToolRegistry,
  type CollaborationTask,
  type CollaborationTaskToolLease,
  type CollaborationWorkspace,
  type ToolCollection,
} from "@dev-agent/agent-core";
import {
  McpServerSession,
  type McpClientConfig,
  type McpSessionSnapshot,
} from "@dev-agent/mcp";

export interface WorkerMcpTaskToolLeaseFactoryOptions {
  readonly servers: readonly McpClientConfig[];
  readonly prefixes: readonly string[];
  readonly sessionId: string;
  readonly createSession?: (config: McpClientConfig) => WorkerMcpSession;
}

export interface WorkerMcpClient {
  readResourceContents(uri: string): Promise<readonly unknown[]>;
  getPrompt(
    name: string,
    args?: Readonly<Record<string, string | number | boolean>>,
  ): Promise<unknown>;
}

export interface WorkerMcpSession {
  connect(): Promise<McpSessionSnapshot>;
  getClient(): WorkerMcpClient;
  close(): Promise<void>;
}

export type WorkerMcpTaskToolLeaseFactory = (
  task: CollaborationTask,
  taskIndex: number,
  workspace: CollaborationWorkspace,
  scopedTools: ToolCollection | undefined,
  signal: AbortSignal,
) => Promise<CollaborationTaskToolLease>;

/**
 * Creates task-local MCP implementations without reusing the main-session
 * clients. The caller supplies already-reviewed tool names; this factory only
 * replaces implementations, it never grants new names.
 */
export function createWorkerMcpTaskToolLeaseFactory(
  options: WorkerMcpTaskToolLeaseFactoryOptions,
): WorkerMcpTaskToolLeaseFactory {
  return async (task, taskIndex, workspace, scopedTools, signal) => {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("task MCP setup was cancelled");
    }
    const allowedNames = new Set(
      scopedTools?.list()
        .map((tool) => tool.name)
        .filter((name) => isMcpName(name, options.prefixes)),
    );
    const tools = new AgentToolRegistry();
    for (const tool of scopedTools?.list() ?? []) {
      if (!isMcpName(tool.name, options.prefixes)) {
        tools.register(tool);
      }
    }

    const sessions: WorkerMcpSession[] = [];
    let disposed = false;
    try {
      for (const [serverIndex, server] of options.servers.entries()) {
        const prefix = options.prefixes[serverIndex];
        if (prefix === undefined || ![...allowedNames].some((name) => name.startsWith(`${prefix}:`))) {
          continue;
        }
        const sessionId = `${options.sessionId}-${safeId(task.id)}-${taskIndex}`;
        const session = (options.createSession ?? ((config) => new McpServerSession({ config })) )({
          ...server,
          name: prefix,
          rootDirectory: workspace.path,
          env: {
            DEV_AGENT_SESSION_ID: sessionId,
            DEV_AGENT_WORKING_DIRECTORY: workspace.path,
            ...(server.env ?? {}),
          },
        });
        sessions.push(session);
        const abortHandler = (): void => { void session.close().catch(() => undefined); };
        signal.addEventListener("abort", abortHandler, { once: true });
        try {
          const snapshot = await session.connect();
          if (signal.aborted) {
            throw signal.reason instanceof Error
              ? signal.reason
              : new Error("task MCP setup was cancelled");
          }
          registerSnapshotTools(tools, session.getClient(), snapshot, prefix, allowedNames);
        } finally {
          signal.removeEventListener("abort", abortHandler);
        }
      }
    } catch (error) {
      await closeSessions(sessions);
      throw error;
    }

    return {
      tools,
      async dispose() {
        if (disposed) return;
        disposed = true;
        await closeSessions(sessions);
      },
    };
  };
}

export function createNonMcpToolCollection(
  source: ToolCollection,
  prefixes: readonly string[],
): ToolCollection {
  const selected = source.list().filter((tool) => !isMcpName(tool.name, prefixes));
  const byName = new Map(selected.map((tool) => [tool.name, tool]));
  return {
    list: () => [...selected],
    get: (name) => byName.get(name),
    metadata: (name) => source.metadata?.(name),
  };
}

export function withoutMcpNames(
  names: readonly string[] | undefined,
  prefixes: readonly string[],
): readonly string[] | undefined {
  return names?.filter((name) => !isMcpName(name, prefixes));
}

function registerSnapshotTools(
  tools: AgentToolRegistry,
  client: WorkerMcpClient,
  snapshot: McpSessionSnapshot,
  prefix: string,
  allowedNames: ReadonlySet<string>,
): void {
  for (const tool of snapshot.tools) {
    const name = `${prefix}:${tool.name}`;
    if (!allowedNames.has(name)) continue;
    tools.register({
      name,
      description: tool.description,
      parameters: tool.parameters,
      metadata: {
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

  const resourceName = `${prefix}:resource`;
  if (allowedNames.has(resourceName)) {
    tools.register({
      name: resourceName,
      description: `Read an MCP resource from worker server ${prefix} by URI.`,
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
        const uri = readString(input, "uri");
        const contents = await client.readResourceContents(uri);
        return contents.length > 0 ? contents : [{ uri }];
      },
    });
  }

  const promptName = `${prefix}:prompt`;
  if (allowedNames.has(promptName)) {
    tools.register({
      name: promptName,
      description: `Get an MCP prompt from worker server ${prefix} by name.`,
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
        const name = readString(input, "name");
        return client.getPrompt(name, readArguments(input));
      },
    });
  }
}

function isMcpName(name: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => name.startsWith(`${prefix}:`));
}

async function closeSessions(sessions: readonly WorkerMcpSession[]): Promise<void> {
  await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
}

function readString(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null || typeof (input as Record<string, unknown>)[key] !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return (input as Record<string, unknown>)[key] as string;
}

function readArguments(input: unknown): Readonly<Record<string, string | number | boolean>> | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>).arguments;
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("arguments must be an object");
  }
  const result: Record<string, string | number | boolean> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== "string" && typeof candidate !== "number" && typeof candidate !== "boolean") {
      throw new Error("prompt arguments must be scalar values");
    }
    result[key] = candidate;
  }
  return result;
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/giu, "-").slice(0, 64) || "task";
}
