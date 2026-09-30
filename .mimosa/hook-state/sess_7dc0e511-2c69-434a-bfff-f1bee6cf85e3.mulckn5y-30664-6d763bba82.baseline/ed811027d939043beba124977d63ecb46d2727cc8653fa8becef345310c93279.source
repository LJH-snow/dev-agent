import type {
  CheckpointStore,
  CheckpointRewindResult,
} from "@dev-agent/agent-core";

export interface CheckpointCommandResult {
  readonly handled: boolean;
  readonly message?: string;
  readonly rewound?: boolean;
}

export function isCheckpointCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized === ":checkpoint" ||
    normalized === "/checkpoint" ||
    normalized === ":checkpoint create" ||
    normalized === "/checkpoint create" ||
    normalized === ":checkpoints" ||
    normalized === "/checkpoints" ||
    normalized === ":rewind" ||
    normalized.startsWith(":rewind ") ||
    normalized === "/rewind" ||
    normalized.startsWith("/rewind ");
}

export async function executeCheckpointCommand(
  command: string,
  store: CheckpointStore
): Promise<CheckpointCommandResult> {
  const normalized = command.trim();
  const lower = normalized.toLowerCase();
  if (
    lower === ":checkpoint" ||
    lower === "/checkpoint" ||
    lower === ":checkpoint create" ||
    lower === "/checkpoint create"
  ) {
    const checkpoint = await store.create();
    return {
      handled: true,
      message:
        `Checkpoint created: ${checkpoint.id} at ${checkpoint.entryCount} entries ` +
        "(conversation history only; workspace unchanged).",
    };
  }

  if (lower === ":checkpoints" || lower === "/checkpoints") {
    const checkpoints = await store.list();
    return {
      handled: true,
      message: formatCheckpointList(checkpoints),
    };
  }

  if (lower === ":rewind" || lower === "/rewind") {
    return {
      handled: true,
      message: "Usage: :rewind <checkpointId>",
    };
  }

  const rewindMatch = normalized.match(/^[:/]rewind\s+(.+)$/iu);
  if (rewindMatch) {
    const checkpointId = rewindMatch[1]?.trim() ?? "";
    if (!checkpointId || /\s/u.test(checkpointId)) {
      return {
        handled: true,
        message: "Usage: :rewind <checkpointId>",
      };
    }
    const result = await store.rewind(checkpointId);
    return {
      handled: true,
      rewound: true,
      message: formatRewindResult(result),
    };
  }

  return { handled: false };
}

function formatCheckpointList(
  checkpoints: readonly {
    readonly id: string;
    readonly entryCount: number;
    readonly createdAt: string;
  }[]
): string {
  if (checkpoints.length === 0) {
    return "No conversation checkpoints.";
  }
  return [
    "Conversation checkpoints:",
    ...checkpoints.map(
      (checkpoint) =>
        `- ${checkpoint.id} · ${checkpoint.entryCount} entr${
          checkpoint.entryCount === 1 ? "y" : "ies"
        } · ${checkpoint.createdAt}`
    ),
  ].join("\n");
}

function formatRewindResult(result: CheckpointRewindResult): string {
  const removed = result.removedEntryCount === 1
    ? "1 entry"
    : `${result.removedEntryCount} entries`;
  return (
    `Rewound conversation to ${result.checkpoint.id}: removed ${removed}; ` +
    "workspace unchanged."
  );
}
