import {
  redactSensitiveText,
  sanitizeTerminalText,
} from "./tui-renderer.js";
import type { StoredSession } from "./session-registry.js";

export type SessionResumeCommandResult =
  | { readonly handled: false }
  | {
      readonly handled: true;
      readonly action: "open";
      readonly query?: string;
      readonly error?: never;
    }
  | {
      readonly handled: true;
      readonly error: string;
      readonly action?: never;
      readonly query?: never;
    };

export function parseSessionResumeCommand(value: string): SessionResumeCommandResult {
  if (value.includes("\u0000")) {
    return { handled: true, error: "Usage: :sessions [query]" };
  }
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("/")
    ? `:${trimmed.slice(1)}`
    : trimmed;
  const match = /^:(sessions|resume)(?:\s+([\s\S]*))?$/i.exec(normalized);
  if (!match) {
    return { handled: false };
  }
  const query = match[2]?.trim();
  return {
    handled: true,
    action: "open",
    ...(query === undefined || query.length === 0
      ? {}
      : { query: Array.from(query).slice(0, 160).join("") }),
  };
}

export function formatStoredSessionRow(session: StoredSession): string {
  const id = safeText(session.id);
  if (!session.readable) {
    return `${id} · unavailable`;
  }
  const entryLabel = session.entryCount === undefined
    ? "entries unknown"
    : `${session.entryCount} ${session.entryCount === 1 ? "entry" : "entries"}`;
  const activity = session.lastActiveAt ?? session.modifiedAt;
  const preview = session.preview === undefined ? "" : ` · ${safeText(session.preview)}`;
  return `${id} · ${entryLabel} · ${safeText(activity)}${preview}`;
}

function safeText(value: string): string {
  return redactSensitiveText(sanitizeTerminalText(value))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}
