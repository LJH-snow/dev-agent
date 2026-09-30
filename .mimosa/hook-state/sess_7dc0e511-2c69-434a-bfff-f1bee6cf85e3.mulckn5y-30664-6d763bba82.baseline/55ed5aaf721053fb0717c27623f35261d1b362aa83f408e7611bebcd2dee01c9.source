import { opendir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  FileMemory,
  type MemoryEntry,
} from "@dev-agent/agent-core";
import type { ChatUsage } from "@dev-agent/model";

import { redactSensitiveText, sanitizeTerminalText } from "./tui-renderer.js";

export { formatStoredSessionRow } from "./session-resume.js";

export const DEFAULT_SESSION_REGISTRY_LIMIT = 256;
export const MAX_SESSION_REGISTRY_LIMIT = 256;
export const MAX_SESSION_PREVIEW_CHARS = 240;
const MAX_SESSION_PREVIEW_BYTES = 256 * 1024;
const MAX_SESSION_ID_CHARS = 96;

export interface StoredSession {
  readonly id: string;
  readonly file: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly createdAt?: string;
  readonly lastActiveAt?: string;
  readonly entryCount?: number;
  readonly usage?: ChatUsage;
  readonly preview?: string;
  readonly readable: boolean;
}

interface SessionCandidate {
  readonly id: string;
  readonly file: string;
  readonly filePath: string;
  readonly size: number;
  readonly modifiedAt: Date;
}

interface SessionMetadataFields {
  readonly sessionId?: string;
  readonly createdAt?: string;
  readonly lastActiveAt?: string;
  readonly entryCount?: number;
  readonly usage?: ChatUsage;
}

export interface SessionRegistryOptions {
  readonly limit?: number;
}

export function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? "default" : normalized;
}

export async function listStoredSessions(
  directory: string,
  options: SessionRegistryOptions = {},
): Promise<readonly StoredSession[]> {
  const limit = normalizeLimit(options.limit);
  const candidates: SessionCandidate[] = [];
  let handle;
  try {
    handle = await opendir(directory);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  for await (const entry of handle) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const rawId = entry.name.slice(0, -".json".length);
    if (!isSafeSessionId(rawId)) {
      continue;
    }
    const filePath = join(directory, entry.name);
    try {
      const info = await stat(filePath);
      candidates.push({
        id: rawId,
        file: entry.name,
        filePath,
        size: info.size,
        modifiedAt: info.mtime,
      });
    } catch {
      // A file can disappear between opendir and stat. Ignore only that entry.
    }
  }

  candidates.sort(compareCandidates);
  const visible = candidates.slice(0, limit);
  const sessions = await Promise.all(visible.map(readStoredSession));
  return sessions.sort(compareStoredSessions);
}

export function searchStoredSessions(
  sessions: readonly StoredSession[],
  query: string,
  limit = 50,
): readonly StoredSession[] {
  const normalizedQuery = sanitizeSearchQuery(query).toLocaleLowerCase();
  const matches = normalizedQuery.length === 0
    ? [...sessions]
    : sessions.filter((session) => {
        const haystack = [
          session.id,
          session.preview ?? "",
          session.createdAt ?? "",
          session.lastActiveAt ?? "",
        ].join("\n").toLocaleLowerCase();
        return haystack.includes(normalizedQuery);
      });
  return matches.slice(0, normalizeSearchLimit(limit));
}

async function readStoredSession(candidate: SessionCandidate): Promise<StoredSession> {
  if (candidate.size > MAX_SESSION_PREVIEW_BYTES) {
    return {
      id: candidate.id,
      file: candidate.file,
      size: candidate.size,
      modifiedAt: candidate.modifiedAt.toISOString(),
      readable: false,
    };
  }

  const memory = new FileMemory({
    filePath: candidate.filePath,
    sessionId: candidate.id,
  });
  const metadata = await memory.getMetadata();
  try {
    const entries = await readStoredEntries(candidate.filePath);
    // Keep the registry aligned with FileMemory's full envelope validation
    // while the file is still within the bounded preview read limit.
    await memory.entries();
    const derived = metadata ?? deriveMetadata(entries, candidate.id);
    const preview = createPreview(entries);
    return {
      id: candidate.id,
      file: candidate.file,
      size: candidate.size,
      modifiedAt: candidate.modifiedAt.toISOString(),
      ...metadataFields(derived),
      ...(preview === undefined ? {} : { preview }),
      readable: true,
    };
  } catch {
    return {
      id: candidate.id,
      file: candidate.file,
      size: candidate.size,
      modifiedAt: candidate.modifiedAt.toISOString(),
      ...(metadata === undefined ? {} : metadataFields(metadata)),
      readable: false,
    };
  }
}

async function readStoredEntries(filePath: string): Promise<readonly MemoryEntry[]> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("invalid session file");
  }
  if (parsed.summary !== undefined && !isContextSummary(parsed.summary)) {
    throw new Error("invalid session summary");
  }
  if (!parsed.entries.every(isMemoryEntry)) {
    throw new Error("invalid session entries");
  }
  return parsed.entries;
}

function deriveMetadata(
  entries: readonly MemoryEntry[],
  sessionId: string,
): SessionMetadataFields {
  return {
    sessionId,
    ...(entries[0]?.createdAt === undefined ? {} : { createdAt: entries[0].createdAt }),
    ...(entries.at(-1)?.createdAt === undefined
      ? {}
      : { lastActiveAt: entries.at(-1)!.createdAt }),
    entryCount: entries.length,
  };
}

function metadataFields(metadata: SessionMetadataFields): Pick<
  StoredSession,
  "createdAt" | "lastActiveAt" | "entryCount" | "usage"
> {
  return {
    ...(metadata.createdAt === undefined ? {} : { createdAt: metadata.createdAt }),
    ...(metadata.lastActiveAt === undefined ? {} : { lastActiveAt: metadata.lastActiveAt }),
    ...(metadata.entryCount === undefined ? {} : { entryCount: metadata.entryCount }),
    ...(metadata.usage === undefined ? {} : { usage: metadata.usage }),
  };
}

function createPreview(entries: readonly MemoryEntry[]): string | undefined {
  const entry = [...entries].reverse().find(
    (candidate) => candidate.role === "user" || candidate.role === "assistant",
  );
  if (entry === undefined) {
    return undefined;
  }
  const label = entry.role === "user" ? "You" : "Agent";
  const prefix = `${label}: `;
  const cleaned = redactSensitiveText(sanitizeTerminalText(entry.content))
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) {
    return `${prefix}<empty>`;
  }
  const prefixLength = Array.from(prefix).length;
  const contentLimit = Math.max(0, MAX_SESSION_PREVIEW_CHARS - prefixLength);
  const chars = Array.from(cleaned);
  if (chars.length <= contentLimit) {
    return `${prefix}${cleaned}`;
  }
  const suffix = "...";
  const contentLength = Math.max(0, contentLimit - Array.from(suffix).length);
  return `${prefix}${chars.slice(0, contentLength).join("")}${suffix}`;
}

function compareCandidates(left: SessionCandidate, right: SessionCandidate): number {
  const modified = right.modifiedAt.getTime() - left.modifiedAt.getTime();
  return modified !== 0 ? modified : left.id.localeCompare(right.id);
}

function compareStoredSessions(left: StoredSession, right: StoredSession): number {
  const modified = Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt);
  return modified !== 0 ? modified : left.id.localeCompare(right.id);
}

function isSafeSessionId(value: string): boolean {
  return (
    value.length > 0 &&
    Array.from(value).length <= MAX_SESSION_ID_CHARS &&
    normalizeSessionId(value) === value
  );
}

function normalizeLimit(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? Math.min(value, MAX_SESSION_REGISTRY_LIMIT)
    : DEFAULT_SESSION_REGISTRY_LIMIT;
}

function normalizeSearchLimit(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 50) : 50;
}

function sanitizeSearchQuery(value: string): string {
  return Array.from(value.replaceAll("\u0000", "").trim()).slice(0, 160).join("");
}

function isContextSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.lastEntryId === "string" &&
    typeof value.entriesCovered === "number" &&
    Number.isSafeInteger(value.entriesCovered) &&
    value.entriesCovered >= 0 &&
    typeof value.text === "string"
  );
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "system" ||
      value.role === "user" ||
      value.role === "assistant" ||
      value.role === "tool") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
