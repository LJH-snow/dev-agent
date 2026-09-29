import { useEffect, useState } from "react";
import { Box, Text, useIsScreenReaderEnabled } from "ink";

import { useAnimationTicks } from "./animation-clock.js";

import type { CommandHint } from "../tui-renderer.js";
import { useInkTheme } from "./theme.js";

export const COMMAND_PULSE_FRAMES = ["✦", "✧", "✸", "✹"] as const;
export const COMMAND_PALETTE_VISIBLE = 6;
const COMMAND_PALETTE_SELECTED_INK = "#131923";

export function commandPaletteFrame(index: number): string {
  const normalized = ((index % COMMAND_PULSE_FRAMES.length) +
    COMMAND_PULSE_FRAMES.length) % COMMAND_PULSE_FRAMES.length;
  return COMMAND_PULSE_FRAMES[normalized] ?? COMMAND_PULSE_FRAMES[0];
}

export function CommandPalette({
  suggestions,
  columns,
  selectedIndex = 0,
  frameIndex: controlledFrameIndex,
}: {
  readonly suggestions: readonly CommandHint[];
  readonly columns: number;
  readonly selectedIndex?: number;
  readonly frameIndex?: number;
}): React.JSX.Element | null {
  const theme = useInkTheme();
  const [frameIndex, setFrameIndex] = useState(0);
  const isScreenReader = useIsScreenReaderEnabled();
  const visible = suggestions.slice(0, COMMAND_PALETTE_VISIBLE);
  const active = visible.length > 0;
  const selected = Math.min(
    Math.max(0, selectedIndex),
    Math.max(0, visible.length - 1),
  );
  const suggestionsKey = JSON.stringify(suggestions);
  const glyph = commandPaletteFrame(isScreenReader ? 0 : controlledFrameIndex ?? frameIndex);

  useEffect(() => {
    setFrameIndex(0);
  }, [active, controlledFrameIndex, isScreenReader, suggestionsKey]);
  useAnimationTicks(
    (value) => setFrameIndex(value),
    active && !isScreenReader && controlledFrameIndex === undefined,
    suggestionsKey,
  );

  if (!active) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
      width={columns - 2}
    >
      <Text color={theme.info} bold>
        {glyph} COMMANDS // DECK
      </Text>
      {visible.map((command, index) => {
        const isSelected = index === selected;
        return (
          <Box key={command.command} backgroundColor={isSelected ? theme.primary : undefined}>
            <Text
              color={isSelected ? COMMAND_PALETTE_SELECTED_INK : theme.accent}
              wrap="truncate-end"
            >
              <Text color={isSelected ? COMMAND_PALETTE_SELECTED_INK : theme.quote}>
                {isSelected ? "› " : "· "}
              </Text>
              {command.command}
              {command.description ? (
                <Text color={isSelected ? COMMAND_PALETTE_SELECTED_INK : undefined} dimColor={!isSelected}>
                  {`  ${command.description}`}
                </Text>
              ) : null}
            </Text>
          </Box>
        );
      })}
      <Text color={theme.muted}>Tab select · ↑↓ move · esc close</Text>
    </Box>
  );
}
