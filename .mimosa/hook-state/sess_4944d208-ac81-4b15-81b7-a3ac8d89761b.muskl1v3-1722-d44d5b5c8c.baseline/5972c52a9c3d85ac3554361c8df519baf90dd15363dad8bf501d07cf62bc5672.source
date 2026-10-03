import { useEffect, useRef } from "react";
import { Box, Text, measureElement, type DOMElement } from "ink";

import { type PanelLayout } from "./panel-hitbox.js";
import { useInkTheme } from "./theme.js";

export interface SessionPickerProps {
  readonly title: string;
  readonly rows: readonly string[];
  readonly selectedIndex: number;
  readonly columns: number;
  /** First row painted in the scrolling visible window. */
  readonly offset?: number;
  readonly onLayout?: (layout: PanelLayout) => void;
}

/** Rows painted above the first session row: top border + header. */
export const SESSION_PICKER_HEADER_ROWS = 2;
/**
 * Large session registries can hold hundreds of entries; painting them all
 * would push the composer and footer out of the terminal, so the picker
 * renders a bounded window that follows the selection.
 */
export const SESSION_PICKER_VISIBLE = 8;

export function SessionPicker({
  title,
  rows,
  selectedIndex,
  columns,
  offset = 0,
  onLayout,
}: SessionPickerProps): React.JSX.Element {
  const theme = useInkTheme();
  const boxRef = useRef<DOMElement | null>(null);
  const reportedLayoutRef = useRef("");
  const visible = rows.slice(offset, offset + SESSION_PICKER_VISIBLE);
  const selected = Math.min(
    Math.max(0, selectedIndex - offset),
    Math.max(0, visible.length - 1),
  );
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
      {visible.length === 0 ? (
        <Text color={theme.muted}>No matching sessions.</Text>
      ) : visible.map((row, index) => (
        <Text key={`${index}-${row}`} wrap="truncate-end">
          <Text color={index === selected ? theme.primary : theme.muted}>
            {index === selected ? "› " : "  "}
          </Text>
          <Text color={index === selected ? theme.text : theme.muted}>{row}</Text>
        </Text>
      ))}
      <Text color={theme.muted}>
        {rows.length > SESSION_PICKER_VISIBLE
          ? `↑↓ move · Enter resume · click select · esc close · ${selectedIndex + 1}/${rows.length}`
          : "↑↓ move · Enter resume · click select · esc close"}
      </Text>
    </Box>
  );
}
