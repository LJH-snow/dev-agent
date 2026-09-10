import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ModelProvider,
  ProviderConfig,
  ToolCall,
  ToolSchema,
} from "./types.js";

export interface OpenAIProviderConfig extends ProviderConfig {}

interface OpenAIWireFunction {
  readonly name: string;
  readonly arguments: string;
}

interface OpenAIWireToolCall {
  readonly id: string;
  readonly type?: string;
  readonly function: OpenAIWireFunction;
}

interface OpenAIResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly OpenAIWireToolCall[];
    };
  }[];
}

export class OpenAIProvider implements ModelProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: OpenAIProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl?.replace(/\/$/, "") ?? "https://api.openai.com/v1";
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatCompletion> {
    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(toOpenAIMessage),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        ...(options.tools ? { tools: options.tools.map(toOpenAITool) } : {}),
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const message = data.choices?.[0]?.message;
    if (!message) {
      return { content: "" };
    }
    return {
      content: message.content ?? "",
      toolCalls: message.tool_calls?.map(parseOpenAIToolCall),
    };
  }

  async streamChat(
    messages: readonly ChatMessage[],
    options: ChatOptions & { onToken?: (token: string) => void } = {}
  ): Promise<ChatCompletion> {
    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(toOpenAIMessage),
        stream: true,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        ...(options.tools ? { tools: options.tools.map(toOpenAITool) } : {}),
      }),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI stream request failed (${response.status}): ${body}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") break;
          try {
            const json = JSON.parse(data) as {
              choices?: readonly { delta?: { content?: string } }[];
            };
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              content += delta;
              options.onToken?.(delta);
            }
          } catch {
            // skip malformed
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { content };
  }
}

export function createOpenAIProvider(config: OpenAIProviderConfig): OpenAIProvider {
  return new OpenAIProvider(config);
}

function toOpenAIMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.input),
        },
      })),
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId ?? "",
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toOpenAITool(tool: ToolSchema): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function parseOpenAIToolCall(call: OpenAIWireToolCall): ToolCall {
  let input: unknown;
  try {
    input = JSON.parse(call.function.arguments);
  } catch {
    input = call.function.arguments;
  }
  return {
    id: call.id,
    name: call.function.name,
    input,
  };
}
