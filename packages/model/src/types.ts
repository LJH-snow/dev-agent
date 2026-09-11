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
  readonly toolCalls?: readonly ToolCall[];
  /** Token usage reported by the provider, when it reports any. */
  readonly usage?: ChatUsage;
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
  readonly stream?: boolean;
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
    options?: ChatOptions & { onToken?: (token: string) => void }
  ): Promise<ChatCompletion>;
}
