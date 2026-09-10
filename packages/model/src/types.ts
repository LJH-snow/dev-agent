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
