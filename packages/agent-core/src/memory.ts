import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ChatMessage, ToolCall } from "@dev-agent/model";

export interface MemoryEntry extends ChatMessage {
  readonly id: string;
  readonly createdAt: string;
}

export interface MemoryEntryOptions {
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface AgentMemory {
  append(entry: MemoryEntry): Promise<void>;
  entries(): Promise<readonly MemoryEntry[]>;
  clear(): Promise<void>;
  getMetadata?(): Promise<SessionMetadata | undefined>;
  compact?(keepRecentTurns: number): Promise<number>;
  /** Digest of entries that were trimmed off the front of the history. */
  getSummary?(): Promise<ContextSummary | undefined>;
  setSummary?(summary: ContextSummary): Promise<void>;
}

export interface ContextSummary {
  /** Id of the last entry the digest covers, used to re-anchor after a reload. */
  readonly lastEntryId: string;
  /** How many entries the digest covered when it was written. */
  readonly entriesCovered: number;
  readonly text: string;
}

export class InMemoryMemory implements AgentMemory {
  private readonly items: MemoryEntry[] = [];
  private summary?: ContextSummary;

  async append(entry: MemoryEntry): Promise<void> {
    this.items.push(entry);
  }

  async entries(): Promise<readonly MemoryEntry[]> {
    return [...this.items];
  }

  async clear(): Promise<void> {
    this.items.length = 0;
    this.summary = undefined;
  }

  async getSummary(): Promise<ContextSummary | undefined> {
    return this.summary;
  }

  async setSummary(summary: ContextSummary): Promise<void> {
    this.summary = summary;
  }
}

export interface FileMemoryOptions {
  readonly filePath: string;
}

export interface SessionMetadata {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly entryCount: number;
}

interface MemoryFile {
  readonly version: 1;
  readonly metadata?: SessionMetadata;
  readonly entries: MemoryEntry[];
  readonly summary?: ContextSummary;
}

export class FileMemory implements AgentMemory {
  private readonly filePath: string;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: FileMemoryOptions) {
    this.filePath = options.filePath;
  }

  async getMetadata(): Promise<SessionMetadata | undefined> {
    try {
      const file = await this.readMemoryFile();
      return file.metadata;
    } catch {
      return undefined;
    }
  }

  async compact(keepRecentTurns: number): Promise<number> {
    return this.enqueue(async () => {
      const entries = await this.readEntries();
      const keepEntries = keepRecentTurns * 4;
      if (entries.length <= keepEntries) {
        return 0;
      }
      const removed = entries.length - keepEntries;
      const compacted = entries.slice(-keepEntries);
      await this.persist(compacted);
      return removed;
    });
  }

  append(entry: MemoryEntry): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.readEntries();
      entries.push(entry);
      await this.persist(entries);
    });
  }

  entries(): Promise<readonly MemoryEntry[]> {
    return this.enqueue(async () => [...(await this.readEntries())]);
  }

  clear(): Promise<void> {
    return this.enqueue(() => rm(this.filePath, { force: true }));
  }

  async getSummary(): Promise<ContextSummary | undefined> {
    try {
      const file = await this.readMemoryFile();
      return file.summary;
    } catch {
      return undefined;
    }
  }

  setSummary(summary: ContextSummary): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.readEntries();
      await this.persist(entries, summary);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async readEntries(): Promise<MemoryEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid memory file: ${this.filePath}`);
    }
    if (!isMemoryFile(parsed)) {
      throw new Error(`Invalid memory file: ${this.filePath}`);
    }
    return parsed.entries;
  }

  private async persist(
    entries: readonly MemoryEntry[],
    summary?: ContextSummary
  ): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const existing = await this.readMemoryFile().catch(() => undefined);
    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
      sessionId: existing?.metadata?.sessionId ?? "default",
      createdAt: existing?.metadata?.createdAt ?? now,
      lastActiveAt: now,
      entryCount: entries.length,
    };
    const payload: MemoryFile = {
      version: 1,
      metadata,
      entries: [...entries],
      // Keep an existing digest unless this write replaces it.
      summary: summary ?? existing?.summary,
    };
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private async readMemoryFile(): Promise<MemoryFile> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isMemoryFile(parsed)) {
      throw new Error(`Invalid memory file: ${this.filePath}`);
    }
    return parsed;
  }
}

export function createMemoryEntry(
  role: ChatMessage["role"],
  content: string,
  options: MemoryEntryOptions = {}
): MemoryEntry {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    toolCalls: options.toolCalls,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isMemoryFile(value: unknown): value is MemoryFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isMemoryEntry) &&
    (candidate.summary === undefined || isContextSummary(candidate.summary))
  );
}

function isContextSummary(value: unknown): value is ContextSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.lastEntryId === "string" &&
    typeof candidate.entriesCovered === "number" &&
    typeof candidate.text === "string"
  );
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    isChatMessageRole(candidate.role) &&
    typeof candidate.content === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function isChatMessageRole(value: unknown): value is ChatMessage["role"] {
  return value === "system" || value === "user" || value === "assistant" || value === "tool";
}
