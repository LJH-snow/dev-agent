import { useEffect, useRef } from "react";
import { Box, Text, measureElement, type DOMElement } from "ink";

import { panelRowAt, type PanelLayout } from "./panel-hitbox.js";
import { useInkTheme } from "./theme.js";

/** Rows painted above the first history row: top border + header. */
export const HISTORY_SEARCH_HEADER_ROWS = 2;
/**
 * Session histories stay small, but long prompts wrap; the search renders a
 * bounded window that follows the selection so the composer and footer stay
 * anchored, mirroring the command palette.
 */
export const HISTORY_SEARCH_VISIBLE = 6;
const HISTORY_SEARCH_SELECTED_INK = "#131923";
/** Maximum matched entries kept for navigation; histories are session-scoped. */
export const HISTORY_SEARCH_MAX_MATCHES = 200;

export interface HistorySearchPanelProps {
  readonly query: string;
  readonly matches: readonly string[];
  readonly selectedIndex: number;
  readonly columns: number;
  /** First matched entry painted in the scrolling visible window. */
  readonly offset?: number;
  readonly onLayout?: (layout: PanelLayout) => void;
}

/** Maps a primary mouse press onto the painted history row, or undefined. */
export function historySearchRowAt(
  click: { readonly button: number; readonly y: number; readonly action: string },
  layout: PanelLayout | undefined,
  matchCount: number,
): number | undefined {
  return panelRowAt(
    click,
    layout,
    HISTORY_SEARCH_HEADER_ROWS,
    Math.min(HISTORY_SEARCH_VISIBLE, matchCount),
  );
}

/** Collapses a stored prompt into one paintable search row. */
export function historySearchRow(entry: string): string {
  return entry.replace(/[\r\n\t]+/gu, " ⏎ ").trim();
}

export function HistorySearchPanel({
  query,
  matches,
  selectedIndex,
  columns,
  offset = 0,
  onLayout,
}: HistorySearchPanelProps): React.JSX.Element {
  const theme = useInkTheme();
  const boxRef = useRef<DOMElement | null>(null);
  const reportedLayoutRef = useRef("");
  const visible = matches.slice(offset, offset + HISTORY_SEARCH_VISIBLE);
  const selected = Math.min(
    Math.max(0, selectedIndex - offset),
    Math.max(0, visible.length - 1),
  );
  // Same measured-layout contract as the command palette so pointer
  // hit-testing stays aligned with what is painted.
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
      borderColor={theme.info}
      paddingX={1}
      marginTop={1}
      width={columns - 2}
    >
      <Text color={theme.info} bold>
        ⌕ HISTORY // SEARCH · {query.length > 0 ? `"${query}"` : "type to filter"}
        {matches.length > 0 ? ` · ${matches.length} match${matches.length === 1 ? "" : "es"}` : ""}
      </Text>
      {visible.length === 0 ? (
        <Text color={theme.muted}>No matching history.</Text>
      ) : visible.map((entry, index) => {
        const isSelected = index === selected;
        return (
          <Box key={`${index}-${entry}`} backgroundColor={isSelected ? theme.primary : undefined}>
            <Text
              color={isSelected ? HISTORY_SEARCH_SELECTED_INK : theme.text}
              wrap="truncate-end"
            >
              <Text color={isSelected ? HISTORY_SEARCH_SELECTED_INK : theme.quote}>
                {isSelected ? "› " : "  "}
              </Text>
              {historySearchRow(entry)}
            </Text>
          </Box>
        );
      })}
      <Text color={theme.muted}>
        ↑↓ move · Enter accept · ^R next · click accept · esc cancel
      </Text>
    </Box>
  );
}
