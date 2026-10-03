import { Box, Text } from "ink";

import { redactSensitiveText, sanitizeTerminalText } from "../tui-renderer.js";
import { fitDisplayLine, splitByDisplayWidth } from "../tui-width.js";
import { useInkTheme } from "./theme.js";

export interface MarkdownBlock {
  readonly kind: "heading" | "paragraph" | "list" | "quote" | "code" | "rule";
  readonly level?: number;
  readonly text?: string;
  readonly items?: readonly string[];
  readonly ordered?: boolean;
  readonly language?: string;
  readonly lines?: readonly string[];
  readonly closed?: boolean;
}

export interface MarkdownParseOptions {
  readonly maxLines?: number;
}

export interface MarkdownViewProps extends MarkdownParseOptions {
  readonly text: string;
  readonly width?: number;
  readonly colors?: Partial<MarkdownColors>;
}

export interface MarkdownColors {
  readonly heading: string;
  readonly accent: string;
  readonly code: string;
  readonly quote: string;
  readonly muted: string;
}

const DEFAULT_COLORS: MarkdownColors = {
  heading: "#67d9d7",
  accent: "#c792ff",
  code: "#8bd5ff",
  quote: "#7f8fb8",
  muted: "#8d97ab",
};

const DEFAULT_MAX_LINES = 120;

export function parseMarkdown(
  source: string,
  options: MarkdownParseOptions = {},
): readonly MarkdownBlock[] {
  const maxLines = normalizeMaxLines(options.maxLines);
  const clean = redactSensitiveText(sanitizeTerminalText(source));
  const sourceLines = clean.split("\n");
  const truncated = sourceLines.length > maxLines;
  const lines = sourceLines.slice(0, maxLines);
  if (truncated) {
    lines.push("…");
  }

  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = parseFence(line);
    if (fence) {
      const codeLines: string[] = [];
      let cursor = index + 1;
      let closed = false;
      while (cursor < lines.length) {
        const candidate = lines[cursor] ?? "";
        if (isClosingFence(candidate, fence.marker)) {
          closed = true;
          cursor += 1;
          break;
        }
        codeLines.push(candidate);
        cursor += 1;
      }
      blocks.push({
        kind: "code",
        language: fence.language,
        lines: codeLines,
        closed,
      });
      index = cursor;
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]?.length ?? 1,
        text: heading[2] ?? "",
      });
      index += 1;
      continue;
    }

    if (/^\s*((?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const listItem = parseListItem(line);
    if (listItem) {
      const items: string[] = [];
      const ordered = listItem.ordered;
      let cursor = index;
      while (cursor < lines.length) {
        const item = parseListItem(lines[cursor] ?? "");
        if (!item || item.ordered !== ordered) break;
        items.push(item.text);
        cursor += 1;
      }
      blocks.push({ kind: "list", items, ordered });
      index = cursor;
      continue;
    }

    const quote = parseQuote(line);
    if (quote !== undefined) {
      const quoteLines: string[] = [];
      let cursor = index;
      while (cursor < lines.length) {
        const value = parseQuote(lines[cursor] ?? "");
        if (value === undefined) break;
        quoteLines.push(value);
        cursor += 1;
      }
      blocks.push({ kind: "quote", text: quoteLines.join("\n") });
      index = cursor;
      continue;
    }

    const paragraphLines: string[] = [line];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const candidate = lines[cursor] ?? "";
      if (
        candidate.trim() === "" ||
        parseFence(candidate) ||
        /^\s{0,3}#{1,6}\s+/.test(candidate) ||
        parseListItem(candidate) ||
        parseQuote(candidate) !== undefined ||
        /^\s*((?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(candidate)
      ) {
        break;
      }
      paragraphLines.push(candidate);
      cursor += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
    index = cursor;
  }

  return blocks;
}

/**
 * Returns the number of terminal rows produced by MarkdownView.
 *
 * The rich CLI uses this value for transcript virtualization. Keep the
 * measurement next to the renderer so fenced-code borders, block spacing, and
 * terminal-width wrapping cannot drift apart and paint the next paragraph over
 * the previous block.
 */
export function measureMarkdownRows(
  source: string,
  width: number,
  options: MarkdownParseOptions = {},
): number {
  const normalizedWidth = Math.max(1, Math.floor(width));
  return parseMarkdown(source, options).reduce(
    (total, block, index) => total + (index === 0 ? 0 : 1) + measureMarkdownBlockRows(block, normalizedWidth),
    0,
  );
}

export function MarkdownView({
  text,
  width,
  maxLines,
  colors,
}: MarkdownViewProps): React.JSX.Element {
  const theme = useInkTheme();
  const palette: MarkdownColors = {
    heading: colors?.heading ?? theme.info ?? DEFAULT_COLORS.heading,
    accent: colors?.accent ?? theme.accent ?? DEFAULT_COLORS.accent,
    code: colors?.code ?? theme.code ?? DEFAULT_COLORS.code,
    quote: colors?.quote ?? theme.quote ?? DEFAULT_COLORS.quote,
    muted: colors?.muted ?? theme.muted ?? DEFAULT_COLORS.muted,
  };
  const blocks = parseMarkdown(text, { maxLines });
  return (
    <Box flexDirection="column" width={width}>
      {blocks.map((block, index) => (
        <MarkdownBlockView
          key={`${block.kind}-${index}`}
          block={block}
          colors={palette}
          width={width}
          spaced={index > 0}
        />
      ))}
    </Box>
  );
}

function MarkdownBlockView({
  block,
  colors,
  width,
  spaced,
}: {
  readonly block: MarkdownBlock;
  readonly colors: MarkdownColors;
  readonly width?: number;
  readonly spaced: boolean;
}): React.JSX.Element {
  const marginTop = spaced ? 1 : 0;
  switch (block.kind) {
    case "heading":
      return (
        <Box marginTop={marginTop}>
          <Text color={colors.heading} bold wrap="wrap">
            {"▌ "}
            {renderInline(block.text ?? "", colors)}
          </Text>
        </Box>
      );
    case "paragraph":
      return (
        <Box marginTop={marginTop}>
          <Text wrap="wrap">
            {renderInline(block.text ?? "", colors)}
          </Text>
        </Box>
      );
    case "list":
      return (
        <Box flexDirection="column" marginTop={marginTop}>
          {(block.items ?? []).map((item, index) => (
            <Text key={`${index}-${item}`} wrap="wrap">
              <Text color={colors.accent}>
                {block.ordered ? `${index + 1}. ` : "• "}
              </Text>
              {renderInline(item, colors)}
            </Text>
          ))}
        </Box>
      );
    case "quote":
      return (
        <Box marginTop={marginTop}>
          <Text color={colors.quote} wrap="wrap">
            {renderInline(
              (block.text ?? "").split("\n").map((line) => `│ ${line}`).join("\n"),
              colors,
            )}
          </Text>
        </Box>
      );
    case "code": {
      const outerWidth = Math.max(20, width ?? 40);
      const innerWidth = Math.max(1, outerWidth - 4);
      const header = `${block.language ? `code · ${block.language}` : "code"}${block.closed === false ? " · streaming" : ""}`;
      const codeWidth = Math.max(1, innerWidth - 2);
      return (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={colors.muted}
          paddingX={1}
          marginTop={marginTop}
          width={outerWidth}
        >
          <Text color={colors.muted} wrap="truncate-end">{fitDisplayLine(header, innerWidth)}</Text>
          {(block.lines ?? []).flatMap((line, index) =>
            splitByDisplayWidth(line, codeWidth).map((chunk, chunkIndex) => (
              <Text
                key={`${index}-${chunkIndex}-${chunk}`}
                color={colors.code}
                wrap="truncate-end"
              >
                {fitDisplayLine(`│ ${chunk}`, innerWidth)}
              </Text>
            )),
          )}
        </Box>
      );
    }
    case "rule":
      return (
        <Box marginTop={marginTop}>
          <Text color={colors.muted}>
            {"─".repeat(Math.max(1, (width ?? 40) - 4))}
          </Text>
        </Box>
      );
  }
}

function measureMarkdownBlockRows(block: MarkdownBlock, width: number): number {
  switch (block.kind) {
    case "heading":
      return wrappedRows(`▌ ${plainInlineText(block.text ?? "")}`, width);
    case "paragraph":
      return wrappedRows(block.text ?? "", width);
    case "list":
      return (block.items ?? []).reduce(
        (total, item, index) => total + wrappedRows(
          `${block.ordered ? `${index + 1}. ` : "• "}${plainInlineText(item)}`,
          width,
        ),
        0,
      );
    case "quote":
      return (block.text ?? "").split("\n").reduce(
        (total, line) => total + wrappedRows(`│ ${line}`, width),
        0,
      );
    case "code": {
      const innerWidth = Math.max(1, width - 4);
      const codeWidth = Math.max(1, innerWidth - 2);
      const codeRows = (block.lines ?? []).reduce(
        (total, line) => total + splitByDisplayWidth(line, codeWidth).length,
        0,
      );
      return 2 + 1 + codeRows;
    }
    case "rule":
      return 1;
  }
}

function wrappedRows(value: string, width: number): number {
  return value.split("\n").reduce(
    (total, line) => total + splitByDisplayWidth(line, width).length,
    0,
  );
}

function plainInlineText(value: string): string {
  return tokenizeInline(value).map((segment) => segment.text).join("");
}

function renderInline(value: string, colors: MarkdownColors): React.JSX.Element[] {
  const segments = tokenizeInline(value);
  return segments.map((segment, index) => {
    if (segment.kind === "code") {
      return (
        <Text key={`${index}-${segment.text}`} color={colors.code}>
          {segment.text}
        </Text>
      );
    }
    if (segment.kind === "bold") {
      return (
        <Text key={`${index}-${segment.text}`} bold>
          {segment.text}
        </Text>
      );
    }
    if (segment.kind === "italic") {
      return (
        <Text key={`${index}-${segment.text}`} italic>
          {segment.text}
        </Text>
      );
    }
    if (segment.kind === "link") {
      return (
        <Text key={`${index}-${segment.text}`} color={colors.accent} underline>
          {segment.text}
        </Text>
      );
    }
    return <Text key={`${index}-${segment.text}`}>{segment.text}</Text>;
  });
}

type InlineSegment = {
  readonly kind: "text" | "code" | "bold" | "italic" | "link";
  readonly text: string;
};

function tokenizeInline(value: string): readonly InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ kind: "text", text: value.slice(cursor, start) });
    }
    const token = match[0] ?? "";
    if (token.startsWith("`")) {
      segments.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      segments.push({ kind: "bold", text: token.slice(2, -2) });
    } else if (token.startsWith("*") || token.startsWith("_")) {
      segments.push({ kind: "italic", text: token.slice(1, -1) });
    } else {
      const label = token.match(/^\[([^\]]+)\]/)?.[1] ?? token;
      segments.push({ kind: "link", text: label });
    }
    cursor = start + token.length;
  }
  if (cursor < value.length) {
    segments.push({ kind: "text", text: value.slice(cursor) });
  }
  if (segments.length === 0) {
    return [{ kind: "text", text: value }];
  }
  return segments;
}

function parseFence(line: string): { readonly marker: string; readonly language?: string } | undefined {
  const match = line.trim().match(/^(`{3,}|~{3,})(.*)$/);
  if (!match) return undefined;
  const language = match[2]?.trim();
  return {
    marker: match[1] ?? "```",
    ...(language ? { language } : {}),
  };
}

function isClosingFence(line: string, marker: string): boolean {
  return line.trim().startsWith(marker[0] ?? "`") &&
    line.trim().length >= marker.length &&
    new RegExp(`^${marker[0]}{${marker.length},}\\s*$`).test(line.trim());
}

function parseListItem(line: string): { readonly ordered: boolean; readonly text: string } | undefined {
  const match = line.match(/^\s*(?:(\d+)[.)]|[-+*])\s+(.+)$/);
  if (!match) return undefined;
  return {
    ordered: match[1] !== undefined,
    text: match[2] ?? "",
  };
}

function parseQuote(line: string): string | undefined {
  const match = line.match(/^\s*>\s?(.*)$/);
  return match?.[1] ?? (match ? "" : undefined);
}

function normalizeMaxLines(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? Math.min(value, 500)
    : DEFAULT_MAX_LINES;
}
