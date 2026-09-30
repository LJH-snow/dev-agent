import type { MemoryEntry } from "@dev-agent/agent-core";

import { redactSensitiveText, sanitizeTerminalText } from "./tui-renderer.js";

export const DEFAULT_HISTORY_LIMIT = 10;
export const MAX_HISTORY_LIMIT = 50;
export const DEFAULT_HISTORY_CONTENT_CHARS = 320;
export const MAX_HISTORY_QUERY_CHARS = 160;

export type SessionHistoryCommandResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly limit?: number; readonly error?: string };

export type SessionSearchCommandResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly query?: string; readonly error?: string };

export interface SessionHistoryFormatOptions {
  readonly limit?: number;
  readonly maxContentChars?: number;
}

export interface SessionHistorySearchOptions extends SessionHistoryFormatOptions {
  readonly limit?: number;
}

/**
 * Parses the read-only interactive history command.
 *
 * Slash aliases are accepted here as well as in the main command normalizer so
 * the helper remains safe to use from tests and other interactive adapters.
 */
export function parseSessionHistoryCommand(value: string): SessionHistoryCommandResult {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("/")
    ? `:${trimmed.slice(1)}`
    : trimmed;
  const tokens = normalized.split(/\s+/);
  if (tokens[0]?.toLowerCase() !== ":history") {
    return { handled: false };
  }
  if (tokens.length === 1) {
    return { handled: true, limit: DEFAULT_HISTORY_LIMIT };
  }
  if (tokens.length !== 2 || !/^\d+$/.test(tokens[1] ?? "")) {
    return { handled: true, error: "Usage: :history [count]" };
  }
  const requested = Number.parseInt(tokens[1]!, 10);
  if (!Number.isSafeInteger(requested) || requested < 1) {
    return { handled: true, error: "Usage: :history [count]" };
  }
  return {
    handled: true,
    limit: Math.min(requested, MAX_HISTORY_LIMIT),
  };
}

export function parseSessionSearchCommand(value: string): SessionSearchCommandResult {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("/")
    ? `:${trimmed.slice(1)}`
    : trimmed;
  if (normalized.slice(0, 7).toLowerCase() !== ":search") {
    return { handled: false };
  }
  const separator = normalized.charAt(7);
  if (separator !== "" && !/\s/.test(separator)) {
    return { handled: false };
  }
  const query = normalized.slice(7).trim();
  if (query.length === 0) {
    return { handled: true, error: "Usage: :search <query>" };
  }
  const bounded = Array.from(query).slice(0, MAX_HISTORY_QUERY_CHARS).join("");
  return { handled: true, query: bounded };
}

/**
 * Formats only bounded, already-persisted conversation entries for a local
 * operator. It never serializes tool-call inputs or returns an unbounded model
 * response to the terminal.
 */
export function formatSessionHistory(
  entries: readonly MemoryEntry[],
  options: SessionHistoryFormatOptions = {},
): string {
  if (entries.length === 0) {
    return "No conversation history.";
  }

  const limit = normalizeLimit(options.limit);
  const maxContentChars = normalizeContentLimit(options.maxContentChars);
  const visible = entries.slice(-limit);
  const firstIndex = entries.length - visible.length;
  const lines = [`History: showing ${visible.length} of ${entries.length} entries`];

  visible.forEach((entry, index) => {
    const label = roleLabel(entry);
    const content = compactContent(entry.content, maxContentChars);
    lines.push(`${firstIndex + index + 1}. ${label}: ${content}`);
  });

  return lines.join("\n");
}

export function formatSessionSearch(
  entries: readonly MemoryEntry[],
  query: string,
  options: SessionHistorySearchOptions = {},
): string {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return "Usage: :search <query>";
  }

  const maxContentChars = normalizeContentLimit(options.maxContentChars);
  const matches = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const haystack = `${entry.content}\n${entry.toolName ?? ""}`.toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });

  const safeQuery = compactLabel(query);
  if (matches.length === 0) {
    return `No history entries matching "${safeQuery}".`;
  }

  const limit = normalizeLimit(options.limit);
  const visible = matches.slice(-limit);
  const lines = [
    `Search: "${safeQuery}" · showing ${visible.length} of ${matches.length} matches`,
  ];
  for (const match of visible) {
    lines.push(
      `${match.index + 1}. ${roleLabel(match.entry)}: ${compactContent(match.entry.content, maxContentChars)}`,
    );
  }
  return lines.join("\n");
}

function roleLabel(entry: MemoryEntry): string {
  if (entry.role === "tool") {
    return entry.toolName ? `Tool (${compactLabel(entry.toolName)})` : "Tool";
  }
  if (entry.role === "assistant") return "Agent";
  if (entry.role === "user") return "You";
  return "System";
}

function compactLabel(value: string): string {
  return redactSensitiveText(sanitizeTerminalText(value)).replace(/\s+/g, " ").trim() || "unknown";
}

function compactContent(value: string, maxChars: number): string {
  const cleaned = redactSensitiveText(sanitizeTerminalText(value))
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) {
    return "<empty>";
  }
  if (Array.from(cleaned).length <= maxChars) {
    return cleaned;
  }
  return `${Array.from(cleaned).slice(0, Math.max(1, maxChars - 3)).join("")}...`;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 1) {
    return DEFAULT_HISTORY_LIMIT;
  }
  return Math.min(value, MAX_HISTORY_LIMIT);
}

function normalizeContentLimit(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 4) {
    return DEFAULT_HISTORY_CONTENT_CHARS;
  }
  return value;
}
