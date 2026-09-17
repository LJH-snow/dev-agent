import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ModelProvider,
} from "@dev-agent/model";

import {
  resolveFallbackSelection,
  type CliConfigLike,
  type ModelFailureReason,
  type ModelSelection,
  type ModelSelectionResult,
} from "./model-profiles.js";

export interface FallbackProviderOptions {
  readonly config: CliConfigLike;
  readonly initial: ModelSelectionResult;
  readonly createProvider: (selection: ModelSelection) => ModelProvider;
  /** Receives safe selection metadata after a fallback is selected. */
  readonly onSelectionChange?: (selection: ModelSelectionResult) => void;
}

/**
 * Retries a model call with the next explicitly configured profile/alias only
 * after a bounded provider failure. It never infers fallback targets and never
 * exposes the original provider exception to the selection layer.
 */
export class FallbackModelProvider implements ModelProvider {
  private active: ModelProvider;
  private selection: ModelSelectionResult;

  constructor(private readonly options: FallbackProviderOptions) {
    this.selection = options.initial;
    this.active = options.createProvider(options.initial.selection);
  }

  get id() {
    return this.active.id;
  }

  get model() {
    return this.active.model;
  }

  async chat(messages: readonly ChatMessage[], chatOptions?: ChatOptions): Promise<ChatCompletion> {
    return this.runWithFallback((provider) => provider.chat(messages, chatOptions));
  }

  async streamChat(
    messages: readonly ChatMessage[],
    chatOptions?: ChatOptions & { readonly onToken?: (token: string) => void },
  ): Promise<ChatCompletion> {
    return this.runWithFallback(async (provider) => {
      if (typeof provider.streamChat !== "function") {
        return provider.chat(messages, chatOptions);
      }
      return provider.streamChat(messages, chatOptions);
    });
  }

  private async runWithFallback(
    operation: (provider: ModelProvider) => Promise<ChatCompletion>,
  ): Promise<ChatCompletion> {
    for (;;) {
      try {
        return await operation(this.active);
      } catch (error) {
        const failure = classifyProviderFailure(error);
        const next = resolveFallbackSelection({
          config: this.options.config,
          current: this.selection,
          failure,
        });
        if (!next.changed) {
          throw error;
        }
        this.selection = next;
        this.active = this.options.createProvider(next.selection);
        this.options.onSelectionChange?.(next);
      }
    }
  }
}

function classifyProviderFailure(error: unknown): ModelFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/(429|rate.?limit|too many requests)/.test(message)) return "rate_limited";
  if (/(timeout|timed out|abort|deadline)/.test(message)) return "timeout";
  if (/(401|403|unauthori[sz]|api key|credential|authentication)/.test(message)) return "authentication";
  if (/(network|econn|enotfound|unavailable|fetch failed|socket)/.test(message)) return "unavailable";
  return "unknown";
}
