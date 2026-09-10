export interface McpClientConfig {
  readonly name?: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly rootDirectory?: string;
}

export interface McpClientCapabilities {
  readonly roots?: {
    readonly listChanged?: boolean;
  };
  readonly sampling?: Record<string, unknown>;
  readonly experimental?: Record<string, unknown>;
}

export interface McpServerCapabilities {
  readonly tools?: {
    readonly listChanged?: boolean;
  };
  readonly resources?: {
    readonly subscribe?: boolean;
    readonly listChanged?: boolean;
  };
  readonly prompts?: {
    readonly listChanged?: boolean;
  };
  readonly logging?: Record<string, unknown>;
  readonly experimental?: Record<string, unknown>;
}

export interface McpServerInfo {
  readonly name: string;
  readonly version?: string;
}

export interface McpInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: McpServerCapabilities;
  readonly serverInfo: McpServerInfo;
}

export type McpNotification =
  | { readonly method: "tools/list_changed" }
  | { readonly method: "resources/list_changed" }
  | { readonly method: "prompts/list_changed" }
  | {
      readonly method: "message";
      readonly level: string;
      readonly logger?: string;
      readonly data: unknown;
    }
  | {
      readonly method: "progress";
      readonly progressToken: string | number;
      readonly progress: number;
      readonly total?: number;
    }
  | {
      readonly method: "cancelled";
      readonly requestId: string | number;
      readonly reason?: string;
    };

export interface McpToolInfo {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly parameters?: Record<string, unknown>;
  execute(input: unknown): Promise<unknown>;
}

export interface McpToolResult {
  readonly content?: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

export interface McpResourceInfo {
  readonly uri: string;
  readonly name?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpResourceContents {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly blob?: string;
}

export interface McpResource {
  readonly info: McpResourceInfo;
  read(): Promise<McpResourceContents>;
}

export interface McpPromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface McpPromptInfo {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly McpPromptArgument[];
}

export interface McpPromptMessage {
  readonly role: string;
  readonly content: unknown;
}

export interface McpPromptResult {
  readonly description?: string;
  readonly messages?: readonly McpPromptMessage[];
}

export interface McpPrompt {
  readonly info: McpPromptInfo;
  get(
    args?: Readonly<Record<string, string | number | boolean>>
  ): Promise<McpPromptResult>;
}

export interface McpClient {
  connect(config: McpClientConfig): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, input: unknown): Promise<McpToolResult>;
  listResources(): Promise<McpResource[]>;
  readResource(uri: string): Promise<McpResourceContents>;
  listPrompts(): Promise<McpPrompt[]>;
  getPrompt(
    name: string,
    args?: Readonly<Record<string, string | number | boolean>>
  ): Promise<McpPromptResult>;
  ping(): Promise<void>;
  close(): Promise<void>;
  getServerCapabilities(): McpServerCapabilities | undefined;
  getServerInfo(): McpServerInfo | undefined;
  onNotification(handler: (notification: McpNotification) => void): void;
  reconnect(): Promise<void>;
}
