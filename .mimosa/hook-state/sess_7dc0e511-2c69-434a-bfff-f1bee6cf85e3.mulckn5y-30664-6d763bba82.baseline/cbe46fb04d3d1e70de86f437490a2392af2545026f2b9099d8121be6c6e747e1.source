import { useEffect, useState } from "react";
import { Box, Text, useIsScreenReaderEnabled } from "ink";

import { useAnimationTicks } from "./animation-clock.js";

import type { TuiRunState } from "../tui-session.js";
import {
  THINKING_FRAMES,
  thinkingFrame,
} from "./thinking-indicator.js";
import { useInkTheme } from "./theme.js";

export function formatThoughtElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 100) / 10);
  return `${seconds.toFixed(1)}s`;
}

export interface ThoughtLineProps {
  readonly active: boolean;
  readonly startedAt?: string;
  readonly elapsedMs?: number;
  readonly state: TuiRunState;
  readonly steps: readonly string[];
  readonly now?: string;
}

export function ThoughtLine({
  active,
  startedAt,
  elapsedMs,
  state,
  steps,
  now,
}: ThoughtLineProps): React.JSX.Element {
  const theme = useInkTheme();
  const [frameIndex, setFrameIndex] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  // Screen readers announce the frame on every commit; a 180ms spinner plus
  // ticking clock would produce a stream of near-identical announcements.
  // Freeze the glyph and elapsed time and let the text speak for itself.
  const isScreenReader = useIsScreenReaderEnabled();

  useEffect(() => {
    setFrameIndex(0);
    setClock(Date.now());
  }, [active, isScreenReader, now, startedAt]);
  useAnimationTicks(() => {
    setFrameIndex((current) => current + 1);
    setClock(Date.now());
  }, active && now === undefined && !isScreenReader);

  const currentTime = now === undefined ? clock : Date.parse(now);
  const startedTime = startedAt === undefined ? undefined : Date.parse(startedAt);
  const liveElapsed = startedTime === undefined || !Number.isFinite(startedTime)
    ? 0
    : Math.max(0, currentTime - startedTime);
  const duration = elapsedMs ?? liveElapsed;

  if (!active) {
    return (
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.muted} bold>
          {THINKING_FRAMES[3].glyph} Thought for {formatThoughtElapsed(duration)}
        </Text>
      </Box>
    );
  }

  const frame = thinkingFrame(frameIndex);
  const publicStatus = publicStatusLabel(state);
  const visibleSteps = steps.slice(-3);

  return (
    <Box marginTop={1} paddingX={1}>
      <Text color={theme.thinking[frameIndex % theme.thinking.length] ?? frame.color} bold>
        {frame.glyph}{" "}
      </Text>
      <Box flexDirection="column">
        <Text color={theme.primary} bold>
          {publicStatus} · {formatThoughtElapsed(duration)}
        </Text>
        {visibleSteps.map((step) => (
          <Text key={step} dimColor wrap="truncate-end">↳ {step}</Text>
        ))}
      </Box>
    </Box>
  );
}

function publicStatusLabel(state: TuiRunState): string {
  switch (state) {
    case "thinking":
      return "THINKING";
    case "streaming":
      return "STREAMING";
    case "tool-running":
      return "TOOL RUNNING";
    case "waiting-approval":
      return "WAITING FOR APPROVAL";
    case "validating":
      return "VALIDATING";
    case "ready":
      return "READY";
    default:
      return state.toUpperCase();
  }
}
