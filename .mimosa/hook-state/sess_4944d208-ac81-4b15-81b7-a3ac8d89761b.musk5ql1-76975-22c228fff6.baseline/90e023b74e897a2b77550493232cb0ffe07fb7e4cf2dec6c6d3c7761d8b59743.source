import { Box, Text } from "ink";

import { useInkTheme } from "./theme.js";

export function RetryPanel({
  prompt,
  error,
  columns,
}: {
  readonly prompt: string;
  readonly error: string;
  readonly columns: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.error}
      paddingX={1}
      marginTop={1}
      width={columns - 2}
    >
      <Text color={theme.error} bold>RUN FAILED</Text>
      <Text color={theme.text} wrap="truncate-end">Prompt: {prompt}</Text>
      <Text color={theme.error} wrap="wrap">× {error}</Text>
      <Text color={theme.warning}>[r] Retry · :retry · esc dismiss</Text>
    </Box>
  );
}
