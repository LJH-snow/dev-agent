import { Box, Text } from "ink";

import { useInkTheme } from "./theme.js";

export interface HistoryPanelProps {
  readonly title: string;
  readonly rows: readonly string[];
  readonly columns: number;
  readonly maxRows?: number;
}

const DEFAULT_MAX_ROWS = 12;

export function HistoryPanel({
  title,
  rows,
  columns,
  maxRows = DEFAULT_MAX_ROWS,
}: HistoryPanelProps): React.JSX.Element {
  const theme = useInkTheme();
  const limit = normalizeMaxRows(maxRows);
  const visible = rows.slice(0, limit);
  const omitted = Math.max(0, rows.length - visible.length);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
      width={columns - 2}
    >
      <Text color={theme.info} bold>{title}</Text>
      {visible.map((row, index) => (
        <Text key={`${index}-${row}`} color={theme.text} wrap="truncate-end">
          {row}
        </Text>
      ))}
      {omitted > 0 ? (
        <Text color={theme.muted}>… {omitted} more history entries</Text>
      ) : null}
    </Box>
  );
}

function normalizeMaxRows(value: number): number {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, 50)
    : DEFAULT_MAX_ROWS;
}
