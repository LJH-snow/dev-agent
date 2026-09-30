import { useEffect, useRef } from "react";
import { Box, Text, measureElement, type DOMElement } from "ink";

import { type PanelLayout } from "./panel-hitbox.js";
import { useInkTheme } from "./theme.js";

export interface SessionPickerProps {
  readonly title: string;
  readonly rows: readonly string[];
  readonly selectedIndex: number;
  readonly columns: number;
  readonly onLayout?: (layout: PanelLayout) => void;
}

/** Rows painted above the first session row: top border + header. */
export const SESSION_PICKER_HEADER_ROWS = 2;

export function SessionPicker({
  title,
  rows,
  selectedIndex,
  columns,
  onLayout,
}: SessionPickerProps): React.JSX.Element {
  const theme = useInkTheme();
  const boxRef = useRef<DOMElement | null>(null);
  const reportedLayoutRef = useRef("");
  // Measure the bordered box after each commit so click hit-testing stays
  // aligned with what is painted; the change guard keeps re-measures from
  // re-rendering the whole app.
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
      <Text color={theme.info} bold>{title}</Text>
      {rows.length === 0 ? (
        <Text color={theme.muted}>No matching sessions.</Text>
      ) : rows.map((row, index) => (
        <Text key={`${index}-${row}`} wrap="truncate-end">
          <Text color={index === selectedIndex ? theme.primary : theme.muted}>
            {index === selectedIndex ? "› " : "  "}
          </Text>
          <Text color={index === selectedIndex ? theme.text : theme.muted}>{row}</Text>
        </Text>
      ))}
      <Text color={theme.muted}>↑↓ move · Enter resume · click select · esc close</Text>
    </Box>
  );
}
