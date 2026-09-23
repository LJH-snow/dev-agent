import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { MemoryEntry } from "@dev-agent/agent-core";
import { redactSensitiveText, sanitizeTerminalText } from "./tui-renderer.js";

export type SessionExportFormat = "markdown" | "json";

export interface SessionExportOptions {
  readonly exportedAt?: string;
  readonly maxEntries?: number;
  readonly maxEntryChars?: number;
  readonly maxOutputBytes?: number;
}

export type SessionExportCommandResult =
  | { readonly handled: false }
  | {
      readonly handled: true;
      readonly format?: SessionExportFormat;
      readonly error?: string;
    };

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_ENTRY_CHARS = 16_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export function parseSessionExportCommand(value: string): SessionExportCommandResult {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("/")
    ? `:${trimmed.slice(1)}`
    : trimmed;
  const tokens = normalized.split(/\s+/);
  if (tokens[0]?.toLowerCase() !== ":export") {
    return { handled: false };
  }
  if (tokens.length === 1) {
    return { handled: true, format: "markdown" };
  }
  if (tokens.length !== 2) {
    return {
      handled: true,
      error: "Usage: :export [markdown|json]",
    };
  }
  const format = tokens[1]?.toLowerCase();
  if (format !== "markdown" && format !== "json") {
    return {
      handled: true,
      error: "Usage: :export [markdown|json]",
    };
  }
  return { handled: true, format };
}

export function formatSessionExport(
  entries: readonly MemoryEntry[],
  format: SessionExportFormat,
  options: SessionExportOptions = {},
): string {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const maxEntries = positiveLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxEntryChars = positiveLimit(options.maxEntryChars, DEFAULT_MAX_ENTRY_CHARS);
  const maxOutputBytes = positiveLimit(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);

  let entryLimit = Math.min(entries.length, maxEntries);
  let contentLimit = maxEntryChars;
  for (;;) {
    const safeEntries = sanitizeEntries(entries.slice(0, entryLimit), contentLimit);
    const output = formatEntries(safeEntries, format, exportedAt);
    if (Buffer.byteLength(output, "utf8") <= maxOutputBytes) {
      return output;
    }
    if (entryLimit > 1) {
      entryLimit -= 1;
      continue;
    }
    if (contentLimit > 128) {
      contentLimit = Math.max(128, Math.floor(contentLimit / 2));
      continue;
    }
    if (format === "json") {
      return formatEntries([], format, exportedAt);
    }
    return fitOutputBytes(output, maxOutputBytes);
  }
}

export async function writeSessionExport(
  entries: readonly MemoryEntry[],
  options: {
    readonly workingDirectory: string;
    readonly sessionId: string;
    readonly format: SessionExportFormat;
    readonly now?: Date;
  } & SessionExportOptions,
): Promise<string> {
  const now = options.now ?? new Date();
  const exportedAt = options.exportedAt ?? now.toISOString();
  const content = formatSessionExport(entries, options.format, {
    ...options,
    exportedAt,
  });
  const exportDirectory = join(options.workingDirectory, ".dev-agent", "exports");
  await mkdir(exportDirectory, { recursive: true, mode: 0o700 });

  const safeSessionId = sanitizeFilePart(options.sessionId);
  const stamp = formatTimestamp(now);
  const extension = options.format === "json" ? "json" : "md";
  const outputPath = join(
    exportDirectory,
    `${safeSessionId}-${stamp}.${extension}`,
  );
  const temporaryPath = join(
    exportDirectory,
    `.${safeSessionId}-${stamp}-${process.pid}-${randomBytes(4).toString("hex")}.tmp`,
  );
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, outputPath);
  return outputPath;
}

interface ExportEntry {
  readonly id: string;
  readonly role: MemoryEntry["role"];
  readonly content: string;
  readonly createdAt: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
}

function sanitizeEntries(
  entries: readonly MemoryEntry[],
  maxEntryChars: number,
): readonly ExportEntry[] {
  return entries.map((entry) => ({
    id: safeText(entry.id, 256),
    role: entry.role,
    content: safeText(entry.content, maxEntryChars),
    createdAt: safeText(entry.createdAt, 80),
    ...(entry.toolName === undefined ? {} : { toolName: safeText(entry.toolName, 256) }),
    ...(entry.toolCallId === undefined ? {} : { toolCallId: safeText(entry.toolCallId, 256) }),
  }));
}

function formatEntries(
  entries: readonly ExportEntry[],
  format: SessionExportFormat,
  exportedAt: string,
): string {
  if (format === "json") {
    return JSON.stringify(
      {
        version: 1,
        exportedAt: safeText(exportedAt, 80),
        entries,
      },
      null,
      2,
    );
  }

  const lines = [
    "# dev-agent session export",
    "",
    `Exported: ${safeText(exportedAt, 80)}`,
    `Entries: ${entries.length}`,
    "",
  ];
  entries.forEach((entry, index) => {
    const label = entry.role === "assistant"
      ? "Agent"
      : entry.role === "user"
        ? "You"
        : entry.role === "tool"
          ? `Tool${entry.toolName ? ` (${entry.toolName})` : ""}`
          : "System";
    lines.push(`## ${index + 1}. ${label}`);
    lines.push(`- id: ${entry.id}`);
    lines.push(`- created: ${entry.createdAt}`);
    lines.push("");
    lines.push(entry.content || "<empty>");
    lines.push("");
  });
  return lines.join("\n");
}

function safeText(value: string, maxChars: number): string {
  const cleaned = redactSensitiveText(sanitizeTerminalText(value));
  const chars = Array.from(cleaned);
  if (chars.length <= maxChars) return cleaned;
  return `${chars.slice(0, Math.max(1, maxChars - 18)).join("")}\n… [truncated]`;
}

function fitOutputBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const marker = "\n… [export truncated]\n";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  let output = "";
  for (const character of Array.from(value)) {
    const next = output + character;
    if (Buffer.byteLength(next, "utf8") > budget) break;
    output = next;
  }
  return `${output}${marker}`;
}

function sanitizeFilePart(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "session";
}

function formatTimestamp(value: Date): string {
  return value.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}
