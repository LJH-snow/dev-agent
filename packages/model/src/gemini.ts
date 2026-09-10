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

export interface GeminiProviderConfig extends ProviderConfig {}

interface GeminiPart {
  readonly text?: string;
  readonly functionCall?: {
    readonly name?: string;
    readonly args?: unknown;
    readonly arguments?: unknown;
  };
}

interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: {
      readonly parts?: readonly GeminiPart[];
    };
  }[];
  readonly usageMetadata?: GeminiWireUsage;
}

interface GeminiWireUsage {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly totalTokenCount?: number;
}

export class GeminiProvider implements ModelProvider {
  readonly id = "gemini" as const;
  readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly retry?: RetryOptions;

  constructor(config: GeminiProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl?.replace(/\/$/, "") ?? "https://generativelanguage.googleapis.com";
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.retry = config.retry;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatCompletion> {
    const url =
      `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent` +
      `?key=${encodeURIComponent(this.apiKey ?? "")}`;
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const body: Record<string, unknown> = {
      contents: toGeminiContents(messages),
    };
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] };
    }
    if (options.tools) {
      body.tools = [
        {
          functionDeclarations: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ];
    }
    if (options.temperature !== undefined || options.maxTokens !== undefined) {
      body.generationConfig = {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
      };
    }

    const response = await requestWithRetry(
      "Gemini request",
      () =>
        this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: options.signal,
        }),
      { ...this.retry, signal: options.signal ?? this.retry?.signal }
    );

    const data = (await response.json()) as GeminiResponse;
    const usage = parseGeminiUsage(data.usageMetadata);
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const toolCalls = parts
      .map((part, index): ToolCall | undefined => {
        const functionCall = part.functionCall;
        if (!functionCall) {
          return undefined;
        }
        return {
          id: `gemini-${index}`,
          name: functionCall.name ?? "unknown",
          input: functionCall.args ?? functionCall.arguments ?? {},
        };
      })
      .filter((call): call is ToolCall => call !== undefined);

    return {
      content: parts
        .map((part) => part.text ?? "")
        .filter(Boolean)
        .join("\n"),
      toolCalls,
      usage,
    };
  }

  async streamChat(
    messages: readonly ChatMessage[],
    options: ChatOptions & { onToken?: (token: string) => void } = {}
  ): Promise<ChatCompletion> {
    const url =
      `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:streamGenerateContent` +
      `?key=${encodeURIComponent(this.apiKey ?? "")}&alt=sse`;
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const body: Record<string, unknown> = {
      contents: toGeminiContents(messages),
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (options.tools) {
      body.tools = [
        {
          functionDeclarations: options.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }
    if (options.temperature !== undefined || options.maxTokens !== undefined) {
      body.generationConfig = {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
      };
    }

    const response = await requestWithRetry(
      "Gemini stream request",
      () =>
        this.fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: options.signal,
        }),
      { ...this.retry, signal: options.signal ?? this.retry?.signal }
    );

    if (!response.body) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Gemini stream request failed (${response.status}): ${bodyText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";
    let usage: ChatUsage | undefined;
    const toolCalls: ToolCall[] = [];

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) return;
      const data = trimmed.slice(6);
      try {
        const json = JSON.parse(data) as {
          candidates?: readonly {
            content?: { parts?: readonly GeminiPart[] };
          }[];
          usageMetadata?: GeminiWireUsage;
        };
        if (json.usageMetadata) {
          usage = parseGeminiUsage(json.usageMetadata);
        }
        const parts = json.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) {
            content += part.text;
            options.onToken?.(part.text);
          }
          if (part.functionCall) {
            toolCalls.push({
              id: `gemini-${toolCalls.length}`,
              name: part.functionCall.name ?? "unknown",
              input: part.functionCall.args ?? part.functionCall.arguments ?? {},
            });
          }
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

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage };
  }
}

function parseGeminiUsage(usage: GeminiWireUsage | undefined): ChatUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = usage.promptTokenCount ?? 0;
  const completionTokens = usage.candidatesTokenCount ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.totalTokenCount ?? promptTokens + completionTokens,
  };
}

export function createGeminiProvider(config: GeminiProviderConfig): GeminiProvider {
  return new GeminiProvider(config);
}

function toGeminiContents(messages: readonly ChatMessage[]): unknown[] {
  const contents: Record<string, unknown>[] = [];
  const pendingToolResults: Record<string, unknown>[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) {
      return;
    }
    contents.push({ role: "user", parts: [...pendingToolResults] });
    pendingToolResults.length = 0;
  };

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "tool") {
      pendingToolResults.push({
        functionResponse: {
          name: message.toolName ?? "unknown",
          response: parseToolResult(message.content),
        },
      });
      continue;
    }

    flushToolResults();
    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      const parts: Record<string, unknown>[] = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      for (const call of message.toolCalls) {
        parts.push({
          functionCall: {
            name: call.name,
            args: call.input,
          },
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    });
  }

  flushToolResults();
  return contents;
}

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return { output: content };
  }
}
