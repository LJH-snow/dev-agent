import { spawnSync as nodeSpawnSync } from "node:child_process";
import { closeSync, fstatSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AlternateScreenSession } from "./alternate-screen.js";

// External $EDITOR support for the interactive Ink TUI: `:editor` suspends the
// rendering session, hands the terminal to the user's editor on a private
// bounded temp file, and loads the saved content back into the composer.
// Everything here fails closed: refusals never spawn, failures never expose
// editor output, and every temp resource is removed on all exit paths.

export const MAX_EDITOR_CHARS = 8_000;
const MAX_EDITOR_BYTES = 64_000;
const TEMP_PREFIX = "dev-agent-editor-";

export interface ResolvedEditorCommand {
  readonly command: string;
  readonly extraTokens: readonly string[];
}

/**
 * Resolves the editor executable from the environment: `$VISUAL` wins over
 * `$EDITOR`, falling back to `vi`. Only a single executable token is
 * supported — any extra whitespace-separated tokens are returned in
 * `extraTokens` so the caller can refuse the value instead of interpreting
 * it loosely. There is intentionally no shell, no quoting, and no flag
 * support; users who need flags can point VISUAL/EDITOR at a wrapper script.
 */
export function resolveEditorCommand(
  env: Record<string, string | undefined> = process.env,
): ResolvedEditorCommand {
  const configured = (env.VISUAL ?? env.EDITOR ?? "vi").trim();
  const tokens = configured.split(/\s+/).filter((token) => token.length > 0);
  return { command: tokens[0] ?? "vi", extraTokens: tokens.slice(1) };
}

// The command token is executed with shell: false, so shell metacharacters
// cannot widen execution — but any token containing one is rejected outright
// (fail closed) instead of being interpreted loosely. This also gives
// surprising configurations (`EDITOR="vi; x"`) a clear refusal.
const UNSAFE_EDITOR_TOKEN = /[;&|`$<>(){}[\]'"\\\n\r\0]/;

export function editorTokensAreSafe(tokens: readonly string[]): boolean {
  return tokens.every((token) => !UNSAFE_EDITOR_TOKEN.test(token));
}

export interface NormalizedEditorContent {
  readonly value: string;
  readonly truncated: boolean;
}

/**
 * Normalizes editor output for the composer: CRLF and CR become LF, one
 * trailing newline (every editor appends one) is stripped, and the value is
 * capped at MAX_EDITOR_CHARS characters with an explicit truncation flag.
 */
export function normalizeEditorContent(raw: string): NormalizedEditorContent {
  const unified = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutFinalNewline = unified.endsWith("\n") ? unified.slice(0, -1) : unified;
  const chars = Array.from(withoutFinalNewline);
  const truncated = chars.length > MAX_EDITOR_CHARS;
  return {
    value: truncated ? chars.slice(0, MAX_EDITOR_CHARS).join("") : withoutFinalNewline,
    truncated,
  };
}

export interface GatedWriteOutput<T> {
  readonly output: T;
  setWritesPaused: (paused: boolean) => void;
}

/**
 * Wraps the stream handed to Ink so whole frames can be dropped while an
 * external editor owns the terminal. Dropped writes return `true` (Ink's
 * renderer treats them as delivered and keeps its internal frame state); all
 * other properties forward to the underlying stream.
 */
export function createGatedWriteOutput<T extends NodeJS.WriteStream>(
  output: T,
): GatedWriteOutput<T> {
  let paused = false;
  const gated = new Proxy(output, {
    get(target, property, receiver) {
      if (property === "write") {
        return (chunk: unknown, ...rest: unknown[]): boolean => {
          if (paused) return true;
          return Reflect.apply(
            target.write,
            target,
            [chunk, ...rest] as unknown[],
          ) as boolean;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    output: gated,
    setWritesPaused(next: boolean) {
      paused = next;
    },
  };
}

export interface EditorStdin {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode?(raw: boolean): unknown;
}

export interface SpawnSyncLikeResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

/**
 * The single spawn site of this module. The validated command runs with
 * `shell: false` and a fixed argument shape: `--` precedes the only dynamic
 * value (the temp file path), so no argument can be reinterpreted as an
 * option by the editor program.
 */
export type EditorSpawnRunner = (
  command: string,
  args: readonly string[],
) => SpawnSyncLikeResult;

const defaultEditorRunner: EditorSpawnRunner = (command, args) => {
  const result = nodeSpawnSync(command, [...args], {
    stdio: "inherit",
    shell: false,
  });
  return { status: result.status, signal: result.signal, error: result.error };
};

export type ExternalEditorOutcome =
  | { readonly status: "completed"; readonly value: string; readonly truncated: boolean }
  | { readonly status: "empty" }
  | {
      readonly status: "refused";
      readonly reason: "unsupported-platform" | "not-a-tty" | "unsupported-editor-value";
    }
  | { readonly status: "failed"; readonly detail: string };

export interface ExternalEditorDeps {
  readonly env?: Record<string, string | undefined>;
  readonly platform?: NodeJS.Platform;
  readonly stdin?: EditorStdin;
  readonly spawnRunner?: EditorSpawnRunner;
  readonly createTempDir?: (prefix: string) => string;
  readonly removeTempDir?: (dir: string) => void;
  readonly setInkWritesPaused?: (paused: boolean) => void;
  readonly alternateScreen?: Pick<AlternateScreenSession, "enter" | "exit">;
}

function createDefaultTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeDefaultTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Reads at most MAX_EDITOR_BYTES from the file so a huge editor buffer can
 * never blow the CLI's memory budget. The byte-bounded read sets the
 * truncation flag; the character cap is applied afterwards.
 */
function readBoundedText(filePath: string): { text: string; byteTruncated: boolean } {
  const descriptor = openSync(filePath, "r");
  try {
    const size = fstatSync(descriptor).size;
    const budget = Buffer.alloc(MAX_EDITOR_BYTES);
    const read = readSync(descriptor, budget, 0, MAX_EDITOR_BYTES, 0);
    return {
      text: budget.toString("utf8", 0, read),
      byteTruncated: size > read,
    };
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Opens the user's editor on a private temp file and returns its saved
 * content. The terminal is prepared by the suspend steps and restored before
 * the outcome is returned, even when the editor fails to start.
 */
export function runExternalEditor(deps: ExternalEditorDeps = {}): ExternalEditorOutcome {
  if ((deps.platform ?? process.platform) === "win32") {
    return { status: "refused", reason: "unsupported-platform" };
  }
  const stdin = deps.stdin;
  if (!stdin || stdin.isTTY !== true) {
    return { status: "refused", reason: "not-a-tty" };
  }

  const editor = resolveEditorCommand(deps.env ?? process.env);
  if (
    editor.extraTokens.length > 0 ||
    !editorTokensAreSafe([editor.command])
  ) {
    return { status: "refused", reason: "unsupported-editor-value" };
  }

  const spawnRunner = deps.spawnRunner ?? defaultEditorRunner;
  const createTempDir = deps.createTempDir ?? createDefaultTempDir;
  const removeTempDir = deps.removeTempDir ?? removeDefaultTempDir;

  const tempDir = createTempDir(TEMP_PREFIX);
  const filePath = join(tempDir, "prompt.md");
  let wasRaw = false;
  try {
    writeFileSync(filePath, "", { mode: 0o600 });

    deps.setInkWritesPaused?.(true);
    deps.alternateScreen?.exit();
    if (stdin.isRaw && stdin.setRawMode) {
      wasRaw = true;
      stdin.setRawMode(false);
    }

    const result = spawnRunner(editor.command, ["--", filePath]);

    if (stdin.setRawMode) {
      stdin.setRawMode(wasRaw);
    }
    deps.alternateScreen?.enter();
    deps.setInkWritesPaused?.(false);

    if (result.error !== undefined) {
      const code = (result.error as NodeJS.ErrnoException).code;
      return {
        status: "failed",
        detail: `editor failed to start: ${typeof code === "string" ? code : "unknown"}`,
      };
    }
    if (result.signal !== null) {
      return { status: "failed", detail: `editor terminated by ${result.signal}` };
    }
    if (result.status !== 0) {
      return { status: "failed", detail: `editor exited with code ${result.status}` };
    }

    let fileText: string;
    let byteTruncated: boolean;
    try {
      const bounded = readBoundedText(filePath);
      fileText = bounded.text;
      byteTruncated = bounded.byteTruncated;
    } catch {
      // The editor may have deleted or replaced the buffer file.
      return { status: "empty" };
    }
    const normalized = normalizeEditorContent(fileText);
    if (normalized.value.trim().length === 0) {
      return { status: "empty" };
    }
    return {
      status: "completed",
      value: normalized.value,
      truncated: normalized.truncated || byteTruncated,
    };
  } finally {
    try {
      removeTempDir(tempDir);
    } catch {
      // Cleanup is best-effort; never block session flow on it.
    }
  }
}
