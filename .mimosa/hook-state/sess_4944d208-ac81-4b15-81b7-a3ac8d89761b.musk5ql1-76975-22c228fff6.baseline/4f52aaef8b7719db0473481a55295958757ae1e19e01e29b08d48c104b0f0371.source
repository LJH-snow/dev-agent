import { Box, Text } from "ink";

import type { PlanReview } from "@dev-agent/agent-core";
import { DiffPreview } from "./diff-preview.js";
import { useInkTheme } from "./theme.js";

export function PlanReviewPanel({
  prompt,
  review,
  status,
  columns,
}: {
  readonly prompt: string;
  readonly review: PlanReview;
  readonly status: "ready" | "applying";
  readonly columns: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  const diff = review.files
    .map((file) => file.diff)
    .filter((value) => value.trim().length > 0)
    .join("\n");

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.info}
      paddingX={1}
      marginTop={1}
      width={Math.max(24, columns - 2)}
    >
      <Text color={theme.info} bold>
        ✦ {status === "applying" ? "APPLYING PLAN" : "PLAN READY"} ·{" "}
        {review.files.length} file{review.files.length === 1 ? "" : "s"}{" "}
        <Text color={theme.success}>+{review.additions}</Text>{" "}
        <Text color={theme.error}>-{review.deletions}</Text>
      </Text>
      <Text dimColor wrap="truncate-end">{prompt}</Text>
      {review.files.map((file) => (
        <Text key={file.path} color={theme.accent} wrap="truncate-end">
          · {file.path}{" "}
          <Text dimColor>+{file.additions}/-{file.deletions}</Text>
        </Text>
      ))}
      <DiffPreview
        diff={diff}
        width={Math.max(24, columns - 4)}
        maxLines={14}
        summary={{ additions: review.additions, deletions: review.deletions }}
      />
      <Text color={theme.warning}>
        {status === "applying" ? "Applying approved changes…" : ":apply to execute · Esc to keep"}
      </Text>
    </Box>
  );
}
