import type {
  AgentTaskScheduler,
  AgentTaskSnapshot,
} from "@dev-agent/agent-core";

export type TaskCommandResult =
  | { readonly handled: false }
  | {
      readonly handled: true;
      readonly kind: "list";
      readonly tasks: readonly AgentTaskSnapshot[];
    }
  | {
      readonly handled: true;
      readonly kind: "inspect";
      readonly task: AgentTaskSnapshot;
    }
  | { readonly handled: true; readonly kind: "usage" }
  | { readonly handled: true; readonly kind: "unknown"; readonly id: string };

const NOT_HANDLED: TaskCommandResult = { handled: false };

export function isTaskCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  return normalized === ":tasks" ||
    normalized === ":task" ||
    normalized.startsWith(":task ");
}

export function executeTaskCommand(
  command: string,
  scheduler: AgentTaskScheduler,
): TaskCommandResult {
  const normalized = normalizeCommand(command);
  if (normalized === ":tasks") {
    return {
      handled: true,
      kind: "list",
      tasks: scheduler.list(),
    };
  }
  if (normalized === ":task") {
    return { handled: true, kind: "usage" };
  }
  if (!normalized.startsWith(":task ")) {
    return NOT_HANDLED;
  }

  const id = normalized.slice(":task ".length).trim();
  if (id === "" || /\s/u.test(id)) {
    return { handled: true, kind: "usage" };
  }
  const task = scheduler.get(id);
  return task === undefined
    ? { handled: true, kind: "unknown", id }
    : { handled: true, kind: "inspect", task };
}

export function formatTaskCommandResult(result: TaskCommandResult): string {
  if (!result.handled) return "";
  switch (result.kind) {
    case "list":
      return result.tasks.length === 0
        ? "No tasks recorded."
        : [
            "Tasks:",
            ...result.tasks.map(formatListRow),
          ].join("\n");
    case "inspect":
      return [
        `Task: ${safeText(result.task.id)}`,
        `Status: ${safeText(result.task.status)}`,
        `Created: ${safeText(result.task.createdAt)}`,
        ...(result.task.startedAt === undefined
          ? []
          : [`Started: ${safeText(result.task.startedAt)}`]),
        ...(result.task.finishedAt === undefined
          ? []
          : [`Finished: ${safeText(result.task.finishedAt)}`]),
      ].join("\n");
    case "usage":
      return "Usage: :tasks | :task <id>";
    case "unknown":
      return `Unknown task: ${safeText(result.id)}`;
  }
}

function formatListRow(task: AgentTaskSnapshot): string {
  const timing = task.finishedAt ?? task.startedAt ?? task.createdAt;
  return `- ${safeText(task.id)} · ${safeText(task.status)} · ${safeText(timing)}`;
}

function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  return trimmed.startsWith("/")
    ? `:${trimmed.slice(1)}`
    : trimmed;
}

function safeText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
}
