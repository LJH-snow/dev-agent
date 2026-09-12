import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type {
  McpClient,
  McpClientConfig,
  McpClientCapabilities,
  McpInitializeResult,
  McpNotification,
  McpPrompt,
  McpPromptInfo,
  McpPromptResult,
  McpResource,
  McpResourceContents,
  McpResourceInfo,
  McpServerCapabilities,
  McpServerInfo,
  McpTool,
  McpToolInfo,
  McpToolResult,
} from "./types.js";

interface JsonRpcMessage {
  readonly jsonrpc?: string;
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
  };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

type NotificationHandler = (notification: McpNotification) => void;

export class McpStdioClient implements McpClient {
  private child?: ChildProcessWithoutNullStreams;
  private config?: McpClientConfig;
  private initializeResult?: McpInitializeResult;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = "";
  private notificationHandlers: NotificationHandler[] = [];
  private closed = false;

  async connect(config: McpClientConfig): Promise<void> {
    if (this.child) {
      throw new Error("MCP client is already connected");
    }
    this.config = config;
    // `close()` sets this; a reconnect must clear it or a later crash would
    // leave pending requests hanging instead of rejecting them.
    this.closed = false;
    this.buffer = "";

    const child = spawn(config.command, [...(config.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...config.env },
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleData(chunk));
    child.on("error", (error) => {
      this.rejectAll(error);
    });
    child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.rejectAll(new Error(`MCP server exited (code=${code} signal=${signal ?? "none"})`));
      }
    });

    const result = (await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: this.clientCapabilities(config),
      clientInfo: { name: "dev-agent", version: "0.1.0" },
    })) as McpInitializeResult | undefined;

    this.initializeResult = result ?? {
      protocolVersion: "2024-11-05",
      capabilities: {},
      serverInfo: { name: config.name ?? "unknown", version: "unknown" },
    };

    this.notify("notifications/initialized", {});
  }

  async reconnect(): Promise<void> {
    const config = this.config;
    if (!config) {
      throw new Error("MCP client has no previous configuration to reconnect");
    }
    await this.close();
    await this.connect(config);
  }

  getServerCapabilities(): McpServerCapabilities | undefined {
    return this.initializeResult?.capabilities;
  }

  getServerInfo(): McpServerInfo | undefined {
    return this.initializeResult?.serverInfo;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandlers.push(handler);
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.request("tools/list", {})) as
      | { readonly tools?: readonly McpToolInfo[] }
      | undefined;
    return (result?.tools ?? []).map((info) => createMcpTool(this, info));
  }

  async callTool(name: string, input: unknown): Promise<McpToolResult> {
    const result = (await this.request("tools/call", {
      name,
      arguments: input,
    })) as McpToolResult | undefined;
    const toolResult = result ?? { content: [] };
    if (toolResult.isError) {
      throw new McpRequestError(-32603, `MCP tool "${name}" reported an error`);
    }
    return toolResult;
  }

  isConnected(): boolean {
    return this.child !== undefined;
  }

  get pendingRequestCount(): number {
    return this.pending.size;
  }

  async listResources(): Promise<McpResource[]> {
    const result = (await this.request("resources/list", {})) as
      | { readonly resources?: readonly McpResourceInfo[] }
      | undefined;
    return (result?.resources ?? []).map((info) => createMcpResource(this, info));
  }

  /**
   * All content blocks the server returned, in order. `resources/read` may
   * answer with several (a directory read, or text plus a blob), and callers
   * that only looked at the first block used to lose the rest silently.
   */
  async readResourceContents(uri: string): Promise<readonly McpResourceContents[]> {
    if (!uri.trim()) {
      throw new Error("MCP readResourceContents uri must be a non-empty string");
    }

    const result = (await this.request("resources/read", { uri })) as
      | { readonly contents?: readonly McpResourceContents[] }
      | undefined;
    return result?.contents ?? [];
  }

  /**
   * Convenience wrapper for the common single-block case. Use
   * `readResourceContents()` when the resource may answer with several blocks;
   * this method intentionally returns only the first one.
   */
  async readResource(uri: string): Promise<McpResourceContents> {
    const contents = await this.readResourceContents(uri);
    return contents[0] ?? { uri };
  }

  async listPrompts(): Promise<McpPrompt[]> {
    const result = (await this.request("prompts/list", {})) as
      | { readonly prompts?: readonly McpPromptInfo[] }
      | undefined;
    return (result?.prompts ?? []).map((info) => createMcpPrompt(this, info));
  }

  async getPrompt(
    name: string,
    args?: Readonly<Record<string, string | number | boolean>>
  ): Promise<McpPromptResult> {
    if (!name.trim()) {
      throw new Error("MCP getPrompt name must be a non-empty string");
    }

    const result = (await this.request("prompts/get", {
      name,
      arguments: args,
    })) as McpPromptResult | undefined;
    return result ?? { messages: [] };
  }

  async ping(): Promise<void> {
    await this.request("ping", {});
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    this.child = undefined;
    this.closed = true;
    this.initializeResult = undefined;
    this.rejectAll(new Error("MCP client closed"));
    child.stdin.end();
    await Promise.race([
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      }),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          child.kill();
          resolve();
        }, 500);
      }),
    ]);
  }

  private clientCapabilities(config: McpClientConfig): McpClientCapabilities {
    return {
      roots: { listChanged: true },
      ...(config.rootDirectory
        ? {}
        : {}),
    };
  }

  private roots(): ReadonlyArray<{ uri: string; name?: string }> {
    const root = this.config?.rootDirectory ?? process.cwd();
    return [{ uri: `file://${root}`, name: "workspace" }];
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (!this.child) {
        this.pending.delete(id);
        reject(new Error("MCP client is not connected"));
        return;
      }
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.child) {
      return;
    }
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        this.handleLine(trimmed);
      }
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (typeof message.id === "number" && message.id > 0) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new McpRequestError(message.error.code, message.error.message ?? "MCP request failed"));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
    }

    if (message.method === "roots/list" && message.id !== undefined) {
      this.respond(message.id, { roots: this.roots() });
      return;
    }

    if (message.method && message.id === undefined) {
      const notification = parseNotification(message.method, message.params);
      if (notification) {
        for (const handler of this.notificationHandlers) {
          handler(notification);
        }
      }
    }
  }

  private respond(id: number | string, result: unknown): void {
    if (!this.child) {
      return;
    }
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  private rejectAll(error: unknown): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function parseNotification(
  method: string,
  params: unknown
): McpNotification | undefined {
  switch (method) {
    case "notifications/tools/list_changed":
      return { method: "tools/list_changed" };
    case "notifications/resources/list_changed":
      return { method: "resources/list_changed" };
    case "notifications/prompts/list_changed":
      return { method: "prompts/list_changed" };
    case "notifications/cancelled": {
      const record = asRecord(params);
      const id = record.requestId ?? record.requestid;
      return {
        method: "cancelled",
        requestId: typeof id === "number" ? id : String(id ?? ""),
        reason: typeof record.reason === "string" ? record.reason : undefined,
      };
    }
    case "notifications/progress": {
      const record = asRecord(params);
      const token = record.progressToken ?? record.progress_token;
      const total = record.total;
      return {
        method: "progress",
        progressToken: typeof token === "number" ? token : String(token ?? ""),
        progress: typeof record.progress === "number" ? record.progress : 0,
        total: typeof total === "number" ? total : undefined,
      };
    }
    case "notifications/message": {
      const record = asRecord(params);
      return {
        method: "message",
        level: typeof record.level === "string" ? record.level : "info",
        logger: typeof record.logger === "string" ? record.logger : undefined,
        data: record.data,
      };
    }
    default:
      return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

export class McpRequestError extends Error {
  readonly code: number | undefined;

  constructor(code: number | undefined, message: string) {
    super(message);
    this.name = "McpRequestError";
    this.code = code;
  }
}

export function createMcpTool(client: McpClient, info: McpToolInfo): McpTool {
  return {
    name: info.name,
    description: info.description ?? "",
    parameters: info.inputSchema,
    async execute(input: unknown) {
      return client.callTool(info.name, input);
    },
  };
}

export function createMcpResource(client: McpClient, info: McpResourceInfo): McpResource {
  return {
    info,
    async read() {
      return client.readResource(info.uri);
    },
  };
}

export function createMcpPrompt(client: McpClient, info: McpPromptInfo): McpPrompt {
  return {
    info,
    async get(args) {
      return client.getPrompt(info.name, args);
    },
  };
}
