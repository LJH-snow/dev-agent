import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ChatStreamOptions,
  ModelProvider,
} from "@dev-agent/model";
import { ModelRouter } from "@dev-agent/model";

import {
  resolveFallbackSelection,
  type CliConfigLike,
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
  private readonly router: ModelRouter;
  private selection: ModelSelectionResult;

  constructor(private readonly options: FallbackProviderOptions) {
    this.selection = options.initial;
    this.router = new ModelRouter({
      primary: options.createProvider(options.initial.selection),
      resolveFallback: ({ failure }) => {
        const next = resolveFallbackSelection({
          config: this.options.config,
          current: this.selection,
          failure,
        });
        if (!next.changed) {
          return undefined;
        }
        this.selection = next;
        const provider = this.options.createProvider(next.selection);
        this.options.onSelectionChange?.(next);
        return provider;
      },
    });
  }

  get id() {
    return this.router.id;
  }

  get model() {
    return this.router.model;
  }

  async chat(messages: readonly ChatMessage[], chatOptions?: ChatOptions): Promise<ChatCompletion> {
    return this.router.chat(messages, chatOptions);
  }

  async streamChat(
    messages: readonly ChatMessage[],
    chatOptions?: ChatStreamOptions,
  ): Promise<ChatCompletion> {
    return this.router.streamChat(messages, chatOptions);
  }
}
