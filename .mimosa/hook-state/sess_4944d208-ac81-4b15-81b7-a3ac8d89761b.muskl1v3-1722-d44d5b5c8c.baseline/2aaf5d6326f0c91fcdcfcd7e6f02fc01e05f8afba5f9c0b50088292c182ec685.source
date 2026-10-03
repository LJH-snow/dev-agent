import type { RetryOptions } from "./retry.js";

export type ModelProviderId = "openai" | "anthropic" | "gemini" | "ollama";

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters?: Record<string, unknown>;
}

export interface ChatCompletion {
  readonly content: string;
  /** Provider reasoning/thinking accumulated for non-stream consumers. */
  readonly reasoning?: string;
  readonly toolCalls?: readonly ToolCall[];
  /** Token usage reported by the provider, when it reports any. */
  readonly usage?: ChatUsage;
  /** Provider-reported request phases, expressed as bounded milliseconds. */
  readonly providerTiming?: ProviderTiming;
}

/** Timing metadata only: never contains request or response content. */
export interface ProviderTiming {
  readonly loadMs?: number;
  readonly promptEvalMs?: number;
  readonly generationMs?: number;
  readonly serverTotalMs?: number;
}

export interface ChatUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /** Prompt tokens served from a provider cache, included in `promptTokens`. */
  readonly cachedPromptTokens?: number;
  /** Prompt tokens written to a provider cache, included in `promptTokens`. */
  readonly cacheCreationPromptTokens?: number;
}

export interface ChatOptions {
  readonly signal?: AbortSignal;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly ToolSchema[];
  /** Ollama thinking control for models that advertise the capability. */
  readonly think?: boolean | "low" | "medium" | "high" | "max";
  /** Provider-supported reasoning depth; ignored unless the selected model supports it. */
  readonly reasoningEffort?: "low" | "medium" | "high";
  /** Gemini 3 GenerateContent thinking depth, when supported by the model. */
  readonly thinkingLevel?: "minimal" | "low" | "high";
  /** Anthropic adaptive-thinking selector used only with supported models. */
  readonly adaptiveThinking?: boolean;
  readonly stream?: boolean;
}

export interface ChatStreamOptions extends ChatOptions {
  readonly onToken?: (token: string) => void;
  /** Provider-emitted reasoning/thinking deltas, when available. */
  readonly onReasoning?: (token: string) => void;
}

export interface ProviderConfig {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** Retry policy for the initial HTTP request of each call. */
  readonly retry?: RetryOptions;
}

export interface ModelProvider {
  readonly id: ModelProviderId;
  readonly model: string;
  chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<ChatCompletion>;
  streamChat?(
    messages: readonly ChatMessage[],
    options?: ChatStreamOptions
  ): Promise<ChatCompletion>;
}
