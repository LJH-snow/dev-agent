import { Box, Text } from "ink";

import { useInkTheme } from "./theme.js";

export interface SessionPickerProps {
  readonly title: string;
  readonly rows: readonly string[];
  readonly selectedIndex: number;
  readonly columns: number;
}

export function SessionPicker({
  title,
  rows,
  selectedIndex,
  columns,
}: SessionPickerProps): React.JSX.Element {
  const theme = useInkTheme();
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
      <Text color={theme.muted}>↑↓ move · Enter resume · esc close</Text>
    </Box>
  );
}
