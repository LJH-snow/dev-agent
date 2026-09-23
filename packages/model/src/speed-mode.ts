import { supportsAnthropicAdaptiveEffort } from "./anthropic.js";
import { supportsGeminiThinkingLevel } from "./gemini.js";
import { supportsOpenAIReasoningEffort } from "./openai.js";
import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ChatStreamOptions,
  ModelProvider,
} from "./types.js";

export type ModelSpeedMode = "fast" | "balanced" | "deep";

/** Mutable, session-local mode shared by a provider and its configured fallbacks. */
export class ModelSpeedModeController {
  private value: ModelSpeedMode = "balanced";

  get mode(): ModelSpeedMode {
    return this.value;
  }

  setMode(mode: ModelSpeedMode): void {
    this.value = mode;
  }
}

/**
 * Adds only provider/model-supported reasoning controls to each model call.
 * The wrapper is placed around each concrete provider (including fallbacks),
 * so a primary provider's options are never leaked to a different fallback.
 */
export class SpeedModeModelProvider implements ModelProvider {
  readonly id: ModelProvider["id"];
  readonly model: string;
  readonly streamChat?: ModelProvider["streamChat"];

  constructor(
    private readonly provider: ModelProvider,
    private readonly controller: ModelSpeedModeController,
  ) {
    this.id = provider.id;
    this.model = provider.model;
    if (provider.streamChat) {
      this.streamChat = (messages, options) =>
        provider.streamChat!(messages, withSpeedModeOptions(
          provider,
          this.controller.mode,
          options ?? {},
        ) as ChatStreamOptions);
    }
  }

  chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<ChatCompletion> {
    return this.provider.chat(
      messages,
      withSpeedModeOptions(this.provider, this.controller.mode, options ?? {}),
    );
  }
}

export function withSpeedModeOptions<T extends ChatOptions>(
  provider: Pick<ModelProvider, "id" | "model">,
  mode: ModelSpeedMode,
  options: T,
): T {
  if (provider.id === "ollama") {
    const think = getOllamaThinkOption(provider.model, mode);
    return think === undefined ? options : { ...options, think };
  }

  if (mode === "balanced") return options;

  const effort = mode === "fast" ? "low" : "high";
  if (provider.id === "openai" && supportsOpenAIReasoningEffort(provider.model)) {
    if (mode === "fast" && isHighEffortOnlyOpenAIModel(provider.model)) return options;
    return { ...options, reasoningEffort: effort };
  }
  if (provider.id === "anthropic" && supportsAnthropicAdaptiveEffort(provider.model)) {
    return {
      ...options,
      reasoningEffort: effort,
      adaptiveThinking: true,
    };
  }
  if (provider.id === "gemini") {
    const thinkingLevel = getGeminiThinkingLevel(provider.model, mode);
    return thinkingLevel === undefined ? options : { ...options, thinkingLevel };
  }
  return options;
}

export function describeSpeedModeSupport(
  provider: Pick<ModelProvider, "id" | "model">,
  mode: ModelSpeedMode,
): string {
  if (mode === "balanced") return "provider default";
  if (provider.id === "ollama") {
    const think = getOllamaThinkOption(provider.model, mode);
    if (think === undefined) return "model-specific control unavailable; provider default retained";
    return typeof think === "string"
      ? `Ollama thinking level ${think}`
      : `Ollama thinking ${think ? "on" : "off"}`;
  }
  if (provider.id === "openai" && supportsOpenAIReasoningEffort(provider.model)) {
    if (mode === "fast" && isHighEffortOnlyOpenAIModel(provider.model)) {
      return "model only supports high effort; fast control unavailable, provider default retained";
    }
    return `reasoning effort ${mode === "fast" ? "low" : "high"}`;
  }
  if (provider.id === "anthropic" && supportsAnthropicAdaptiveEffort(provider.model)) {
    return `adaptive thinking, ${mode === "fast" ? "low" : "high"} effort`;
  }
  if (provider.id === "gemini") {
    const thinkingLevel = getGeminiThinkingLevel(provider.model, mode);
    if (thinkingLevel !== undefined) return `thinking level ${thinkingLevel}`;
  }
  return "model-specific control unavailable; provider default retained";
}

function getOllamaThinkOption(
  model: string,
  mode: ModelSpeedMode,
): ChatOptions["think"] | undefined {
  if (mode === "balanced") return undefined;
  const normalized = model.trim().toLowerCase();
  if (/^gpt-oss(?:[.:/-]|$)/.test(normalized)) {
    return mode === "fast" ? "low" : "high";
  }
  if (
    /^qwen3(?:[.:/-]|$)/.test(normalized) ||
    /^deepseek-r1(?:[.:/-]|$)/.test(normalized) ||
    /^deepseek-v3\.1(?:[.:/-]|$)/.test(normalized)
  ) {
    return mode === "deep";
  }
  return undefined;
}

function getGeminiThinkingLevel(
  model: string,
  mode: ModelSpeedMode,
): ChatOptions["thinkingLevel"] | undefined {
  if (mode === "balanced" || !supportsGeminiThinkingLevel(model)) return undefined;
  if (mode === "fast" && /^gemini-3\.1-flash-lite-image(?:[.-]|$)/i.test(model.trim())) {
    return "minimal";
  }
  return mode === "fast" ? "low" : "high";
}

function isHighEffortOnlyOpenAIModel(model: string): boolean {
  return /^(?:gpt-5-pro|o[13]-pro)(?:[.-]|$)/i.test(model.trim());
}
