import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ModelProvider,
  ProviderConfig,
  ToolCall,
  ToolSchema,
} from "./types.js";

export interface AnthropicProviderConfig extends ProviderConfig {}

type AnthropicContentBlock =
  | { readonly type: "text"; readonly text?: string }
  | {
      readonly type: "tool_use";
      readonly id?: string;
      readonly name?: string;
      readonly input?: unknown;
    };

interface AnthropicResponse {
  readonly content?: readonly AnthropicContentBlock[];
}

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: AnthropicProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl?.replace(/\/$/, "") ?? "https://api.anthropic.com";
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatCompletion> {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 1024,
      messages: toAnthropicMessages(messages),
    };
    if (system) {
      body.system = system;
    }
    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options.tools) {
      body.tools = options.tools.map(toAnthropicTool);
    }

    const response = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`Anthropic request failed (${response.status}): ${bodyText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const blocks = data.content ?? [];
    return {
      content: blocks
        .filter((block): block is Extract<AnthropicContentBlock, { type: "text" }> =>
          block.type === "text"
        )
        .map((block) => block.text ?? "")
        .filter(Boolean)
        .join("\n"),
      toolCalls: blocks
        .map((block, index): ToolCall | undefined => {
          if (block.type !== "tool_use") {
            return undefined;
          }
          return {
            id: block.id ?? `anthropic-${index}`,
            name: block.name ?? "unknown",
            input: block.input ?? {},
          };
        })
        .filter((call): call is ToolCall => call !== undefined),
    };
  }
}

export function createAnthropicProvider(config: AnthropicProviderConfig): AnthropicProvider {
  return new AnthropicProvider(config);
}

function toAnthropicMessages(messages: readonly ChatMessage[]): unknown[] {
  const result: unknown[] = [];
  const pendingToolResults: Record<string, unknown>[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) {
      return;
    }
    result.push({ role: "user", content: [...pendingToolResults] });
    pendingToolResults.length = 0;
  };

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: message.toolCallId ?? "",
        content: message.content,
      });
      continue;
    }

    flushToolResults();
    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      const content: Record<string, unknown>[] = [];
      if (message.content) {
        content.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input,
        });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  flushToolResults();
  return result;
}

function toAnthropicTool(tool: ToolSchema): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}
