import { requestWithRetry, type RetryOptions } from "./retry.js";
import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ChatUsage,
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

interface OpenAIWireUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
}

interface OpenAIResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly OpenAIWireToolCall[];
    };
  }[];
  readonly usage?: OpenAIWireUsage;
}

interface OpenAIStreamToolCallDelta {
  readonly index?: number;
  readonly id?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

export class OpenAIProvider implements ModelProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly retry?: RetryOptions;

  constructor(config: OpenAIProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl?.replace(/\/$/, "") ?? "https://api.openai.com/v1";
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.retry = config.retry;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatCompletion> {
    const response = await requestWithRetry(
      "OpenAI request",
      () =>
        this.fetchFn(`${this.baseUrl}/chat/completions`, {
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
        }),
      { ...this.retry, signal: options.signal ?? this.retry?.signal }
    );

    const data = (await response.json()) as OpenAIResponse;
    const usage = parseOpenAIUsage(data.usage);
    const message = data.choices?.[0]?.message;
    if (!message) {
      return { content: "", usage };
    }
    return {
      content: message.content ?? "",
      toolCalls: message.tool_calls?.map(parseOpenAIToolCall),
      usage,
    };
  }

  async streamChat(
    messages: readonly ChatMessage[],
    options: ChatOptions & { onToken?: (token: string) => void } = {}
  ): Promise<ChatCompletion> {
    const response = await requestWithRetry(
      "OpenAI stream request",
      () =>
        this.fetchFn(`${this.baseUrl}/chat/completions`, {
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
        }),
      { ...this.retry, signal: options.signal ?? this.retry?.signal }
    );

    if (!response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI stream request failed (${response.status}): ${body}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";
    let finished = false;
    let usage: ChatUsage | undefined;
    const toolCallDeltas = new Map<number, { id: string; name: string; args: string }>();

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) return;
      const data = trimmed.slice(6);
      if (data === "[DONE]") {
        finished = true;
        return;
      }
      try {
        const json = JSON.parse(data) as {
          choices?: readonly {
            delta?: {
              content?: string;
              tool_calls?: readonly OpenAIStreamToolCallDelta[];
            };
          }[];
          usage?: OpenAIWireUsage;
        };
        if (json.usage) {
          usage = parseOpenAIUsage(json.usage);
        }
        const delta = json.choices?.[0]?.delta;
        if (!delta) return;
        if (delta.content) {
          content += delta.content;
          options.onToken?.(delta.content);
        }
        for (const call of delta.tool_calls ?? []) {
          const index = call.index ?? 0;
          const accumulated = toolCallDeltas.get(index) ?? { id: "", name: "", args: "" };
          if (call.id) accumulated.id = call.id;
          if (call.function?.name) accumulated.name = call.function.name;
          if (call.function?.arguments) accumulated.args += call.function.arguments;
          toolCallDeltas.set(index, accumulated);
        }
      } catch {
        // skip malformed
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          handleLine(line);
          if (finished) break;
        }
        if (finished) break;
      }
      // A stream may end without a trailing newline; flush the final event.
      if (!finished && buffer.length > 0) {
        handleLine(buffer);
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls = [...toolCallDeltas.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, accumulated]) =>
        parseOpenAIToolCall({
          id: accumulated.id || `openai-${index}`,
          function: { name: accumulated.name, arguments: accumulated.args },
        })
      );

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage };
  }
}

function parseOpenAIUsage(usage: OpenAIWireUsage | undefined): ChatUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
  };
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
