import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import type {
  Message as AnthropicMessage,
  ContentBlockParam,
  MessageParam,
  RawMessageStreamEvent,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages";
import { Buffer } from "node:buffer";
import { MAX_STREAM_LINE_BYTES } from "./line-reader.js";
import { ModelRequestError, parseRetryAfter, summarizeErrorBody, withRetry, type RetryOptions } from "./retry.js";
import { StreamOutputBudget, StreamOutputLimitError } from "./stream-budget.js";
import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ChatStreamOptions,
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
    }
  | { readonly type: "thinking"; readonly thinking?: string };

const MAX_SUCCESS_JSON_BYTES = 16 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 16 * 1024;

/**
 * Uses Anthropic's maintained TypeScript client while keeping dev-agent's
 * provider contract and bounded-input safety guarantees at the application
 * boundary. The SDK's own retry loop is disabled because dev-agent has a
 * provider-wide retry policy with injectable backoff and deterministic tests.
 */
export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly retry?: RetryOptions;

  constructor(config: AnthropicProviderConfig) {
    this.model = config.model;
    this.retry = config.retry;
    const baseURL = config.baseUrl?.replace(/\/$/, "") ?? "https://api.anthropic.com";
    const fetchFn = config.fetch ?? globalThis.fetch;
    this.client = new Anthropic({
      apiKey: config.apiKey ?? null,
      baseURL,
      fetch: createBoundedFetch(fetchFn),
      maxRetries: 0,
      // The SDK requires an explicit header omission when no credential is
      // supplied. This preserves the provider's injectable unauthenticated
      // fetch behavior used by local gateways and deterministic tests.
      ...(config.apiKey
        ? {}
        : { defaultHeaders: { "x-api-key": null, authorization: null } }),
    });
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatCompletion> {
    const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
    const body = {
      model: this.model,
      max_tokens: options.maxTokens ?? 1024,
      messages: anthropicMessages,
      ...(system ? { system } : {}),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.tools === undefined ? {} : { tools: options.tools.map(toAnthropicTool) }),
    };
    addAnthropicThinkingOptions(body, this.model, options);

    const data = await withRetry(
      async () => {
        try {
          return (await this.client.messages.create(body, {
            signal: options.signal,
            maxRetries: 0,
          })) as AnthropicMessage;
        } catch (error) {
          throw normalizeAnthropicError(error, "Anthropic request");
        }
      },
      { ...this.retry, signal: options.signal ?? this.retry?.signal }
    );

    return fromAnthropicMessage(data);
  }

  async streamChat(
    messages: readonly ChatMessage[],
    options: ChatStreamOptions = {}
  ): Promise<ChatCompletion> {
    const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
    const body = {
      model: this.model,
      max_tokens: options.maxTokens ?? 1024,
      stream: true as const,
      messages: anthropicMessages,
      ...(system ? { system } : {}),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.tools === undefined ? {} : { tools: options.tools.map(toAnthropicTool) }),
    };
    addAnthropicThinkingOptions(body, this.model, options);

    const stream = await withRetry(
      async () => {
        try {
          return await this.client.messages.create(body, {
            signal: options.signal,
            maxRetries: 0,
          });
        } catch (error) {
          throw normalizeAnthropicError(error, "Anthropic stream request");
        }
      },
      { ...this.retry, signal: options.signal ?? this.retry?.signal }
    );

    let content = "";
    let reasoning = "";
    let usage: ChatUsage | undefined;
    const budget = new StreamOutputBudget();
    const toolUses = new Map<number, { id: string; name: string; json: string }>();

    try {
      for await (const event of stream as AsyncIterable<RawMessageStreamEvent>) {
        usage = applyAnthropicUsage(usage, usageFromStreamEvent(event));

        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          const id = event.content_block.id;
          const name = event.content_block.name;
          budget.addText(id);
          budget.addText(name);
          toolUses.set(event.index, { id, name, json: "" });
          continue;
        }

        if (event.type !== "content_block_delta") continue;
        const delta = event.delta as {
          type?: string;
          partial_json?: string;
          thinking?: string;
          text?: string;
        };
        if (delta.type === "input_json_delta" || (delta.type === undefined && "partial_json" in delta)) {
          const accumulated = toolUses.get(event.index);
          if (!accumulated || typeof delta.partial_json !== "string") continue;
          budget.addText(delta.partial_json);
          accumulated.json += delta.partial_json;
          continue;
        }
        if (delta.type === "thinking_delta" || (delta.type === undefined && typeof delta.thinking === "string")) {
          if (typeof delta.thinking !== "string") continue;
          budget.addText(delta.thinking);
          reasoning += delta.thinking;
          options.onReasoning?.(delta.thinking);
          continue;
        }
        if (delta.type === "text_delta" || (delta.type === undefined && typeof delta.text === "string")) {
          if (typeof delta.text !== "string") continue;
          budget.addText(delta.text);
          content += delta.text;
          options.onToken?.(delta.text);
        }
      }
    } catch (error) {
      if (error instanceof StreamOutputLimitError) {
        stream.controller?.abort();
      }
      throw error;
    }

    const toolCalls = [...toolUses.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, accumulated]) => ({
        id: accumulated.id,
        name: accumulated.name,
        input: parseJsonOrRaw(accumulated.json),
      }));

    return {
      content,
      reasoning: reasoning || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }
}

function fromAnthropicMessage(data: AnthropicMessage): ChatCompletion {
  const blocks = data.content as readonly AnthropicContentBlock[];
  return {
    content: blocks
      .filter((block): block is Extract<AnthropicContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text ?? "")
      .filter(Boolean)
      .join("\n"),
    toolCalls: blocks
      .map((block, index): ToolCall | undefined => {
        if (block.type !== "tool_use") return undefined;
        return {
          id: block.id ?? `anthropic-${index}`,
          name: block.name ?? "unknown",
          input: block.input ?? {},
        };
      })
      .filter((call): call is ToolCall => call !== undefined),
    reasoning: blocks
      .filter((block): block is Extract<AnthropicContentBlock, { type: "thinking" }> => block.type === "thinking")
      .map((block) => block.thinking ?? "")
      .filter(Boolean)
      .join(""),
    usage: applyAnthropicUsage(undefined, data.usage),
  };
}

function usageFromStreamEvent(event: RawMessageStreamEvent): AnthropicWireUsage | undefined {
  if (event.type === "message_start") return event.message.usage;
  if (event.type === "message_delta") {
    return {
      input_tokens: event.usage.input_tokens,
      output_tokens: event.usage.output_tokens,
      cache_creation_input_tokens: event.usage.cache_creation_input_tokens,
      cache_read_input_tokens: event.usage.cache_read_input_tokens,
    };
  }
  return undefined;
}

interface AnthropicWireUsage {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
}

/**
 * Anthropic reports input tokens when the message starts and output tokens as
 * it progresses, so both events are merged into one running total.
 */
function applyAnthropicUsage(
  current: ChatUsage | undefined,
  wire: AnthropicWireUsage | undefined
): ChatUsage | undefined {
  if (!wire) return current;
  const hasInput = typeof wire.input_tokens === "number";
  const promptTokens = hasInput
    ? wire.input_tokens! + (wire.cache_creation_input_tokens ?? 0) + (wire.cache_read_input_tokens ?? 0)
    : current?.promptTokens ?? 0;
  const cachedPromptTokens =
    (hasInput ? wire.cache_read_input_tokens : undefined) ?? current?.cachedPromptTokens ?? 0;
  const cacheCreationPromptTokens =
    (hasInput ? wire.cache_creation_input_tokens : undefined) ?? current?.cacheCreationPromptTokens ?? 0;
  const completionTokens =
    typeof wire.output_tokens === "number" ? wire.output_tokens : current?.completionTokens ?? 0;
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
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toAnthropicMessages(messages: readonly ChatMessage[]): {
  readonly system?: string;
  readonly messages: MessageParam[];
} {
  const result: MessageParam[] = [];
  const pendingToolResults: ContentBlockParam[][] = [];
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    result.push({ role: "user", content: pendingToolResults.flat() });
    pendingToolResults.length = 0;
  };

  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      pendingToolResults.push([
        {
          type: "tool_result",
          tool_use_id: message.toolCallId ?? "",
          content: message.content,
        },
      ]);
      continue;
    }

    flushToolResults();
    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      const content: ContentBlockParam[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  flushToolResults();
  return system ? { system, messages: result } : { messages: result };
}

function toAnthropicTool(tool: ToolSchema): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      ...(tool.parameters ?? {}),
    },
  };
}

function addAnthropicThinkingOptions(
  body: Record<string, unknown>,
  model: string,
  options: ChatOptions
): void {
  if (!supportsAnthropicAdaptiveEffort(model)) return;
  if (options.adaptiveThinking) body.thinking = { type: "adaptive" };
  if (options.reasoningEffort) body.output_config = { effort: options.reasoningEffort };
}

export function supportsAnthropicAdaptiveEffort(model: string): boolean {
  return /^claude-(?:(?:opus|sonnet)-(?:4-(?:6|7|8)|5(?:-\d+)?)|(?:fable|mythos)-5(?:-\d+)?)(?:-|$)/i.test(
    model.trim()
  );
}

class ResponseBodyLimitError extends Error {
  constructor(limitBytes: number) {
    super(`response exceeded the ${limitBytes / (1024 * 1024)} MiB limit`);
    this.name = "ResponseBodyLimitError";
  }
}

function createBoundedFetch(fetchFn: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchFn(input, init);
    if (!response.body) return response;

    if (!response.ok) {
      const body = await readBoundedText(response, MAX_ERROR_BODY_BYTES, false);
      return new Response(summarizeErrorBody(body), {
        status: response.status,
        headers: new Headers(response.headers),
      });
    }

    if (!isStreamingRequest(init?.body)) {
      const body = await readBoundedText(response, MAX_SUCCESS_JSON_BYTES, true);
      const headers = new Headers(response.headers);
      // Test doubles and some compatible gateways omit this header. The
      // official SDK otherwise treats the body as text and returns a String
      // object instead of the typed Messages response.
      headers.set("content-type", "application/json");
      return new Response(body, {
        status: response.status,
        headers,
      });
    }

    return new Response(withBoundedSseLines(response.body), {
      status: response.status,
      headers: new Headers(response.headers),
    });
  };
}

function isStreamingRequest(body: unknown): boolean {
  if (typeof body !== "string") return false;
  try {
    return (JSON.parse(body) as { stream?: unknown }).stream === true;
  } catch {
    return false;
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  throwOnLimit: boolean
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        if (throwOnLimit) throw new ResponseBodyLimitError(maxBytes);
        return `response exceeded the ${maxBytes / 1024} KiB read limit`;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

function withBoundedSseLines(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBytes = 0;
  let textBuffer = "";
  let blockLines: string[] = [];
  let finished = false;

  const flushBlock = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (blockLines.length === 0) return;
    const hasEventName = blockLines.some((line) => line.startsWith("event:"));
    const data = blockLines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    let eventName: string | undefined;
    if (!hasEventName && data) {
      try {
        const parsed = JSON.parse(data) as {
          type?: unknown;
          delta?: { text?: unknown; thinking?: unknown; partial_json?: unknown; stop_reason?: unknown };
          content_block?: unknown;
          message?: unknown;
          usage?: unknown;
        };
        if (typeof parsed.type === "string" && parsed.type.length > 0) {
          eventName = parsed.type;
        } else if (parsed.content_block !== undefined) {
          eventName = "content_block_start";
        } else if (
          parsed.delta?.text !== undefined ||
          parsed.delta?.thinking !== undefined ||
          parsed.delta?.partial_json !== undefined
        ) {
          eventName = "content_block_delta";
        } else if (parsed.message !== undefined) {
          eventName = "message_start";
        } else if (parsed.usage !== undefined || parsed.delta?.stop_reason !== undefined) {
          eventName = "message_delta";
        }
      } catch {
        // Leave malformed or non-JSON SSE blocks untouched; the official SDK
        // will ignore them just as it does on the network.
      }
    }
    let outputLines = blockLines;
    if (eventName && !hasEventName) {
      try {
        const parsed = JSON.parse(data) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>;
          if (typeof record.type !== "string") {
            // Older compatible gateways and our legacy test doubles omit the
            // `type` field while still carrying enough shape to infer the
            // Anthropic event from the payload. The official SDK yields the
            // raw JSON as-is, so add the inferred discriminator before handing
            // it back to the SDK.
            const normalizedData = JSON.stringify({ ...record, type: eventName });
            const firstDataLine = blockLines.findIndex((line) => line.startsWith("data:"));
            if (firstDataLine >= 0) {
              outputLines = [...blockLines];
              outputLines[firstDataLine] = `data: ${normalizedData}`;
              for (let index = outputLines.length - 1; index > firstDataLine; index -= 1) {
                if (outputLines[index]?.startsWith("data:")) outputLines.splice(index, 1);
              }
            }
          }
        }
      } catch {
        // Leave malformed or non-JSON SSE blocks untouched; the official SDK
        // will ignore them just as it does on the network.
      }
    }
    const normalized = [
      ...(eventName ? [`event: ${eventName}`] : []),
      ...outputLines,
      "",
      "",
    ].join("\n");
    controller.enqueue(encoder.encode(normalized));
    blockLines = [];
  };

  const consumeText = (
    text: string,
    controller: ReadableStreamDefaultController<Uint8Array>
  ): void => {
    textBuffer += text;
    const lines = textBuffer.split("\n");
    textBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length === 0 || line === "\r") {
        flushBlock(controller);
      } else {
        blockLines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        const { done, value } = await reader.read();
        if (done) {
          consumeText(decoder.decode(), controller);
          if (textBuffer.length > 0) {
            blockLines.push(textBuffer.endsWith("\r") ? textBuffer.slice(0, -1) : textBuffer);
            textBuffer = "";
          }
          flushBlock(controller);
          finished = true;
          controller.close();
          return;
        }
        if (!value) return;
        for (const byte of value) {
          lineBytes += 1;
          if (lineBytes > MAX_STREAM_LINE_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new Error(`stream line exceeded the ${MAX_STREAM_LINE_BYTES / (1024 * 1024)} MiB limit`);
          }
          if (byte === 10) lineBytes = 0;
        }
        consumeText(decoder.decode(value, { stream: true }), controller);
      } catch (error) {
        finished = true;
        controller.error(error);
      }
    },
    async cancel(reason) {
      finished = true;
      await reader.cancel(reason);
    },
  });
}

function normalizeAnthropicError(error: unknown, label: string): unknown {
  if (error instanceof ResponseBodyLimitError) return error;
  if (error instanceof APIUserAbortError) {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    return abort;
  }
  if (error instanceof APIError && typeof error.status === "number") {
    const message = summarizeErrorBody(error.message).replace(
      new RegExp(`^${error.status}\\s+`),
      ""
    );
    return new ModelRequestError(`${label} failed (${error.status}): ${message}`, {
      status: error.status,
      retryAfterMs: parseRetryAfter(error.headers?.get("retry-after")),
    });
  }
  if (error instanceof APIConnectionError) {
    const cause = (error as APIConnectionError & { cause?: unknown }).cause;
    if (cause instanceof ResponseBodyLimitError || (cause instanceof Error && /stream line exceeded/.test(cause.message))) {
      return cause;
    }
    const network = new TypeError(error.message || "Anthropic connection failed");
    network.cause = error;
    return network;
  }
  return error;
}
