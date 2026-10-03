import { Box, Text } from "ink";

import { redactSensitiveText, sanitizeTerminalText } from "../tui-renderer.js";
import { useInkTheme, type InkTheme } from "./theme.js";

export type DiffLineKind = "header" | "hunk" | "context" | "added" | "removed";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

export interface DiffSummary {
  readonly additions?: number;
  readonly deletions?: number;
}

export interface DiffPreviewProps {
  readonly diff: string;
  readonly width?: number;
  readonly maxLines?: number;
  readonly summary?: DiffSummary;
}

const DEFAULT_MAX_LINES = 18;

export function parseDiffLines(diff: string): readonly DiffLine[] {
  const clean = redactSensitiveText(sanitizeTerminalText(diff));
  return clean
    .split("\n")
    .filter((line, index, lines) => !(index === lines.length - 1 && line === ""))
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) {
        return { kind: "header", text: line };
      }
      if (line.startsWith("@@")) {
        return { kind: "hunk", text: line };
      }
      if (line.startsWith("+")) {
        return { kind: "added", text: line.slice(1) };
      }
      if (line.startsWith("-")) {
        return { kind: "removed", text: line.slice(1) };
      }
      return { kind: "context", text: line.startsWith(" ") ? line.slice(1) : line };
    });
}

export function DiffPreview({
  diff,
  width,
  maxLines = DEFAULT_MAX_LINES,
  summary,
}: DiffPreviewProps): React.JSX.Element {
  const theme = useInkTheme();
  const lines = parseDiffLines(diff);
  if (lines.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.muted}>DIFF PREVIEW</Text>
        <Text dimColor>No textual diff available.</Text>
      </Box>
    );
  }

  const limit = normalizeMaxLines(maxLines);
  const visible = lines.slice(0, limit);
  const omitted = Math.max(0, lines.length - visible.length);
  const additions = summary?.additions ?? lines.filter((line) => line.kind === "added").length;
  const deletions = summary?.deletions ?? lines.filter((line) => line.kind === "removed").length;

  return (
    <Box flexDirection="column" marginTop={1} width={width}>
      <Text color={theme.muted} bold>
        DIFF PREVIEW · <Text color={theme.success}>+{additions}</Text> <Text color={theme.error}>-{deletions}</Text>
      </Text>
      {visible.map((line, index) => (
        <Text
          key={`${index}-${line.kind}-${line.text}`}
          color={diffLineColor(line.kind, theme)}
          dimColor={line.kind === "context"}
          wrap="truncate-end"
        >
          {diffLinePrefix(line.kind)}{line.text}
        </Text>
      ))}
      {omitted > 0 ? (
        <Text dimColor>… {omitted} more diff lines</Text>
      ) : null}
    </Box>
  );
}

function diffLinePrefix(kind: DiffLineKind): string {
  switch (kind) {
    case "added":
      return "+ ";
    case "removed":
      return "- ";
    default:
      return "  ";
  }
}

function diffLineColor(kind: DiffLineKind, theme: InkTheme): string | undefined {
  switch (kind) {
    case "added":
      return theme.success;
    case "removed":
      return theme.error;
    case "hunk":
      return theme.accent;
    case "header":
      return theme.info;
    default:
      return undefined;
  }
}

function normalizeMaxLines(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 200) : DEFAULT_MAX_LINES;
}
