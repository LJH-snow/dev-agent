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
  readonly usage?: AnthropicWireUsage;
}

interface AnthropicWireUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly retry?: RetryOptions;

  constructor(config: AnthropicProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl?.replace(/\/$/, "") ?? "https://api.anthropic.com";
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.retry = config.retry;
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

    const response = await requestWithRetry(
      "Anthropic request",
      () =>
        this.fetchFn(`${this.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
          },
          body: JSON.stringify(body),
          signal: options.signal,
        }),
      { ...this.retry, signal: options.signal ?? this.retry?.signal }
    );

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
      usage: applyAnthropicUsage(undefined, data.usage),
    };
  }

  async streamChat(
    messages: readonly ChatMessage[],
    options: ChatOptions & { onToken?: (token: string) => void } = {}
  ): Promise<ChatCompletion> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 1024,
      stream: true,
      messages: toAnthropicMessages(messages),
    };
    if (system) body.system = system;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.tools) body.tools = options.tools.map(toAnthropicTool);

    const response = await requestWithRetry(
      "Anthropic stream request",
      () =>
        this.fetchFn(`${this.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
          },
          body: JSON.stringify(body),
          signal: options.signal,
        }),
      { ...this.retry, signal: options.signal ?? this.retry?.signal }
    );

    if (!response.body) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Anthropic stream request failed (${response.status}): ${bodyText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";
    let usage: ChatUsage | undefined;
    const toolUses = new Map<number, { id: string; name: string; json: string }>();

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) return;
      const data = trimmed.slice(6);
      try {
        const json = JSON.parse(data) as {
          type?: string;
          index?: number;
          content_block?: { type?: string; id?: string; name?: string };
          delta?: { type?: string; text?: string; partial_json?: string };
          message?: { usage?: AnthropicWireUsage };
          usage?: AnthropicWireUsage;
        };
        usage = applyAnthropicUsage(usage, json.message?.usage);
        usage = applyAnthropicUsage(usage, json.usage);
        if (json.content_block?.type === "tool_use") {
          const index = json.index ?? 0;
          toolUses.set(index, {
            id: json.content_block.id ?? `anthropic-${index}`,
            name: json.content_block.name ?? "unknown",
            json: "",
          });
        }
        if (json.delta?.type === "input_json_delta" && json.delta.partial_json) {
          const accumulated = toolUses.get(json.index ?? 0);
          if (accumulated) {
            accumulated.json += json.delta.partial_json;
          }
        }
        const text = json.delta?.text;
        if (text) {
          content += text;
          options.onToken?.(text);
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
        }
      }
      // A stream may end without a trailing newline; flush the final event.
      if (buffer.length > 0) {
        handleLine(buffer);
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls = [...toolUses.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, accumulated]) => ({
        id: accumulated.id,
        name: accumulated.name,
        input: parseJsonOrRaw(accumulated.json),
      }));

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage };
  }
}

/**
 * Anthropic reports input tokens when the message starts and output tokens as
 * it progresses, so both events are merged into one running total.
 */
function applyAnthropicUsage(
  current: ChatUsage | undefined,
  wire: AnthropicWireUsage | undefined
): ChatUsage | undefined {
  if (!wire) {
    return current;
  }
  // Anthropic reports cache reads and cache writes separately from
  // `input_tokens`; both are prompt tokens, and cache reads are the discounted
  // part. Only the event carrying `input_tokens` contributes them, so a later
  // output-only event cannot double count.
  const hasInput = typeof wire.input_tokens === "number";
  const promptTokens = hasInput
    ? wire.input_tokens! +
      (wire.cache_creation_input_tokens ?? 0) +
      (wire.cache_read_input_tokens ?? 0)
    : current?.promptTokens ?? 0;
  const cachedPromptTokens =
    (hasInput ? wire.cache_read_input_tokens : undefined) ??
    current?.cachedPromptTokens ??
    0;
  const cacheCreationPromptTokens =
    (hasInput ? wire.cache_creation_input_tokens : undefined) ??
    current?.cacheCreationPromptTokens ??
    0;
  const completionTokens = wire.output_tokens ?? current?.completionTokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...(cachedPromptTokens > 0 ? { cachedPromptTokens } : {}),
    ...(cacheCreationPromptTokens > 0 ? { cacheCreationPromptTokens } : {}),
  };
}

export function createAnthropicProvider(config: AnthropicProviderConfig): AnthropicProvider {
  return new AnthropicProvider(config);
}

/** Parses a streamed JSON fragment, falling back to the raw text when invalid. */
function parseJsonOrRaw(text: string): unknown {
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
