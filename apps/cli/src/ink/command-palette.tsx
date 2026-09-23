import { useEffect, useState } from "react";
import { Box, Text } from "ink";

import type { CommandHint } from "../tui-renderer.js";
import { useInkTheme } from "./theme.js";

export const COMMAND_PULSE_FRAMES = ["✦", "✧", "✸", "✹"] as const;

export function commandPaletteFrame(index: number): string {
  const normalized = ((index % COMMAND_PULSE_FRAMES.length) +
    COMMAND_PULSE_FRAMES.length) % COMMAND_PULSE_FRAMES.length;
  return COMMAND_PULSE_FRAMES[normalized] ?? COMMAND_PULSE_FRAMES[0];
}

export function CommandPalette({
  suggestions,
  columns,
  frameIndex: controlledFrameIndex,
}: {
  readonly suggestions: readonly CommandHint[];
  readonly columns: number;
  readonly frameIndex?: number;
}): React.JSX.Element | null {
  const theme = useInkTheme();
  const [frameIndex, setFrameIndex] = useState(0);
  const visible = suggestions.slice(0, 6);
  const active = visible.length > 0;
  const glyph = commandPaletteFrame(controlledFrameIndex ?? frameIndex);

  useEffect(() => {
    setFrameIndex(0);
    if (!active || controlledFrameIndex !== undefined) {
      return;
    }
    const timer = setInterval(() => {
      setFrameIndex((current) => current + 1);
    }, 180);
    return () => clearInterval(timer);
  }, [active, controlledFrameIndex, suggestions.join("\u0000")]);

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
      {visible.map((command, index) => (
        <Text key={command.command} wrap="truncate-end">
          <Text color={index === 0 ? theme.accent : theme.quote}>
            {index === 0 ? "› " : "· "}
          </Text>
          <Text color={index === 0 ? theme.text : theme.accent}>
            {command.command}
          </Text>
          {command.description ? (
            <Text dimColor>  {command.description}</Text>
          ) : null}
        </Text>
      ))}
    </Box>
  );
}
