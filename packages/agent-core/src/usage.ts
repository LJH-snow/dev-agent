import type { ChatUsage } from "@dev-agent/model";

/** Adds one usage report to a running total. */
export function addUsage(total: ChatUsage | undefined, usage: ChatUsage): ChatUsage {
  return {
    promptTokens: (total?.promptTokens ?? 0) + usage.promptTokens,
    completionTokens: (total?.completionTokens ?? 0) + usage.completionTokens,
    totalTokens: (total?.totalTokens ?? 0) + usage.totalTokens,
  };
}
