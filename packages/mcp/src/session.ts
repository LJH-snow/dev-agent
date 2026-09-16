import type {
  McpClient,
  McpClientConfig,
  McpNotification,
  McpPrompt,
  McpResource,
  McpTool,
} from "./types.js";

import { McpStdioClient } from "./stdio-client.js";

export interface McpSessionSnapshot {
  readonly tools: readonly McpTool[];
  readonly resources: readonly McpResource[];
  readonly prompts: readonly McpPrompt[];
}

export type McpSessionChangeHandler = (snapshot: McpSessionSnapshot) => void;
export type McpResourceWatcher = (uri: string) => void;

export interface McpSessionOptions {
  readonly config: McpClientConfig;
  readonly client?: McpClient;
}

function snapshot(
  tools: McpTool[],
  resources: McpResource[],
  prompts: McpPrompt[]
): McpSessionSnapshot {
  return {
    tools: [...tools],
    resources: [...resources],
    prompts: [...prompts],
  };
}

export class McpServerSession {
  private readonly config: McpClientConfig;
  private readonly createClient: () => McpClient;
  private client: McpClient;
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private prompts: McpPrompt[] = [];
  private changeHandlers: McpSessionChangeHandler[] = [];
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly resourceWatchers = new Map<string, McpResourceWatcher[]>();
  private generation = 0;
  private static readonly DEBOUNCE_MS = 500;

  constructor(options: McpSessionOptions) {
    this.config = options.config;
    this.createClient = options.client
      ? () => options.client!
      : () => new McpStdioClient();
    this.client = this.createClient();
  }

  get prefix(): string {
    return this.config.name ?? "mcp";
  }

  get serverInfo() {
    return this.client.getServerInfo();
  }

  get serverCapabilities() {
    return this.client.getServerCapabilities();
  }

  async connect(): Promise<McpSessionSnapshot> {
    this.clearDebounceTimers();
    const client = this.createClient();
    const generation = ++this.generation;
    this.client = client;
    client.onNotification((notification) => {
      if (!this.isCurrent(client, generation)) {
        return;
      }
      void this.handleNotification(notification, client, generation).catch(() => undefined);
    });
    try {
      await client.connect(this.config);
      return await this.refreshAll(client, generation);
    } catch (error) {
      if (this.isCurrent(client, generation)) {
        this.generation += 1;
      }
      // A client can connect successfully and still fail during the initial
      // tools/resources/prompts refresh. Close that half-open session before
      // surfacing the startup failure so its child cannot outlive the caller.
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async reconnect(): Promise<McpSessionSnapshot> {
    let lastError: unknown;
    const maxAttempts = 3;
    const backoffMs = [1000, 2000, 4000];
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await this.close();
        return await this.connect();
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs[attempt]));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("MCP reconnect failed after 3 attempts");
  }

  async close(): Promise<void> {
    this.generation += 1;
    this.clearDebounceTimers();
    await this.client.close();
  }

  getSnapshot(): McpSessionSnapshot {
    return snapshot(this.tools, this.resources, this.prompts);
  }

  getClient(): McpClient {
    return this.client;
  }

  onChange(handler: McpSessionChangeHandler): void {
    this.changeHandlers.push(handler);
  }

  watchResource(uri: string, callback: McpResourceWatcher): () => void {
    const existing = this.resourceWatchers.get(uri) ?? [];
    existing.push(callback);
    this.resourceWatchers.set(uri, existing);
    return () => {
      const current = this.resourceWatchers.get(uri) ?? [];
      const filtered = current.filter((cb) => cb !== callback);
      if (filtered.length === 0) {
        this.resourceWatchers.delete(uri);
      } else {
        this.resourceWatchers.set(uri, filtered);
      }
    };
  }

  private async refreshAll(
    client: McpClient,
    generation: number
  ): Promise<McpSessionSnapshot> {
    const capabilities = client.getServerCapabilities();
    const supports = (kind: "tools" | "resources" | "prompts"): boolean =>
      capabilities === undefined || capabilities[kind] !== undefined;
    const load = <T>(enabled: boolean, request: () => Promise<T[]>): Promise<T[]> =>
      enabled ? request() : Promise.resolve([]);

    const [tools, resources, prompts] = await Promise.all([
      load(supports("tools"), () => client.listTools()),
      load(supports("resources"), () => client.listResources()),
      load(supports("prompts"), () => client.listPrompts()),
    ]);
    if (!this.isCurrent(client, generation)) {
      throw new Error("MCP session is no longer active");
    }
    this.tools = tools;
    this.resources = resources;
    this.prompts = prompts;
    this.emitChange();
    return this.getSnapshot();
  }

  private async handleNotification(
    notification: McpNotification,
    client: McpClient,
    generation: number
  ): Promise<void> {
    if (!this.isCurrent(client, generation)) {
      return;
    }
    switch (notification.method) {
      case "tools/list_changed":
        this.debounceReload("tools", async () => {
          const tools = await client.listTools();
          if (!this.isCurrent(client, generation)) {
            return;
          }
          this.tools = tools;
          this.emitChange();
        });
        break;
      case "resources/list_changed":
        this.debounceReload("resources", async () => {
          const resources = await client.listResources();
          if (!this.isCurrent(client, generation)) {
            return;
          }
          this.resources = resources;
          this.emitChange();
          this.notifyResourceWatchers();
        });
        break;
      case "resources/updated":
        this.notifyResourceWatcher(notification.uri);
        break;
      case "prompts/list_changed":
        this.debounceReload("prompts", async () => {
          const prompts = await client.listPrompts();
          if (!this.isCurrent(client, generation)) {
            return;
          }
          this.prompts = prompts;
          this.emitChange();
        });
        break;
      default:
        break;
    }
  }

  private isCurrent(client: McpClient, generation: number): boolean {
    return this.client === client && this.generation === generation;
  }

  private emitChange(): void {
    const current = this.getSnapshot();
    for (const handler of this.changeHandlers) {
      handler(current);
    }
  }

  private notifyResourceWatchers(): void {
    for (const watchers of this.resourceWatchers.values()) {
      for (const watcher of watchers) {
        try {
          watcher("*");
        } catch {
          // A watcher must not break the MCP notification loop.
        }
      }
    }
  }

  private notifyResourceWatcher(uri: string): void {
    const watchers = this.resourceWatchers.get(uri);
    if (watchers) {
      for (const watcher of watchers) {
        try {
          watcher(uri);
        } catch {
          // A watcher must not break the MCP notification loop.
        }
      }
    }
  }

  private clearDebounceTimers(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private debounceReload(kind: string, reload: () => Promise<void>): void {
    const existing = this.debounceTimers.get(kind);
    if (existing) {
      clearTimeout(existing);
    }
    this.debounceTimers.set(
      kind,
      setTimeout(() => {
        this.debounceTimers.delete(kind);
        void reload().catch(() => undefined);
      }, McpServerSession.DEBOUNCE_MS)
    );
  }
}
