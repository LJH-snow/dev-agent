import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ModelProvider,
  ProviderConfig,
  ToolCall,
  ToolSchema,
} from "./types.js";

export interface OllamaProviderConfig extends ProviderConfig {}

interface OllamaWireToolCall {
  readonly function?: {
    readonly name?: string;
    readonly arguments?: unknown;
  };
}

interface OllamaResponse {
  readonly message?: {
    readonly content?: string | null;
    readonly tool_calls?: readonly OllamaWireToolCall[];
  };
}

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama" as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: OllamaProviderConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl?.replace(/\/$/, "") ?? "http://localhost:11434";
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatCompletion> {
    const response = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(toOllamaMessage),
        stream: false,
        ...(options.tools ? { tools: options.tools.map(toOllamaTool) } : {}),
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as OllamaResponse;
    const message = data.message;
    if (!message) {
      return { content: "" };
    }
    return {
      content: message.content ?? "",
      toolCalls: message.tool_calls?.map(parseOllamaToolCall),
    };
  }
}

export function createOllamaProvider(config: OllamaProviderConfig): OllamaProvider {
  return new OllamaProvider(config);
}

function toOllamaMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        function: {
          name: call.name,
          arguments: call.input,
        },
      })),
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toOllamaTool(tool: ToolSchema): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function parseOllamaToolCall(call: OllamaWireToolCall, index: number): ToolCall {
  return {
    id: `ollama-${index}`,
    name: call.function?.name ?? "unknown",
    input: call.function?.arguments ?? {},
  };
}
