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
    this.client = this.createClient();
    this.client.onNotification((notification) => void this.handleNotification(notification));
    await this.client.connect(this.config);
    return this.refreshAll();
  }

  async reconnect(): Promise<McpSessionSnapshot> {
    await this.client.close();
    return this.connect();
  }

  async close(): Promise<void> {
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

  private async refreshAll(): Promise<McpSessionSnapshot> {
    const [tools, resources, prompts] = await Promise.all([
      this.client.listTools(),
      this.client.listResources(),
      this.client.listPrompts(),
    ]);
    this.tools = tools;
    this.resources = resources;
    this.prompts = prompts;
    this.emitChange();
    return this.getSnapshot();
  }

  private async handleNotification(notification: McpNotification): Promise<void> {
    switch (notification.method) {
      case "tools/list_changed":
        this.tools = await this.client.listTools();
        this.emitChange();
        break;
      case "resources/list_changed":
        this.resources = await this.client.listResources();
        this.emitChange();
        break;
      case "prompts/list_changed":
        this.prompts = await this.client.listPrompts();
        this.emitChange();
        break;
      default:
        break;
    }
  }

  private emitChange(): void {
    const current = this.getSnapshot();
    for (const handler of this.changeHandlers) {
      handler(current);
    }
  }
}
