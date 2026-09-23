import { Box, Text } from "ink";

import type { InkCollaborationSnapshot, InkCollaborationTask } from "./runtime-store.js";
import { useInkTheme } from "./theme.js";
import { formatToolDuration } from "./tool-timeline.js";

export function CollaborationPanel({
  collaboration,
  columns,
}: {
  readonly collaboration: InkCollaborationSnapshot | undefined;
  readonly columns: number;
}): React.JSX.Element | null {
  const theme = useInkTheme();
  if (collaboration === undefined || collaboration.tasks.length === 0) {
    return null;
  }

  const failedTask = collaboration.tasks.find((task) =>
    task.status === "failed" || task.status === "cancelled"
  );
  const isReview = collaboration.status === "review" || collaboration.status === "failed";
  const statusLabel = collaboration.status.toUpperCase();

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={panelBorderColor(collaboration, theme)}
      paddingX={1}
      marginTop={1}
      width={Math.max(24, columns - 2)}
    >
      <Text color={theme.info} bold>
        ✦ TEAM EXECUTION · {statusLabel}
        {collaboration.review === undefined ? "" : ` · ${collaboration.review.changedFiles.length} files`}
      </Text>
      {collaboration.tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
      {collaboration.review !== undefined ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={collaboration.review.mergeable ? theme.success : theme.warning}>
            {collaboration.review.mergeable ? "Review ready" : "Review blocked"} ·{" "}
            <Text color={theme.success}>+{collaboration.review.additions}</Text>{" "}
            <Text color={theme.error}>-{collaboration.review.deletions}</Text>
          </Text>
          {collaboration.review.conflicts.length > 0 ? (
            <Text color={theme.error} wrap="truncate-end">
              Conflicts: {collaboration.review.conflicts.join(", ")}
            </Text>
          ) : null}
        </Box>
      ) : null}
      <Text color={theme.warning}>
        {collaboration.status === "merged"
          ? "Team changes merged into the current branch"
          : isReview && collaboration.review?.mergeable
          ? ":team apply to merge · :team cancel to stop"
          : failedTask !== undefined
            ? `:team retry ${failedTask.id}`
            : "Ctrl-C cancels all · :team cancel <task> cancels one"}
      </Text>
    </Box>
  );
}

function TaskRow({ task }: { readonly task: InkCollaborationTask }): React.JSX.Element {
  const theme = useInkTheme();
  const statusColor = taskStatusColor(task.status, theme);
  const role = task.role === undefined ? "" : ` · ${task.role}`;
  const duration = task.durationMs > 0 ? ` · ${formatToolDuration(task.durationMs)}` : "";
  const attempts = task.attempts > 0 ? ` · attempt ${task.attempts}` : "";
  return (
    <Text wrap="truncate-end">
      <Text color={statusColor} bold>{taskStatusGlyph(task.status)} </Text>
      <Text color={theme.text} bold>{task.title.toUpperCase()}</Text>
      <Text dimColor>{role} · {task.status}{attempts}{duration}</Text>
      {task.error === undefined ? "" : <Text color={theme.error}> · {task.error}</Text>}
    </Text>
  );
}

function taskStatusGlyph(status: InkCollaborationTask["status"]): string {
  switch (status) {
    case "running":
    case "retrying":
      return "◌";
    case "completed":
      return "✓";
    case "failed":
      return "×";
    case "cancelled":
      return "∅";
    case "blocked":
      return "!";
    case "queued":
    default:
      return "·";
  }
}

function taskStatusColor(
  status: InkCollaborationTask["status"],
  theme: ReturnType<typeof useInkTheme>,
): string {
  switch (status) {
    case "completed":
      return theme.success;
    case "failed":
    case "blocked":
      return theme.error;
    case "cancelled":
      return theme.warning;
    case "running":
    case "retrying":
      return theme.info;
    case "queued":
    default:
      return theme.muted;
  }
}

function panelBorderColor(
  collaboration: InkCollaborationSnapshot,
  theme: ReturnType<typeof useInkTheme>,
): string {
  if (collaboration.status === "failed" || collaboration.review?.mergeable === false) {
    return theme.warning;
  }
  if (collaboration.status === "review" || collaboration.status === "merged") {
    return theme.success;
  }
  return theme.info;
}
