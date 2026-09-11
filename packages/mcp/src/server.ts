/**
 * Minimal MCP server over stdio.
 *
 * Speaks the same newline-delimited JSON-RPC 2.0 framing that the client in
 * `stdio-client.ts` expects, and exposes whatever tools the caller passes in.
 * Tool implementations stay outside this package: the CLI wires the built-in
 * tools so the MCP layer has no dependency on them.
 */

export interface McpServerTool {
  readonly name: string;
  readonly description: string;
  readonly parameters?: Record<string, unknown>;
  execute(
    input: unknown,
    context?: { readonly sessionId: string; readonly workingDirectory: string }
  ): Promise<unknown>;
}

export interface McpServerResource {
  readonly uri: string;
  readonly name?: string;
  readonly description?: string;
  readonly mimeType?: string;
  read(): Promise<string> | string;
}

export interface McpServerPromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface McpServerPromptMessage {
  readonly role: "user" | "assistant";
  readonly content: { readonly type: "text"; readonly text: string };
}

export interface McpServerPromptResult {
  readonly description?: string;
  readonly messages: readonly McpServerPromptMessage[];
}

export interface McpServerPrompt {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly McpServerPromptArgument[];
  get(
    args?: Readonly<Record<string, string>>
  ): Promise<McpServerPromptResult> | McpServerPromptResult;
}

export interface McpServerOptions {
  readonly tools: readonly McpServerTool[];
  readonly resources?: readonly McpServerResource[];
  readonly prompts?: readonly McpServerPrompt[];
  readonly name?: string;
  readonly version?: string;
  readonly sessionId?: string;
  readonly workingDirectory?: string;
  readonly input?: McpServerInput;
  readonly output?: McpServerOutput;
}

/** The slice of a readable stream the server needs; `process.stdin` fits. */
export interface McpServerInput {
  on(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
}

/** The slice of a writable stream the server needs; `process.stdout` fits. */
export interface McpServerOutput {
  write(chunk: string): unknown;
}

export interface McpServer {
  /** Handles one JSON-RPC message; resolves to the response line when one is due. */
  handleMessage(message: string): Promise<string | undefined>;
  /** Pumps input into the handler and writes responses to output until EOF. */
  start(): Promise<void>;
}

interface JsonRpcMessage {
  readonly jsonrpc?: string;
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
}

const PROTOCOL_VERSION = "2024-11-05";
const JSON_RPC_VERSION = "2.0";

class McpServerError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "McpServerError";
    this.code = code;
  }
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const tools = [...options.tools];
  const resources = [...(options.resources ?? [])];
  const prompts = [...(options.prompts ?? [])];
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const serverName = options.name ?? "dev-agent";
  const serverVersion = options.version ?? "0.1.0";
  const sessionId = options.sessionId ?? "mcp-server";
  const workingDirectory = options.workingDirectory ?? process.cwd();

  async function dispatch(request: JsonRpcMessage): Promise<unknown> {
    switch (request.method) {
      case "initialize":
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: { name: serverName, version: serverVersion },
        };
      case "notifications/initialized":
      case "notifications/cancelled":
        return undefined;
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters ?? { type: "object", properties: {} },
          })),
        };
      case "resources/list":
        return {
          resources: resources.map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
          })),
        };
      case "resources/read": {
        const params = asRecord(request.params);
        const uri = typeof params.uri === "string" ? params.uri : "";
        const resource = resources.find((candidate) => candidate.uri === uri);
        if (!resource) {
          throw new McpServerError(-32602, `unknown resource: ${uri}`);
        }
        const text = await resource.read();
        return {
          contents: [{ uri, mimeType: resource.mimeType ?? "text/plain", text }],
        };
      }
      case "prompts/list":
        return {
          prompts: prompts.map((prompt) => ({
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments ?? [],
          })),
        };
      case "prompts/get": {
        const params = asRecord(request.params);
        const name = typeof params.name === "string" ? params.name : "";
        const prompt = prompts.find((candidate) => candidate.name === name);
        if (!prompt) {
          throw new McpServerError(-32602, `unknown prompt: ${name}`);
        }
        return await prompt.get(asStringRecord(params.arguments));
      }
      case "tools/call": {
        const params = asRecord(request.params);
        const name = typeof params.name === "string" ? params.name : "";
        const tool = toolsByName.get(name);
        if (!tool) {
          throw new McpServerError(-32602, `unknown tool: ${name}`);
        }
        try {
          const result = await tool.execute(params.arguments, { sessionId, workingDirectory });
          return {
            content: [{ type: "text", text: stringifyResult(result) }],
            structuredContent: result,
          };
        } catch (error) {
          // Tool execution failures are results, not protocol errors, so the
          // host model can see what went wrong and react.
          return {
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
            isError: true,
          };
        }
      }
      default:
        throw new McpServerError(
          -32601,
          `method not found: ${request.method ?? "(missing)"}`
        );
    }
  }

  async function handleMessage(message: string): Promise<string | undefined> {
    const trimmed = message.trim();
    if (!trimmed) {
      return undefined;
    }

    let request: JsonRpcMessage;
    try {
      request = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      return errorResponse(null, -32700, "parse error");
    }

    const id = request.id;
    const isNotification = id === undefined;

    try {
      const result = await dispatch(request);
      if (isNotification || result === undefined) {
        return undefined;
      }
      return JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id, result });
    } catch (error) {
      if (isNotification) {
        return undefined;
      }
      if (error instanceof McpServerError) {
        return errorResponse(id, error.code, error.message);
      }
      return errorResponse(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }

  async function start(): Promise<void> {
    // Annotated so the union with `process.stdin`/`stdout` collapses to the
    // structural types this module actually uses.
    const input: McpServerInput = options.input ?? process.stdin;
    const output: McpServerOutput = options.output ?? process.stdout;
    let buffer = "";
    let chain: Promise<void> = Promise.resolve();

    const enqueue = (line: string): void => {
      if (!line.trim()) {
        return;
      }
      chain = chain.then(async () => {
        const response = await handleMessage(line);
        if (response !== undefined) {
          output.write(`${response}\n`);
        }
      });
    };

    await new Promise<void>((resolve, reject) => {
      input.on("data", (chunk: string | Buffer) => {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) {
            break;
          }
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          enqueue(line);
        }
      });
      input.on("end", () => {
        if (buffer.trim()) {
          enqueue(buffer);
        }
        chain.then(resolve, reject);
      });
      input.on("error", reject);
    });
  }

  return { handleMessage, start };
}

function errorResponse(id: number | string | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id, error: { code, message } });
}

function stringifyResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  try {
    return JSON.stringify(result ?? null);
  } catch {
    return String(result);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof value !== "object" || value === null) {
    return result;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") {
      result[key] = entry;
    }
  }
  return result;
}
