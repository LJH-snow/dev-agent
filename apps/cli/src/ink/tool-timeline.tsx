import { Box, Text } from "ink";

import type { ToolCard } from "../tui-session.js";
import { ApprovalCard } from "./approval-card.js";
import { useInkTheme } from "./theme.js";

export function formatToolDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return "—";
  }
  if (milliseconds < 1_000) {
    return `${Math.max(0, Math.round(milliseconds))}ms`;
  }
  return `${(Math.max(0, milliseconds) / 1_000).toFixed(1)}s`;
}

export function formatToolProgressBar(
  progress: number,
  total: number | undefined,
  width = 12,
): string {
  const safeWidth = Math.max(1, Math.min(24, Math.floor(width)));
  const safeProgress = Number.isFinite(progress) ? Math.max(0, progress) : 0;
  if (total === undefined || !Number.isFinite(total) || total <= 0) {
    return `${Math.round(safeProgress)} done`;
  }
  const boundedTotal = Math.max(1, total);
  const ratio = Math.max(0, Math.min(1, safeProgress / boundedTotal));
  const filled = Math.round(ratio * safeWidth);
  const bar = "█".repeat(filled) + "░".repeat(safeWidth - filled);
  return `${bar} ${Math.round(ratio * 100)}%`;
}

export function ToolTimeline({
  cards,
  columns,
  now = Date.now(),
}: {
  readonly cards: readonly ToolCard[];
  readonly columns: number;
  readonly now?: number;
}): React.JSX.Element | null {
  const theme = useInkTheme();
  const visibleCards = cards.slice(-6);
  if (visibleCards.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1} width={columns - 2}>
      <Text color={theme.info} bold>TOOL TIMELINE</Text>
      {visibleCards.map((card, index) => {
        const isLast = index === visibleCards.length - 1;
        if (card.kind === "approval") {
          return (
            <Box key={card.id} marginTop={1} width={columns - 2}>
              <Text color={theme.dim}>{isLast ? "└─ " : "├─ "}</Text>
              <ApprovalCard card={card} width={columns - 5} />
            </Box>
          );
        }

        const color = cardColor(card, theme);
        const duration = formatToolDuration(
          (card.finishedAt ?? now) - card.startedAt,
        );
        const detail = card.detail ?? card.output ?? card.input;
        const progress = card.progress === undefined
          ? undefined
          : formatToolProgressBar(
              card.progress.progress,
              card.progress.total,
              Math.min(16, Math.max(8, Math.floor((columns - 36) / 2))),
            );
        return (
          <Box key={card.id} flexDirection="column" marginTop={1}>
            <Text color={theme.dim}>
              {isLast ? "└─ " : "├─ "}
              <Text color={color} bold>
                {statusGlyph(card.status)} {card.name}
              </Text>
              <Text dimColor> · {card.status.toUpperCase()} · {duration}</Text>
            </Text>
            {progress === undefined ? null : (
              <Text color={theme.info}>
                {isLast ? "   " : "│  "}{progress}
              </Text>
            )}
            {detail === undefined ? null : (
              <Text dimColor wrap="truncate-end">
                {isLast ? "   " : "│  "}{detail}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function statusGlyph(status: ToolCard["status"]): string {
  switch (status) {
    case "running":
    case "validation":
      return "◌";
    case "failed":
    case "blocked":
      return "×";
    case "cancelled":
      return "∅";
    case "passed":
    case "completed":
      return "✓";
    case "approval":
      return "✦";
    default:
      return "·";
  }
}

function cardColor(
  card: ToolCard,
  theme: ReturnType<typeof useInkTheme>,
): string {
  if (card.status === "failed" || card.status === "blocked") {
    return theme.error;
  }
  if (card.status === "running" || card.status === "validation") {
    return theme.info;
  }
  return theme.success;
}
