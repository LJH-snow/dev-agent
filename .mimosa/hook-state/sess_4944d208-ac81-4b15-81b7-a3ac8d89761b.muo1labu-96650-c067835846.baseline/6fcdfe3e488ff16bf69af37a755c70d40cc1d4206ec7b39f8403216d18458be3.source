import type { ChatCompletion, ChatMessage, ChatOptions, ChatStreamOptions, ModelProvider } from "@dev-agent/model";
import { estimateCost, type ChatUsage, type PriceTable } from "@dev-agent/model";

export interface SessionModelBudgetLimits {
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
  readonly maxDurationMs?: number;
}

export interface SessionModelBudgetSnapshot {
  readonly requests: number;
  readonly tokens: number;
  readonly estimatedCostUsd: number;
  readonly durationMs: number;
  readonly unknownUsageRequests: number;
  readonly unpricedRequests: number;
  readonly limits: SessionModelBudgetLimits;
}

type LimitKey = keyof SessionModelBudgetLimits;

const DEFAULT_PRICES: PriceTable | undefined = undefined;

/**
 * A process-local ledger for provider calls. It is deliberately independent
 * from session transcript memory: prompts, outputs, and tool payloads never
 * enter this object.
 */
export class SessionModelBudget {
  private limits: SessionModelBudgetLimits;
  private readonly prices: PriceTable | undefined;
  private startedAt = Date.now();
  private requests = 0;
  private tokens = 0;
  private estimatedCostUsd = 0;
  private durationMs = 0;
  private unknownUsageRequests = 0;
  private unpricedRequests = 0;
  private activeRequests = 0;

  constructor(limits: SessionModelBudgetLimits = {}, prices?: PriceTable) {
    this.limits = validateLimits(limits);
    this.prices = prices ?? DEFAULT_PRICES;
  }

  wrap(provider: ModelProvider): ModelProvider {
    const budget = this;
    return {
      get id() { return provider.id; },
      get model() { return provider.model; },
      chat(messages, options) {
        return budget.run(provider, "chat", messages, options);
      },
      ...(typeof provider.streamChat === "function"
        ? { streamChat: (messages: readonly ChatMessage[], options?: ChatStreamOptions) => budget.run(provider, "streamChat", messages, options) }
        : {}),
    };
  }

  snapshot(): SessionModelBudgetSnapshot {
    return {
      requests: this.requests,
      tokens: this.tokens,
      estimatedCostUsd: this.estimatedCostUsd,
      durationMs: this.durationMs + Math.max(0, Date.now() - this.startedAt),
      unknownUsageRequests: this.unknownUsageRequests,
      unpricedRequests: this.unpricedRequests,
      limits: { ...this.limits },
    };
  }

  setLimit(key: LimitKey, value: number | undefined): void {
    this.limits = validateLimits({ ...this.limits, [key]: value });
  }

  canStart(model?: string): void {
    const elapsed = Math.max(0, Date.now() - this.startedAt) + this.durationMs;
    if (this.limits.maxDurationMs !== undefined && elapsed >= this.limits.maxDurationMs) {
      throw new Error("time budget exceeded");
    }
    if (this.limits.maxTokens !== undefined && this.tokens >= this.limits.maxTokens) {
      throw new Error("token budget exceeded");
    }
    if (this.limits.maxCostUsd !== undefined && model !== undefined && !this.hasPrice(model)) {
      throw new Error("unpriced usage: pricing is required for the configured cost budget");
    }
    if (this.limits.maxCostUsd !== undefined && this.estimatedCostUsd >= this.limits.maxCostUsd) {
      throw new Error("cost budget exceeded");
    }
    if (this.unknownUsageRequests > 0 && this.limits.maxTokens !== undefined) {
      throw new Error("unknown usage prevents safe token budgeting");
    }
    if (this.unpricedRequests > 0 && this.limits.maxCostUsd !== undefined) {
      throw new Error("unpriced usage prevents safe cost budgeting; pricing is required");
    }
    if (this.limits.maxTokens !== undefined && this.activeRequests > 0) {
      throw new Error("token budget is reserved by an in-flight request");
    }
  }

  private hasPrice(model: string): boolean {
    const normalized = model.trim().toLowerCase();
    return Object.entries(this.prices ?? {}).some(([prefix, price]) =>
      normalized.startsWith(prefix.trim().toLowerCase()) &&
      Number.isFinite(price.inputPerMillion) && price.inputPerMillion >= 0 &&
      Number.isFinite(price.outputPerMillion) && price.outputPerMillion >= 0
    );
  }

  private async run(
    provider: ModelProvider,
    method: "chat" | "streamChat",
    messages: readonly ChatMessage[],
    options?: ChatOptions | ChatStreamOptions,
  ): Promise<ChatCompletion> {
    if (options?.signal?.aborted) {
      throw abortError(options.signal.reason);
    }
    this.canStart(provider.model);
    this.requests += 1;
    this.activeRequests += 1;
    const remainingTokens = this.limits.maxTokens === undefined
      ? undefined
      : Math.max(0, this.limits.maxTokens - this.tokens);
    const requestedTokens = options?.maxTokens;
    const maxTokens = remainingTokens === undefined
      ? requestedTokens
      : requestedTokens === undefined ? remainingTokens : Math.min(requestedTokens, remainingTokens);
    const durationRemaining = this.limits.maxDurationMs === undefined
      ? undefined
      : Math.max(0, this.limits.maxDurationMs - (Date.now() - this.startedAt) - this.durationMs);
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abortFromCaller = (): void => controller.abort(options?.signal?.reason);
    if (options?.signal) {
      if (options.signal.aborted) abortFromCaller();
      else options.signal.addEventListener("abort", abortFromCaller, { once: true });
    }
    if (durationRemaining !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("time budget exceeded"));
      }, durationRemaining);
      timer.unref?.();
    }
    const callOptions = {
      ...(options ?? {}),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      signal: controller.signal,
    } as ChatOptions & ChatStreamOptions;
    const began = Date.now();
    try {
      const result = method === "streamChat" && typeof provider.streamChat === "function"
        ? await provider.streamChat(messages, callOptions)
        : await provider.chat(messages, callOptions);
      const elapsed = Math.max(0, Date.now() - began);
      this.durationMs += elapsed;
      const usage = normalizeUsage(result.usage);
      if (usage === undefined) {
        this.unknownUsageRequests += 1;
        if (this.limits.maxCostUsd !== undefined) {
          throw new Error("unknown usage prevents safe cost budgeting");
        }
      } else {
        this.tokens += usage.totalTokens;
        const cost = estimateCost(usage, provider.model, this.prices);
        if (cost === undefined) {
          this.unpricedRequests += 1;
          if (this.limits.maxCostUsd !== undefined) {
            throw new Error("unpriced usage prevents safe cost budgeting; pricing is required");
          }
        } else {
          this.estimatedCostUsd += cost;
        }
      }
      return result;
    } catch (error) {
      this.durationMs += Math.max(0, Date.now() - began);
      if (timedOut) throw new Error("time budget exceeded");
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (error instanceof Error && /budget exceeded/.test(error.message)) throw error;
      if (method === "streamChat") {
        this.unknownUsageRequests += 1;
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", abortFromCaller);
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    }
  }
}

function validateLimits(limits: SessionModelBudgetLimits): SessionModelBudgetLimits {
  const result: { maxTokens?: number; maxCostUsd?: number; maxDurationMs?: number } = {};
  for (const key of ["maxTokens", "maxDurationMs"] as const) {
    const value = limits[key];
    if (value !== undefined) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
      (result as Record<string, number>)[key] = value;
    }
  }
  if (limits.maxCostUsd !== undefined) {
    if (!Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd < 0) throw new Error("maxCostUsd must be a non-negative number");
    result.maxCostUsd = limits.maxCostUsd;
  }
  return result;
}

function normalizeUsage(usage: ChatUsage | undefined): ChatUsage | undefined {
  if (!usage || !Number.isFinite(usage.promptTokens) || usage.promptTokens < 0 ||
      !Number.isFinite(usage.completionTokens) || usage.completionTokens < 0 ||
      !Number.isFinite(usage.totalTokens) || usage.totalTokens < 0) return undefined;
  return { ...usage, totalTokens: Math.max(usage.totalTokens, usage.promptTokens + usage.completionTokens) };
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}
