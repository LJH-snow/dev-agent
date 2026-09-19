import { colorize } from "./colors.js";
import { renderSignalLoomMark, renderSignalLoomWordmark } from "./tui-brand.js";
import type { ToolCard, TuiRunState } from "./tui-session.js";
import { displayWidth, splitByDisplayWidth, truncateToDisplayWidth } from "./tui-width.js";

const DEFAULT_WIDTH = 80;

export interface WelcomeOptions {
  provider: string;
  model: string;
  streaming: boolean;
  runState?: TuiRunState;
  sessionId: string;
  workingDirectory: string;
  mcpCount?: number;
  executor?: string;
  width?: number;
}

export interface AssistantMessageOptions {
  label?: string;
  width?: number;
}

export interface CommandHint {
  command: string;
  description?: string;
}

export interface CommandHintsOptions {
  width?: number;
}

export interface BlockOptions {
  width?: number;
}

export const DEFAULT_COMMAND_HINTS: readonly CommandHint[] = [
  { command: ":help", description: "Show available commands" },
  { command: ":clear", description: "Clear the terminal view" },
  { command: ":model", description: "Show the current provider and model" },
  { command: ":validate <changeSetId>", description: "Rerun trusted checks" },
  { command: ":cleanup ...", description: "Prune metadata-only evidence" },
  { command: ":quit", description: "Exit the session (also exit / quit)" },
];

function normalizeWidth(width?: number): number {
  if (width === undefined || !Number.isFinite(width)) return DEFAULT_WIDTH;
  return Math.max(1, Math.floor(width));
}

function stripAnsi(value: string): string {
  return sanitizeTerminalText(value).replace(/\r?\n/g, " ");
}

/**
 * Model, tool, and provider text is untrusted terminal input. Remove both
 * 7-bit and C1 control sequences before rendering it, while preserving normal
 * newlines and converting tabs/carriage returns to deterministic text.
 */
export function sanitizeTerminalText(value: string): string {
  const output: string[] = [];

  for (let index = 0; index < value.length; ) {
    const code = value.charCodeAt(index);

    if (code === 0x1b) {
      index = consumeEscapeSequence(value, index);
      continue;
    }

    if (code === 0x9b) {
      index = consumeCsi(value, index + 1);
      continue;
    }

    if (code === 0x9d || isC1StringControl(code)) {
      index = consumeStringControl(value, index + 1);
      continue;
    }

    if (code === 0x0a) {
      output.push("\n");
      index += 1;
      continue;
    }

    if (code === 0x0d) {
      if (value.charCodeAt(index + 1) !== 0x0a) output.push("\n");
      index += 1;
      continue;
    }

    if (code === 0x09) {
      output.push("    ");
      index += 1;
      continue;
    }

    if (isC0Control(code) || code === 0x7f || isC1Control(code)) {
      index += 1;
      continue;
    }

    output.push(value[index] ?? "");
    index += 1;
  }

  return output.join("");
}

const SENSITIVE_KEY_PATTERN =
  /((?:["']?(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*)(["']))[^"'\\]*(?:\\.[^"'\\]*)*\2/gi;
const SENSITIVE_UNQUOTED_KEY_PATTERN =
  /((?:["']?(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*))(?!["'])([^"'\s,}\]]+)/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+ PRIVATE KEY-----/g;
const TOKEN_SHAPE_PATTERN =
  /\b(?:sk|pk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/gi;

/** Redacts credential-shaped values before human-readable terminal output. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(SENSITIVE_KEY_PATTERN, "$1$2[redacted]$2")
    .replace(SENSITIVE_UNQUOTED_KEY_PATTERN, "$1[redacted]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(TOKEN_SHAPE_PATTERN, "[redacted-token]");
}

function consumeEscapeSequence(value: string, start: number): number {
  const next = value.charCodeAt(start + 1);

  if (next === 0x5b) return consumeCsi(value, start + 2);
  if (next === 0x5d || isStringEscapeIntroducer(next)) {
    return consumeStringControl(value, start + 2);
  }

  return Math.min(value.length, start + 2);
}

function consumeCsi(value: string, index: number): number {
  while (index < value.length) {
    const code = value.charCodeAt(index);
    index += 1;
    if (code >= 0x40 && code <= 0x7e) return index;
  }
  return value.length;
}

function consumeStringControl(value: string, index: number): number {
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 0x07 || code === 0x9c) return index + 1;
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
    index += 1;
  }
  return value.length;
}

function isC0Control(code: number): boolean {
  return code < 0x20;
}

function isC1Control(code: number): boolean {
  return code >= 0x80 && code <= 0x9f;
}

function isC1StringControl(code: number): boolean {
  return code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f;
}

function isStringEscapeIntroducer(code: number): boolean {
  return code === 0x50 || code === 0x58 || code === 0x5e || code === 0x5f;
}

function visibleLength(value: string): number {
  return displayWidth(stripAnsi(value));
}

function truncate(value: string, width: number): string {
  const clean = stripAnsi(value);
  return truncateToDisplayWidth(clean, width);
}

function fitLine(value: string, width: number): string {
  return truncate(value, width);
}

function padRight(value: string, width: number): string {
  const fitted = fitLine(value, width);
  return `${fitted}${" ".repeat(Math.max(0, width - visibleLength(fitted)))}`;
}

function wrapLine(value: string, width: number): string[] {
  const clean = stripAnsi(value);
  if (width <= 0) return [""];
  if (visibleLength(clean) <= width) return [clean];

  const result: string[] = [];
  let remaining = clean;

  while (visibleLength(remaining) > width) {
    const first = splitByDisplayWidth(remaining, width)[0] ?? "";
    const whitespace = first.lastIndexOf(" ");
    if (whitespace > 0) {
      result.push(first.slice(0, whitespace).trimEnd());
      remaining = `${first.slice(whitespace + 1)}${remaining.slice(first.length)}`;
      while (remaining.startsWith(" ")) remaining = remaining.slice(1);
    } else {
      result.push(first);
      remaining = remaining.slice(first.length);
    }
  }

  result.push(remaining);
  return result;
}

function wrapPrefixed(value: string, prefix: string, width: number): string[] {
  const contentWidth = Math.max(1, width - visibleLength(prefix));
  return wrapLine(value, contentWidth).map((line) => fitLine(`${prefix}${line}`, width));
}

function box(lines: readonly string[], width: number): string[] {
  if (width < 3) return lines.map((line) => fitLine(line, width));

  const innerWidth = width - 2;
  const top = `┌${"─".repeat(width - 2)}┐`;
  const bottom = `└${"─".repeat(width - 2)}┘`;
  if (innerWidth < 4) {
    return [top, ...lines.map((line) => `│${padRight(line, innerWidth)}│`), bottom];
  }
  const contentWidth = innerWidth - 2;
  const content = lines.map((line) => `│ ${padRight(line, contentWidth)} │`);
  return [top, ...content, bottom];
}

function renderMarkdown(text: string, width: number): string[] {
  const result: string[] = [];
  const sourceLines = redactSensitiveText(sanitizeTerminalText(text)).split("\n");
  let inCode = false;
  let language = "";
  let codeLines: string[] = [];

  const flushCode = (): void => {
    const label = language ? ` code (${language}) ` : " code ";
    result.push(colorize(fitLine(`┌─${label}${"─".repeat(Math.max(0, width - displayWidth(label) - 3))}┐`, width), "dim"));
    const prefix = "│ ";
    const codeWidth = Math.max(1, width - visibleLength(prefix));
    for (const codeLine of codeLines) {
      for (const wrapped of wrapLine(codeLine, codeWidth)) {
        result.push(colorize(fitLine(`${prefix}${wrapped}`, width), "dim"));
      }
    }
    result.push(colorize(fitLine(`└${"─".repeat(Math.max(0, width - 2))}┘`, width), "dim"));
    codeLines = [];
    language = "";
  };

  for (const sourceLine of sourceLines) {
    const fence = sourceLine.trim().match(/^(```+|~~~+)(.*)$/);
    if (fence) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        inCode = true;
        language = fence[2]?.trim() ?? "";
      }
      continue;
    }

    if (inCode) {
      codeLines.push(sourceLine);
      continue;
    }

    const heading = sourceLine.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      result.push(colorize(fitLine(`▌ ${heading[2] ?? ""}`, width), "cyan"));
      continue;
    }

    const bullet = sourceLine.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      result.push(...wrapPrefixed(bullet[1] ?? "", "• ", width));
      continue;
    }

    const quote = sourceLine.match(/^\s*>\s?(.*)$/);
    if (quote) {
      result.push(...wrapPrefixed(quote[1] ?? "", "│ ", width));
      continue;
    }

    result.push(...wrapLine(sourceLine, width).map((line) => fitLine(line, width)));
  }

  if (inCode) flushCode();
  return result;
}

function renderLabeledLine(label: string, value: string, width: number): string {
  return fitLine(`${label}: ${redactSensitiveText(sanitizeTerminalText(value))}`, width);
}

export function renderSignalMark(requestedWidth?: number): string {
  const width = normalizeWidth(requestedWidth);
  return renderSignalLoomMark({ width, compact: width < 12 });
}

export function renderSignalDivider(
  label: string,
  options: BlockOptions = {}
): string {
  const width = normalizeWidth(options.width);
  const safeLabel = stripAnsi(redactSensitiveText(sanitizeTerminalText(label)))
    .replace(/\s+/g, " ")
    .trim();
  const prefix = `╞═ ${safeLabel} <> `;
  const fillWidth = Math.max(0, width - visibleLength(prefix) - 1);
  return colorize(fitLine(`${prefix}${"═".repeat(fillWidth)}╡`, width), "dim");
}

export function renderWelcome({
  provider,
  model,
  streaming,
  runState,
  sessionId,
  workingDirectory,
  mcpCount = 0,
  executor = "local",
  width: requestedWidth,
}: WelcomeOptions): string {
  const width = normalizeWidth(requestedWidth);
  const contentWidth = Math.max(1, width - 2);
  const state = runState ?? (streaming ? "streaming" : "ready");
  const stateLabel = formatRunState(state);
  const fields = [
    colorize(padRight("DEV AGENT", contentWidth), "bold"),
    colorize(padRight("SIGNAL WEAVE // local coding workbench", contentWidth), "dim"),
    "",
    renderLabeledLine("Provider", provider, contentWidth),
    renderLabeledLine("Model", model, contentWidth),
    renderLabeledLine("Status", stateLabel, contentWidth),
    renderLabeledLine("Transport", streaming ? "streaming" : "single response", contentWidth),
    renderLabeledLine("Session", sessionId, contentWidth),
    renderLabeledLine("Working directory", workingDirectory, contentWidth),
    renderLabeledLine("Workspace", workingDirectory.split("/").at(-1) ?? workingDirectory, contentWidth),
    renderLabeledLine("Executor", executor, contentWidth),
    renderLabeledLine("MCP", String(mcpCount), contentWidth),
    "",
    colorize(padRight("Tips", contentWidth), "teal"),
    fitLine("  Ask questions, edit files, or run commands", contentWidth),
    fitLine("  Type / or : for commands", contentWidth),
    fitLine("  Ctrl+L clears the terminal view", contentWidth),
  ];

  const markWidth = Math.min(width, 16);
  return [
    renderSignalLoomMark({ width: markWidth, color: process.env.NO_COLOR === undefined }),
    renderSignalLoomWordmark({ width, color: process.env.NO_COLOR === undefined }),
    box(fields, width).join("\n"),
  ].join("\n");
}

export interface RuntimeStatusOptions {
  provider: string;
  model: string;
  streaming: boolean;
  runState?: TuiRunState;
  width?: number;
}

export function renderRuntimeStatus({
  provider,
  model,
  streaming,
  runState,
  width: requestedWidth,
}: RuntimeStatusOptions): string {
  const width = normalizeWidth(requestedWidth);
  const state = runState ?? (streaming ? "streaming" : "ready");
  const lines = [
    colorize(fitLine("SIGNAL RAIL", width), "teal"),
    colorize(fitLine(`  ${formatRunState(state)}`, width), state === "ready" ? "dim" : "green"),
    renderLabeledLine("Provider", provider, width),
    renderLabeledLine("Model", model, width),
    renderLabeledLine("Transport", streaming ? "streaming" : "single response", width),
  ];
  return lines.join("\n");
}

export function formatRunState(state: TuiRunState): string {
  switch (state) {
    case "ready":
      return "READY / idle";
    case "streaming":
      return "LIVE / streaming";
    case "tool-running":
      return "TOOL / running";
    case "waiting-approval":
      return "WAITING / approval";
    case "validating":
      return "VALIDATING";
    default:
      return state.toUpperCase().replaceAll("-", " ");
  }
}

export function renderUserMessage(text: string, options: { width?: number } = {}): string {
  const width = normalizeWidth(options.width);
  const lines = [colorize(fitLine("YOU // INPUT", width), "amber")];
  for (const sourceLine of redactSensitiveText(sanitizeTerminalText(text)).split("\n")) {
    lines.push(...wrapPrefixed(sourceLine, ">> ", width));
  }
  return lines.join("\n");
}

export function renderAssistantMessage(
  text: string,
  options: AssistantMessageOptions = {}
): string {
  const width = normalizeWidth(options.width);
  const label = options.label ?? "AGENT // RESPONSE";
  return [colorize(fitLine(label, width), "teal"), ...renderMarkdown(text, width)].join("\n");
}

export function renderCommandHints(
  commands: readonly (CommandHint | string)[] = DEFAULT_COMMAND_HINTS,
  options: CommandHintsOptions = {}
): string {
  const width = normalizeWidth(options.width);
  const lines = [colorize(fitLine("COMMANDS // DECK", width), "teal")];

  for (const entry of commands) {
    const command = typeof entry === "string" ? entry : entry.command;
    const description = typeof entry === "string" ? "" : entry.description ?? "";
    const separator = description ? "  " : "";
    const prefix = `  ${command}${separator}`;
    const availableWidth = Math.max(1, width - visibleLength(prefix));
    const descriptionLines = description ? wrapLine(description, availableWidth) : [""];

    descriptionLines.forEach((descriptionLine, index) => {
      const line = index === 0 ? `${prefix}${descriptionLine}` : `    ${descriptionLine}`;
      lines.push(fitLine(line, width));
    });
  }

  return lines.join("\n");
}

export function renderToolCall(
  name: string,
  detail = "",
  options: BlockOptions = {}
): string {
  const width = normalizeWidth(options.width);
  const safeName = redactSensitiveText(sanitizeTerminalText(name));
  const safeDetail = redactSensitiveText(sanitizeTerminalText(detail));
  const lines = [
    renderSignalDivider("TOOL CALL", { width }),
    colorize(fitLine(`> TOOL / ${safeName}`, width), "blue"),
  ];
  if (safeDetail) {
    lines.push(...wrapPrefixed(safeDetail, "  input: ", width));
  }
  return lines.join("\n");
}

export function renderToolResult(
  name: string,
  output: string,
  options: BlockOptions = {}
): string {
  const width = normalizeWidth(options.width);
  const safeName = redactSensitiveText(sanitizeTerminalText(name));
  const safeOutput = redactSensitiveText(sanitizeTerminalText(output));
  return [
    renderSignalDivider("TOOL RESULT", { width }),
    colorize(fitLine(`< TOOL RESULT / ${safeName}`, width), "dim"),
    ...wrapPrefixed(safeOutput, "  ", width),
  ].join("\n");
}

export function renderToolCard(
  card: ToolCard,
  options: BlockOptions = {}
): string {
  const width = normalizeWidth(options.width);
  const status = card.status.toUpperCase().replaceAll("-", " ");
  const marker = card.status === "completed" || card.status === "passed"
    ? "✓"
    : card.status === "failed" || card.status === "blocked"
      ? "×"
      : card.status === "approval"
        ? "?"
        : "·";
  const statusColor = card.status === "completed" || card.status === "passed"
    ? "green"
    : card.status === "failed" || card.status === "blocked"
      ? "red"
      : card.status === "approval"
        ? "amber"
        : "blue";
  const safeName = redactSensitiveText(sanitizeTerminalText(card.name));
  const lines = [
    renderSignalDivider(`${card.kind.toUpperCase()} / ${status}`, { width }),
    colorize(fitLine(`${marker} ${safeName}`, width), statusColor),
  ];

  if (card.input) lines.push(...wrapPrefixed(redactSensitiveText(sanitizeTerminalText(card.input)), "  input: ", width));
  if (card.detail) lines.push(...wrapPrefixed(redactSensitiveText(sanitizeTerminalText(card.detail)), "  ", width));
  if (card.output) lines.push(...wrapPrefixed(redactSensitiveText(sanitizeTerminalText(card.output)), "  output: ", width));
  if (card.diff) {
    lines.push(colorize(fitLine("  diff:", width), "dim"));
    lines.push(...renderMarkdown(card.diff, width));
  }

  return lines.join("\n");
}

export function renderApprovalMessage(
  tool: string,
  decision: string,
  detail = "",
  options: BlockOptions = {}
): string {
  const width = normalizeWidth(options.width);
  const safeTool = redactSensitiveText(sanitizeTerminalText(tool));
  const safeDetail = redactSensitiveText(sanitizeTerminalText(detail));
  const normalized = decision.trim().toLowerCase();
  const color = normalized === "allow" || normalized === "allow-always" ? "green" : "amber";
  const marker = normalized === "allow" || normalized === "allow-always" ? "OK" : normalized === "deny" ? "NO" : "??";
  const lines = [
    renderSignalDivider("APPROVAL", { width }),
    colorize(fitLine(`! APPROVAL / ${safeTool}`, width), color),
  ];
  lines.push(...wrapPrefixed(`${marker} ${safeDetail || "decision recorded"}`, "  ", width));
  return lines.join("\n");
}

export function renderValidationMessage(
  status: string,
  summary: string,
  options: BlockOptions = {}
): string {
  const width = normalizeWidth(options.width);
  const normalized = status.trim().toLowerCase();
  const color = normalized === "passed" ? "green" : normalized === "failed" || normalized === "blocked" ? "red" : "amber";
  return [
    renderSignalDivider("VALIDATION", { width }),
    colorize(fitLine(`+ VALIDATION / ${sanitizeTerminalText(status)}`, width), color),
    ...wrapPrefixed(redactSensitiveText(sanitizeTerminalText(summary)), "  ", width),
  ].join("\n");
}
