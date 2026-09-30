export const MAX_COLLABORATION_TOOL_SCOPE = 256;

export interface CollaborationToolChoice {
  readonly name: string;
  readonly description: string;
  readonly risk: string;
  readonly confirmation: string;
}

export class CollaborationAuthorizationCancelledError extends Error {
  constructor() {
    super("Collaboration tool authorization was cancelled.");
    this.name = "CollaborationAuthorizationCancelledError";
  }
}

export type CollaborationToolSelection =
  | { readonly kind: "cancel" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "selected"; readonly toolNames: readonly string[] };

export function parseCollaborationToolSelection(
  input: string,
  choices: readonly CollaborationToolChoice[],
): CollaborationToolSelection {
  const trimmed = input.trim();
  if (trimmed === "") return { kind: "cancel" };
  if (trimmed.toLowerCase() === "none") {
    return { kind: "selected", toolNames: [] };
  }
  if (input.length > 65_536) {
    return { kind: "invalid", message: "The tool selection is too long." };
  }

  const toolNames = trimmed.split(",").map((name) => name.trim());
  if (toolNames.some((name) => name === "")) {
    return {
      kind: "invalid",
      message: "Use comma-separated tool names without empty entries.",
    };
  }
  if (toolNames.length > MAX_COLLABORATION_TOOL_SCOPE) {
    return {
      kind: "invalid",
      message: `Select at most ${MAX_COLLABORATION_TOOL_SCOPE} tools for one task.`,
    };
  }

  const available = new Set(choices.map((choice) => choice.name));
  const selected = new Set<string>();
  for (const name of toolNames) {
    if (selected.has(name)) {
      return { kind: "invalid", message: `Tool '${name}' is listed more than once.` };
    }
    if (!available.has(name)) {
      return {
        kind: "invalid",
        message: `Tool '${name}' is not available for this collaboration task.`,
      };
    }
    selected.add(name);
  }

  return { kind: "selected", toolNames };
}
