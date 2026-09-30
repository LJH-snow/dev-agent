const DEFAULT_ACTIVITY = "thinking";

export function getTurnActivityForEvent(eventType) {
  switch (eventType) {
    case "tool":
    case "tool-progress":
      return "tool";
    case "token":
      return "responding";
    case "approval-request":
    case "plan-review":
      return "approval";
    case "done":
      return "done";
    case "error":
      return "failed";
    case "aborted":
      return "aborted";
    default:
      return DEFAULT_ACTIVITY;
  }
}

export function getTurnActivityForState(state) {
  switch (state) {
    case "queued":
      return "queued";
    case "waiting":
      return "approval";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    case "removed":
      return "removed";
    case "running":
    default:
      return DEFAULT_ACTIVITY;
  }
}
