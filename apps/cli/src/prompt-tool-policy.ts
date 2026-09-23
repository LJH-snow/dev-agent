/**
 * Conservatively recognize standalone greetings that need no workspace tools.
 * Every other request keeps the full tool set; this is a latency optimization,
 * not an intent classifier or a permission decision.
 */
const TOOL_FREE_GREETING = /^(?:hi|hello|hey|howdy|good\s+(?:morning|afternoon|evening)|你好|您好|嗨|哈喽|早上好|早安|下午好|晚上好|晚安)[\s,!.?。！？~～]*$/iu;

export function resolvePromptToolAccess(prompt: string): "all" | "none" {
  return TOOL_FREE_GREETING.test(prompt.normalize("NFKC").trim()) ? "none" : "all";
}
