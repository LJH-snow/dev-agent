export function getRecoveredRunQueueAction(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || snapshot.active || snapshot.status === "idle" || snapshot.status === "waiting") {
    return "hold";
  }
  return snapshot.status === "done" ? "drain" : "pause";
}
