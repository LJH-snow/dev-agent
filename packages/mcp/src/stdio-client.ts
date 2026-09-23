import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  assertFrameSize,
  DEFAULT_MCP_MAX_FRAME_BYTES,
  McpFrameTooLargeError,
  resolveMaxFrameBytes,
} from "./framing.js";

import type {
  McpClient,
  McpCallOptions,
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
  McpToolProgress,
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
  timer?: NodeJS.Timeout;
  signal?: AbortSignal;
  abortHandler?: () => void;
  progressToken?: string | number;
  onProgress?: (progress: McpToolProgress) => void;
}

interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: McpToolProgress) => void;
}

/** How long any single MCP request may stay unanswered. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** JSON-RPC-ish code used for client-side timeouts (not sent by the server). */
const REQUEST_TIMEOUT_CODE = -32000;
/** JSON-RPC-ish code used when the caller aborts a request. */
const REQUEST_ABORTED_CODE = -32001;

type NotificationHandler = (notification: McpNotification) => void;

export class McpStdioClient implements McpClient {
  private child?: ChildProcessWithoutNullStreams;
  private config?: McpClientConfig;
  private initializeResult?: McpInitializeResult;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly progressRequests = new Map<string | number, number>();
  private nextId = 1;
  private buffer = "";
  private frameBufferBytes = 0;
  private maxFrameBytes = DEFAULT_MCP_MAX_FRAME_BYTES;
  private notificationHandlers: NotificationHandler[] = [];
  private closed = false;
  private reconnectPromise: Promise<void> | undefined;

  async connect(config: McpClientConfig): Promise<void> {
    if (this.child) {
      throw new Error("MCP client is already connected");
    }
    this.config = config;
    // `close()` sets this; a reconnect must clear it or a later crash would
    // leave pending requests hanging instead of rejecting them.
    this.closed = false;
    this.buffer = "";
    this.frameBufferBytes = 0;
    this.maxFrameBytes = resolveMaxFrameBytes(config.maxFrameBytes);
    this.initializeResult = undefined;

    const child = spawn(config.command, [...(config.args ?? [])], {
      // The project root is both the MCP roots capability and the process
      // boundary. Without cwd, a server launched by an external project would
      // inherit the host application's directory instead.
      cwd: config.rootDirectory,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...config.env },
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      // A previous child may still flush data after close/reconnect. Never let
      // that stale stream feed the new session's JSON-RPC decoder.
      if (this.child === child) {
        try {
          this.handleData(chunk);
        } catch (error) {
          this.failProtocol(error, child);
        }
      }
    });
    child.on("error", (error) => {
      if (this.child !== child) {
        return;
      }
      this.closed = true;
      this.initializeResult = undefined;
      this.rejectAll(error);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) {
        return;
      }
      this.child = undefined;
      this.closed = true;
      this.initializeResult = undefined;
      this.rejectAll(new Error(`MCP server exited (code=${code} signal=${signal ?? "none"})`));
    });

    let result: McpInitializeResult | undefined;
    try {
      result = (await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: this.clientCapabilities(config),
        clientInfo: { name: "dev-agent", version: "0.1.0" },
      })) as McpInitializeResult | undefined;
    } catch (error) {
      // A half-open connection would keep the spawned child (and therefore the
      // whole process) alive after the caller has already given up. Tear it
      // down before surfacing the failure.
      await this.close().catch(() => undefined);
      throw error;
    }

    this.initializeResult = result ?? {
      protocolVersion: "2024-11-05",
      capabilities: {},
      serverInfo: { name: config.name ?? "unknown", version: "unknown" },
    };

    this.notify("notifications/initialized", {});
  }

  async reconnect(): Promise<void> {
    if (this.reconnectPromise) {
      return this.reconnectPromise;
    }

    const reconnectPromise = this.reconnectOnce();
    this.reconnectPromise = reconnectPromise;
    try {
      await reconnectPromise;
    } finally {
      if (this.reconnectPromise === reconnectPromise) {
        this.reconnectPromise = undefined;
      }
    }
  }

  private async reconnectOnce(): Promise<void> {
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

  async callTool(
    name: string,
    input: unknown,
    options: McpCallOptions = {}
  ): Promise<McpToolResult> {
    const result = (await this.request("tools/call", {
      name,
      arguments: input,
    }, options)) as McpToolResult | undefined;
    const toolResult = result ?? { content: [] };
    if (toolResult.isError) {
      // `isError` results carry the server's own explanation in `content`;
      // dropping it left the caller (and the model reading the tool result)
      // with only "reported an error", with no way to adapt.
      const detail = toolErrorDetail(toolResult);
      throw new McpRequestError(
        -32603,
        detail
          ? `MCP tool "${name}" failed: ${detail}`
          : `MCP tool "${name}" reported an error`
      );
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
    try {
      const result = (await this.request("resources/list", {})) as
        | { readonly resources?: readonly McpResourceInfo[] }
        | undefined;
      return (result?.resources ?? []).map((info) => createMcpResource(this, info));
    } catch (error) {
      // MCP servers may advertise the resources capability while omitting the
      // optional discovery method. Treat that partial implementation as an
      // empty resource list, but preserve all other failures.
      if (isMethodNotFoundError(error)) {
        return [];
      }
      throw error;
    }
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
    try {
      const result = (await this.request("prompts/list", {})) as
        | { readonly prompts?: readonly McpPromptInfo[] }
        | undefined;
      return (result?.prompts ?? []).map((info) => createMcpPrompt(this, info));
    } catch (error) {
      // Keep optional prompt discovery compatible with servers that expose
      // prompts only through tools or do not implement prompts/list yet.
      if (isMethodNotFoundError(error)) {
        return [];
      }
      throw error;
    }
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

  private request(
    method: string,
    params: unknown,
    options: RequestOptions = {}
  ): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      // A server that never answers used to leave this promise pending
      // forever, which hung `connect()` (and therefore the whole CLI at
      // startup) with no output at all.
      const timeoutMs = this.config?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      if (options.signal?.aborted) {
        reject(
          new McpRequestError(
            REQUEST_ABORTED_CODE,
            `MCP request "${method}" was aborted`
          )
        );
        return;
      }
      const progressToken = options.onProgress ? id : undefined;
      const pending: PendingRequest = {
        resolve,
        reject,
        signal: options.signal,
        progressToken,
        onProgress: options.onProgress,
      };
      this.pending.set(id, pending);
      if (progressToken !== undefined) {
        this.progressRequests.set(progressToken, id);
      }

      const abortHandler = (): void => {
        this.cancelRequest(
          id,
          "request aborted",
          new McpRequestError(
            REQUEST_ABORTED_CODE,
            `MCP request "${method}" was aborted`
          )
        );
      };
      pending.abortHandler = abortHandler;
      if (options.signal) {
        if (options.signal.aborted) {
          abortHandler();
          return;
        }
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      pending.timer = setTimeout(() => {
        this.cancelRequest(
          id,
          "request timed out",
          new McpRequestError(
            REQUEST_TIMEOUT_CODE,
            `MCP request "${method}" timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      if (!this.child) {
        const removed = this.removePending(id);
        removed?.reject(new Error("MCP client is not connected"));
        return;
      }
      const requestParams = progressToken === undefined
        ? params
        : {
            ...asRecord(params),
            _meta: {
              ...asRecord(asRecord(params)._meta),
              progressToken,
            },
          };
      try {
        this.sendMessage({ jsonrpc: "2.0", id, method, params: requestParams });
      } catch (error) {
        const removed = this.removePending(id);
        removed?.reject(error);
      }
    });
  }

  private cancelRequest(id: number, reason: string, error: McpRequestError): void {
    const pending = this.removePending(id);
    if (!pending) {
      return;
    }
    this.sendCancellation(id, reason);
    pending.reject(error);
  }

  private sendCancellation(id: number, reason: string): void {
    try {
      this.notify("notifications/cancelled", { requestId: id, reason });
    } catch {
      // The original abort or timeout is the useful error. A closed stdin
      // must not replace it with a write failure.
    }
  }

  private removePending(id: number): PendingRequest | undefined {
    const pending = this.pending.get(id);
    if (!pending) {
      return undefined;
    }
    this.pending.delete(id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener("abort", pending.abortHandler);
    }
    if (pending.progressToken !== undefined) {
      this.progressRequests.delete(pending.progressToken);
    }
    return pending;
  }

  private notify(method: string, params: unknown): void {
    if (!this.child) {
      return;
    }
    this.sendMessage({ jsonrpc: "2.0", method, params });
  }

  private handleData(chunk: string): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf("\n", offset);
      const end = newline < 0 ? chunk.length : newline;
      const segment = chunk.slice(offset, end);
      const segmentBytes = Buffer.byteLength(segment, "utf8");
      const nextFrameBytes = this.frameBufferBytes + segmentBytes;
      if (nextFrameBytes > this.maxFrameBytes) {
        throw new McpFrameTooLargeError(nextFrameBytes, this.maxFrameBytes);
      }
      this.buffer += segment;
      this.frameBufferBytes = nextFrameBytes;

      if (newline < 0) {
        return;
      }

      const line = this.buffer;
      this.buffer = "";
      this.frameBufferBytes = 0;
      offset = newline + 1;
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
        this.removePending(message.id);
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
        if (notification.method === "progress") {
          const requestId = this.progressRequests.get(notification.progressToken);
          const pending = requestId === undefined ? undefined : this.pending.get(requestId);
          if (pending?.onProgress) {
            try {
              pending.onProgress({
                progress: notification.progress,
                total: notification.total,
              });
            } catch {
              // A consumer callback must not break the MCP read loop.
            }
          }
        }
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
    this.sendMessage({ jsonrpc: "2.0", id, result });
  }

  private sendMessage(message: Record<string, unknown>): void {
    if (!this.child) {
      return;
    }
    const frame = JSON.stringify(message);
    assertFrameSize(frame, this.maxFrameBytes);
    this.child.stdin.write(`${frame}\n`);
  }

  private failProtocol(error: unknown, child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) {
      return;
    }
    this.child = undefined;
    this.closed = true;
    this.initializeResult = undefined;
    this.buffer = "";
    this.frameBufferBytes = 0;
    this.rejectAll(error);
    child.stdin.destroy();
    child.kill();
  }

  private rejectAll(error: unknown): void {
    for (const id of [...this.pending.keys()]) {
      const pending = this.removePending(id);
      pending?.reject(error);
    }
    this.progressRequests.clear();
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

function isMethodNotFoundError(error: unknown): error is McpRequestError {
  return error instanceof McpRequestError && error.code === -32601;
}

export function createMcpTool(client: McpClient, info: McpToolInfo): McpTool {
  return {
    name: info.name,
    description: info.description ?? "",
    parameters: info.inputSchema,
    async execute(input: unknown, context) {
      return client.callTool(info.name, input, {
        signal: context?.signal,
        onProgress: context?.onProgress,
      });
    },
  };
}

/** How much of a server's error text is worth embedding in an error message. */
const MAX_TOOL_ERROR_CHARS = 2000;

/**
 * Concatenates the text blocks of a failed `tools/call` result so the caller
 * sees the server's actual explanation. A long result is truncated rather than
 * pasted whole, since the point is the reason, not the payload.
 */
function toolErrorDetail(result: McpToolResult): string | undefined {
  const text = (result.content ?? [])
    .map((block) => {
      if (typeof block !== "object" || block === null) {
        return "";
      }
      const candidate = block as { readonly type?: unknown; readonly text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string"
        ? candidate.text
        : "";
    })
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
  if (!text) {
    return undefined;
  }
  return text.length > MAX_TOOL_ERROR_CHARS
    ? `${text.slice(0, MAX_TOOL_ERROR_CHARS)}… (truncated)`
    : text;
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
