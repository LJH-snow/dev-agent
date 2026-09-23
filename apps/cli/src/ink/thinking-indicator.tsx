import { useEffect, useState } from "react";
import { Text } from "ink";

import { useInkTheme } from "./theme.js";

export const THINKING_FRAMES = [
  { glyph: "✧", color: "#6fb8ff" },
  { glyph: "✦", color: "#80c2ff" },
  { glyph: "✸", color: "#9ed0ff" },
  { glyph: "✹", color: "#c5e4ff" },
  { glyph: "✸", color: "#9ed0ff" },
  { glyph: "✦", color: "#80c2ff" },
  { glyph: "✧", color: "#6fb8ff" },
] as const;

export function thinkingFrame(index: number): (typeof THINKING_FRAMES)[number] {
  const normalized = ((index % THINKING_FRAMES.length) + THINKING_FRAMES.length) %
    THINKING_FRAMES.length;
  return THINKING_FRAMES[normalized] ?? THINKING_FRAMES[0];
}

export function ThinkingIndicator({
  active,
}: {
  readonly active: boolean;
}): React.JSX.Element | null {
  const theme = useInkTheme();
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setFrameIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setFrameIndex((current) => current + 1);
    }, 180);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) {
    return null;
  }
  const frame = thinkingFrame(frameIndex);
  const color = theme.thinking[frameIndex % theme.thinking.length] ?? frame.color;
  return <Text color={color} bold>{frame.glyph} </Text>;
}
