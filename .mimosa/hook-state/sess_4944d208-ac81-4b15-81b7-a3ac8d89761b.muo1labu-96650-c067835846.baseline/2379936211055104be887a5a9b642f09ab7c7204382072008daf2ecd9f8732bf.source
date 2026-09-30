import { randomUUID } from "node:crypto";

import type { AgentMemory, FileMemory } from "./memory.js";

export interface AgentCheckpoint {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly lastEntryId?: string;
  readonly entryCount: number;
  readonly changeSetIds: readonly string[];
}

export interface CheckpointRestoreResult {
  readonly checkpoint: AgentCheckpoint;
  readonly memoryAnchor: {
    readonly lastEntryId?: string;
    readonly entryCount: number;
  };
  readonly changeSetIds: readonly string[];
}

export interface CheckpointRewindResult {
  readonly checkpoint: AgentCheckpoint;
  readonly removedEntryCount: number;
  readonly remainingEntryCount: number;
  readonly retainedCheckpointIds: readonly string[];
  readonly changeSetIds: readonly string[];
  /** Conversation rewind never changes workspace files. */
  readonly workspaceChanged: false;
}

export interface CheckpointStore {
  create(): Promise<AgentCheckpoint>;
  list(): Promise<readonly AgentCheckpoint[]>;
  inspect(checkpointId: string): Promise<AgentCheckpoint | undefined>;
  /** Returns the anchor without changing memory or the workspace. */
  restore(checkpointId: string): Promise<CheckpointRestoreResult>;
  /** Truncates conversation history at the anchor; never rolls back files. */
  rewind(checkpointId: string): Promise<CheckpointRewindResult>;
}

/**
 * Stores metadata-only anchors in the same FileMemory envelope as the
 * conversation and evidence records. Restore never writes to the workspace.
 */
export class FileMemoryCheckpointStore implements CheckpointStore {
  constructor(private readonly memory: FileMemory | AgentMemory) {}

  async create(): Promise<AgentCheckpoint> {
    const entries = await this.memory.entries();
    const changeSets = (await this.memory.changeSets?.()) ?? [];
    const metadata = await this.memory.getMetadata?.();
    const checkpoint: AgentCheckpoint = {
      id: `checkpoint-${randomUUID()}`,
      sessionId: metadata?.sessionId ?? "unknown",
      createdAt: new Date().toISOString(),
      ...(entries.at(-1)?.id === undefined ? {} : { lastEntryId: entries.at(-1)?.id }),
      entryCount: entries.length,
      changeSetIds: changeSets.map((record) => record.changeSetId),
    };
    if (!this.memory.recordCheckpoint) {
      throw new Error("checkpoint persistence is unavailable");
    }
    await this.memory.recordCheckpoint(checkpoint);
    return checkpoint;
  }

  async list(): Promise<readonly AgentCheckpoint[]> {
    if (!this.memory.checkpoints) {
      throw new Error("checkpoint persistence is unavailable");
    }
    return this.memory.checkpoints();
  }

  async inspect(checkpointId: string): Promise<AgentCheckpoint | undefined> {
    const checkpoints = await this.list();
    return checkpoints.find((checkpoint) => checkpoint.id === checkpointId);
  }

  async restore(checkpointId: string): Promise<CheckpointRestoreResult> {
    const checkpoint = await this.inspect(checkpointId);
    if (!checkpoint) {
      throw new Error(`unknown checkpoint: ${checkpointId}`);
    }
    return {
      checkpoint,
      memoryAnchor: {
        ...(checkpoint.lastEntryId === undefined ? {} : { lastEntryId: checkpoint.lastEntryId }),
        entryCount: checkpoint.entryCount,
      },
      changeSetIds: [...checkpoint.changeSetIds],
    };
  }

  async rewind(checkpointId: string): Promise<CheckpointRewindResult> {
    const checkpoint = await this.inspect(checkpointId);
    if (!checkpoint) {
      throw new Error(`unknown checkpoint: ${checkpointId}`);
    }
    if (!this.memory.rewindToCheckpoint) {
      throw new Error("conversation rewind is unavailable for this memory");
    }
    const result = await this.memory.rewindToCheckpoint(checkpoint);
    return {
      checkpoint,
      removedEntryCount: result.removedEntryCount,
      remainingEntryCount: result.remainingEntryCount,
      retainedCheckpointIds: [...result.retainedCheckpointIds],
      changeSetIds: [...checkpoint.changeSetIds],
      workspaceChanged: false,
    };
  }
}
