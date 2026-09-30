import { useEffect, useRef, useState } from "react";
import {
  Box,
  Text,
  measureElement,
  useIsScreenReaderEnabled,
  type DOMElement,
} from "ink";

import { useAnimationTicks } from "./animation-clock.js";

import type { CommandHint } from "../tui-renderer.js";
import { useInkTheme } from "./theme.js";

export const COMMAND_PULSE_FRAMES = ["✦", "✧", "✸", "✹"] as const;
export const COMMAND_PALETTE_VISIBLE = 6;
const COMMAND_PALETTE_SELECTED_INK = "#131923";

/** Painted position of the bordered palette box, in 0-based live-frame rows. */
export interface CommandPaletteLayout {
  readonly top: number;
  readonly height: number;
}

/** Rows painted above the first command row: top border + header. */
export const COMMAND_PALETTE_HEADER_ROWS = 2;

/**
 * Maps a mouse press onto the painted command row index, or undefined when
 * the click misses the palette. Wheel, motion, and non-primary buttons never
 * select a row.
 */
export function commandPaletteRowAt(
  click: { readonly button: number; readonly y: number; readonly action: string },
  layout: CommandPaletteLayout | undefined,
  suggestionCount: number,
): number | undefined {
  if (layout === undefined || suggestionCount <= 0) return undefined;
  if (click.action !== "press") return undefined;
  if ((click.button & 64) !== 0 || (click.button & 32) !== 0) return undefined;
  if ((click.button & 3) !== 0) return undefined;
  const row = click.y - (layout.top + COMMAND_PALETTE_HEADER_ROWS + 1);
  if (row < 0 || row >= Math.min(COMMAND_PALETTE_VISIBLE, suggestionCount)) {
    return undefined;
  }
  return row;
}

export function commandPaletteFrame(index: number): string {
  const normalized = ((index % COMMAND_PULSE_FRAMES.length) +
    COMMAND_PULSE_FRAMES.length) % COMMAND_PULSE_FRAMES.length;
  return COMMAND_PULSE_FRAMES[normalized] ?? COMMAND_PULSE_FRAMES[0];
}

export function CommandPalette({
  suggestions,
  columns,
  selectedIndex = 0,
  offset = 0,
  frameIndex: controlledFrameIndex,
  onLayout,
}: {
  readonly suggestions: readonly CommandHint[];
  readonly columns: number;
  readonly selectedIndex?: number;
  /** First suggestion painted in the scrolling visible window. */
  readonly offset?: number;
  readonly frameIndex?: number;
  readonly onLayout?: (layout: CommandPaletteLayout) => void;
}): React.JSX.Element | null {
  const theme = useInkTheme();
  const [frameIndex, setFrameIndex] = useState(0);
  const isScreenReader = useIsScreenReaderEnabled();
  const boxRef = useRef<DOMElement | null>(null);
  const reportedLayoutRef = useRef("");
  const visible = suggestions.slice(offset, offset + COMMAND_PALETTE_VISIBLE);
  const active = visible.length > 0;
  const selected = Math.min(
    Math.max(0, selectedIndex - offset),
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

  // The palette is flow-positioned inside the scrollable content box, so its
  // painted rows cannot be derived from the terminal bottom. Measure the
  // bordered box after each commit and report position changes so click
  // hit-testing stays aligned with what is actually painted. The change guard
  // keeps the animation ticks from re-rendering the whole app.
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    try {
      const measured = measureElement(node);
      if (measured.height <= 0) return;
      const key = `${measured.y}:${measured.height}`;
      if (key !== reportedLayoutRef.current) {
        reportedLayoutRef.current = key;
        onLayout?.({ top: measured.y, height: measured.height });
      }
    } catch {
      // The node is not attached yet; the next commit measures it.
    }
  });

  if (!active) return null;

  return (
    <Box
      ref={boxRef}
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
      <Text color={theme.muted}>Tab select · ↑↓ move · click accept · esc close</Text>
    </Box>
  );
}
