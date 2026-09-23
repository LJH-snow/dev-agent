import type { MemoryEntry } from "@dev-agent/agent-core";

const MAX_APPROVED_PLAN_CONTEXT_CHARS = 24_000;

/**
 * Returns the last useful assistant response from a plan-mode turn.
 *
 * Error entries are persisted in the same memory stream as ordinary answers,
 * so the caller must not accidentally turn an error message into the plan
 * that will be approved later.
 */
export function latestAssistantPlanText(
  entries: readonly Pick<MemoryEntry, "role" | "content">[],
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.role === "assistant" &&
      entry.content.trim().length > 0 &&
      !entry.content.trimStart().startsWith("[error]")
    ) {
      return entry.content.trim();
    }
  }
  return undefined;
}

/**
 * Makes the approval contract explicit to the normal execution turn while
 * keeping the original plan text bounded before it enters model context.
 */
export function buildApprovedPlanContext(planText: string): string {
  const prefix = [
    "APPROVED IMPLEMENTATION PLAN:",
  ].join("\n");
  const suffix = [
    "The user approved this plan. Execute it now using the available tools.",
    "Keep the implementation aligned with the approved scope, then run the relevant checks.",
  ].join("\n");
  const budgetForPlan = Math.max(
    0,
    MAX_APPROVED_PLAN_CONTEXT_CHARS - prefix.length - suffix.length - 3,
  );
  const bounded = planText.trim().slice(0, budgetForPlan);
  return [prefix, bounded, "", suffix].join("\n");
}

export const MAX_PLAN_CONTEXT_CHARS = MAX_APPROVED_PLAN_CONTEXT_CHARS;
