import type { ChatUsage } from "./types.js";

/** USD per one million tokens, split by direction. */
export interface ModelPrice {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  /** Optional discounted price for prompt tokens served from a cache. */
  readonly cachedInputPerMillion?: number;
  /** Optional price for prompt tokens written to a cache. */
  readonly cacheCreationInputPerMillion?: number;
}

/**
 * Model-name prefix -> price. Prefixes let one entry cover dated snapshots
 * (`gpt-4o-mini` also matches `gpt-4o-mini-2024-07-18`).
 */
export type PriceTable = Readonly<Record<string, ModelPrice>>;

/**
 * Estimates the cost of one usage report in USD. The longest matching prefix
 * wins, so a table can hold both `gpt-4o` and `gpt-4o-mini`. Returns undefined
 * when no usable entry matches, which callers render as "no cost shown"
 * rather than guessing a price.
 */
export function estimateCost(
  usage: ChatUsage,
  model: string,
  prices: PriceTable | undefined
): number | undefined {
  if (!prices || !isUsableUsage(usage)) {
    return undefined;
  }
  const name = model.trim().toLowerCase();
  if (!name) {
    return undefined;
  }

  let best: { prefix: string; price: ModelPrice } | undefined;
  for (const [rawPrefix, rawPrice] of Object.entries(prices)) {
    const prefix = rawPrefix.trim().toLowerCase();
    if (!prefix || !name.startsWith(prefix) || !isUsablePrice(rawPrice)) {
      continue;
    }
    if (!best || prefix.length > best.prefix.length) {
      best = { prefix, price: rawPrice };
    }
  }
  if (!best) {
    return undefined;
  }

  const cachedTokens = clampTokens(usage.cachedPromptTokens, usage.promptTokens);
  const creationTokens = clampTokens(
    usage.cacheCreationPromptTokens,
    usage.promptTokens - cachedTokens
  );
  const plainTokens = usage.promptTokens - cachedTokens - creationTokens;
  const inputCost =
    plainTokens * best.price.inputPerMillion +
    cachedTokens * priceOr(best.price.cachedInputPerMillion, best.price.inputPerMillion) +
    creationTokens *
      priceOr(best.price.cacheCreationInputPerMillion, best.price.inputPerMillion);
  const cost =
    (inputCost + usage.completionTokens * best.price.outputPerMillion) / 1_000_000;
  return Number.isFinite(cost) ? cost : undefined;
}

function clampTokens(value: number | undefined, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || limit <= 0) {
    return 0;
  }
  return Math.min(value, limit);
}

function priceOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function isUsableUsage(usage: ChatUsage): boolean {
  return (
    Number.isFinite(usage.promptTokens) &&
    usage.promptTokens >= 0 &&
    Number.isFinite(usage.completionTokens) &&
    usage.completionTokens >= 0
  );
}

function isUsablePrice(price: ModelPrice | undefined): price is ModelPrice {
  return (
    typeof price === "object" &&
    price !== null &&
    Number.isFinite(price.inputPerMillion) &&
    price.inputPerMillion >= 0 &&
    Number.isFinite(price.outputPerMillion) &&
    price.outputPerMillion >= 0
  );
}
