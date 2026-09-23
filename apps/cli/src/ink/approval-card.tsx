import { useEffect, useState } from "react";
import { Box, Text } from "ink";

import type { ToolCard } from "../tui-session.js";
import { DiffPreview } from "./diff-preview.js";
import { useInkTheme } from "./theme.js";

export const APPROVAL_BORDER_FRAMES = [
  "#f2c15d",
  "#ffd98a",
  "#d49cff",
  "#b5a0ff",
  "#f2c15d",
] as const;

export const APPROVAL_PULSE_GLYPHS = [
  "✦",
  "✧",
  "✸",
  "✹",
  "✦",
] as const;

export function approvalBorderFrame(index: number): string {
  const normalized = ((index % APPROVAL_BORDER_FRAMES.length) +
    APPROVAL_BORDER_FRAMES.length) % APPROVAL_BORDER_FRAMES.length;
  return APPROVAL_BORDER_FRAMES[normalized] ?? APPROVAL_BORDER_FRAMES[0];
}

export function approvalPulseGlyph(index: number): string {
  const normalized = ((index % APPROVAL_PULSE_GLYPHS.length) +
    APPROVAL_PULSE_GLYPHS.length) % APPROVAL_PULSE_GLYPHS.length;
  return APPROVAL_PULSE_GLYPHS[normalized] ?? APPROVAL_PULSE_GLYPHS[0];
}

export function ApprovalCard({
  card,
  frameIndex: controlledFrameIndex,
  width,
}: {
  readonly card: ToolCard;
  readonly frameIndex?: number;
  readonly width?: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  const [frameIndex, setFrameIndex] = useState(0);
  const active = card.status === "approval";
  const pulseIndex = controlledFrameIndex ?? frameIndex;
  const color = active
    ? approvalBorderColor(pulseIndex, theme)
    : card.status === "failed" || card.status === "blocked"
      ? theme.error
      : theme.success;
  const glyph = active
    ? approvalPulseGlyph(controlledFrameIndex ?? frameIndex)
    : "✓";

  useEffect(() => {
    setFrameIndex(0);
    if (!active || controlledFrameIndex !== undefined) {
      return;
    }
    const timer = setInterval(() => {
      setFrameIndex((current) => current + 1);
    }, 180);
    return () => clearInterval(timer);
  }, [active, controlledFrameIndex, card.id]);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      width={width}
    >
      <Text color={color} bold>
        {glyph} APPROVAL / {card.status.toUpperCase()} · {card.name}
      </Text>
      {card.detail === undefined ? null : (
        <Text dimColor wrap="truncate-end">{card.detail}</Text>
      )}
      {card.diff === undefined ? null : (
        <DiffPreview
          diff={card.diff}
          width={width === undefined ? undefined : Math.max(20, width - 2)}
          maxLines={12}
        />
      )}
      {active ? (
        <Text color={theme.warning}>y / n to continue · esc to cancel</Text>
      ) : null}
    </Box>
  );
}

function approvalBorderColor(
  index: number,
  theme: ReturnType<typeof useInkTheme>,
): string {
  const normalized = ((index % APPROVAL_BORDER_FRAMES.length) +
    APPROVAL_BORDER_FRAMES.length) % APPROVAL_BORDER_FRAMES.length;
  const colors = [
    theme.warning,
    theme.accent,
    theme.info,
    theme.primary,
    theme.warning,
  ];
  return colors[normalized] ?? theme.warning;
}
