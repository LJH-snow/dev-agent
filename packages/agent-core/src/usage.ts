import type { ChatUsage } from "@dev-agent/model";

/** Adds one usage report to a running total. */
export function addUsage(total: ChatUsage | undefined, usage: ChatUsage): ChatUsage {
  const cachedPromptTokens =
    (total?.cachedPromptTokens ?? 0) + (usage.cachedPromptTokens ?? 0);
  const cacheCreationPromptTokens =
    (total?.cacheCreationPromptTokens ?? 0) + (usage.cacheCreationPromptTokens ?? 0);
  return {
    promptTokens: (total?.promptTokens ?? 0) + usage.promptTokens,
    completionTokens: (total?.completionTokens ?? 0) + usage.completionTokens,
    totalTokens: (total?.totalTokens ?? 0) + usage.totalTokens,
    ...(cachedPromptTokens > 0 ? { cachedPromptTokens } : {}),
    ...(cacheCreationPromptTokens > 0 ? { cacheCreationPromptTokens } : {}),
  };
}
