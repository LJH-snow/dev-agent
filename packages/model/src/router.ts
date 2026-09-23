import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ChatStreamOptions,
  ModelProvider,
  ModelProviderId,
} from "./types.js";

export type ModelFailureReason =
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "authentication"
  | "unknown";

export interface ModelProviderMetadata {
  readonly id: ModelProviderId;
  readonly model: string;
}

export interface ModelRouterFallbackContext {
  readonly current: ModelProviderMetadata;
  readonly failure: ModelFailureReason;
  /** One-based fallback attempt number. */
  readonly attempt: number;
}

export interface ModelRouterFallbackEvent {
  readonly from: ModelProviderMetadata;
  readonly to: ModelProviderMetadata;
  readonly failure: ModelFailureReason;
  readonly attempt: number;
}

export interface ModelRouterOptions {
  readonly primary: ModelProvider;
  /**
   * Lazily constructs the next explicitly configured provider. Returning
   * undefined preserves the original provider error.
   */
  readonly resolveFallback?: (
    context: ModelRouterFallbackContext
  ) => ModelProvider | undefined | Promise<ModelProvider | undefined>;
  /** Maximum number of fallback providers one request may visit. */
  readonly maxFallbacks?: number;
  /** Receives only safe route metadata, never the provider error. */
  readonly onFallback?: (event: ModelRouterFallbackEvent) => void;
  /** Overrides the bounded default failure classifier. */
  readonly classifyFailure?: (error: unknown) => ModelFailureReason;
}

const DEFAULT_MAX_FALLBACKS = 16;

/**
 * Provider-neutral model routing.
 *
 * The application edge owns profile and credential resolution. This class
 * owns invocation semantics, lazy fallback selection, abort handling, and the
 * rule that a partially visible stream must never be replayed on another
 * provider.
 */
export class ModelRouter implements ModelProvider {
  private active: ModelProvider;
  private readonly resolveFallback?: ModelRouterOptions["resolveFallback"];
  private readonly maxFallbacks: number;
  private readonly onFallback?: ModelRouterOptions["onFallback"];
  private readonly classifyFailure: (error: unknown) => ModelFailureReason;

  constructor(options: ModelRouterOptions) {
    this.active = options.primary;
    this.resolveFallback = options.resolveFallback;
    this.maxFallbacks = positiveLimit(
      options.maxFallbacks,
      DEFAULT_MAX_FALLBACKS,
      "maxFallbacks",
    );
    this.onFallback = options.onFallback;
    this.classifyFailure = options.classifyFailure ?? classifyModelFailure;
  }

  get id(): ModelProviderId {
    return this.active.id;
  }

  get model(): string {
    return this.active.model;
  }

  async chat(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatCompletion> {
    return this.runWithFallback(
      (provider) => provider.chat(messages, options),
      options,
    );
  }

  async streamChat(
    messages: readonly ChatMessage[],
    options?: ChatStreamOptions,
  ): Promise<ChatCompletion> {
    let visibleOutput = false;
    const wrappedOptions: ChatStreamOptions = {
      ...(options ?? {}),
      onToken: (token) => {
        visibleOutput = true;
        options?.onToken?.(token);
      },
      onReasoning: (token) => {
        visibleOutput = true;
        options?.onReasoning?.(token);
      },
    };

    return this.runWithFallback(
      (provider) => {
        if (typeof provider.streamChat === "function") {
          return provider.streamChat(messages, wrappedOptions);
        }
        return provider.chat(messages, options);
      },
      options,
      () => !visibleOutput,
    );
  }

  private async runWithFallback(
    operation: (provider: ModelProvider) => Promise<ChatCompletion>,
    options: ChatOptions | undefined,
    canRetry: () => boolean = () => true,
  ): Promise<ChatCompletion> {
    let attempt = 0;

    for (;;) {
      try {
        return await operation(this.active);
      } catch (error) {
        if (
          options?.signal?.aborted ||
          !canRetry() ||
          this.resolveFallback === undefined ||
          attempt >= this.maxFallbacks
        ) {
          throw error;
        }

        const failure = this.classifyFailure(error);
        const from = providerMetadata(this.active);
        const next = await this.resolveFallback({
          current: from,
          failure,
          attempt: attempt + 1,
        });
        if (next === undefined) {
          throw error;
        }

        attempt += 1;
        this.active = next;
        const event: ModelRouterFallbackEvent = {
          from,
          to: providerMetadata(next),
          failure,
          attempt,
        };
        try {
          this.onFallback?.(event);
        } catch {
          // Route observability must not turn a usable fallback into a failure.
        }
      }
    }
  }
}

export function classifyModelFailure(error: unknown): ModelFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/(429|rate.?limit|too many requests)/.test(message)) return "rate_limited";
  if (/(timeout|timed out|deadline|abort)/.test(message)) return "timeout";
  if (/(401|403|unauthori[sz]|api key|credential|authentication)/.test(message)) {
    return "authentication";
  }
  if (/(network|econn|enotfound|unavailable|fetch failed|socket)/.test(message)) {
    return "unavailable";
  }
  return "unknown";
}

function providerMetadata(provider: ModelProvider): ModelProviderMetadata {
  return { id: provider.id, model: provider.model };
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
