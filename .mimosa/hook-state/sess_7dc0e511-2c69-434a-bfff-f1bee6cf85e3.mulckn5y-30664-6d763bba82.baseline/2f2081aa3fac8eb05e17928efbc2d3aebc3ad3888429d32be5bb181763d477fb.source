const TASK_STATUSES = new Set(["idle", "running", "waiting", "done", "failed", "aborted"]);

function normalizedText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function taskStatus(summary) {
  const status = summary?.run?.status;
  return TASK_STATUSES.has(status) ? status : "idle";
}

export function taskTitle(summary) {
  const title = summary?.presentation?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  if (typeof summary?.suggestedTitle === "string" && summary.suggestedTitle.trim()) return summary.suggestedTitle.trim();
  return typeof summary?.sessionId === "string" && summary.sessionId ? summary.sessionId : "Untitled task";
}

export function taskTimeValue(summary) {
  const runStarted = Date.parse(summary?.run?.startedAt ?? "");
  const lastActive = Date.parse(summary?.lastActiveAt ?? "");
  const created = Date.parse(summary?.createdAt ?? "");
  return Math.max(Number.isFinite(runStarted) ? runStarted : 0, Number.isFinite(lastActive) ? lastActive : 0, Number.isFinite(created) ? created : 0);
}

export function taskMatches(summary, query = "", status = "all") {
  const desiredStatus = normalizedText(status);
  if (desiredStatus && desiredStatus !== "all" && taskStatus(summary) !== desiredStatus) return false;
  const needle = normalizedText(query);
  if (!needle) return true;
  return [taskTitle(summary), summary?.preview, summary?.suggestedTitle, summary?.sessionId]
    .some((value) => normalizedText(value).includes(needle));
}

export function groupTasks(summaries, options = {}) {
  const groups = { pinned: [], recent: [], archived: [] };
  if (!Array.isArray(summaries)) return groups;
  const filtered = summaries.filter((summary) => taskMatches(summary, options.query, options.status));
  for (const summary of filtered) {
    if (summary?.presentation?.archived === true) groups.archived.push(summary);
    else if (summary?.presentation?.pinned === true) groups.pinned.push(summary);
    else groups.recent.push(summary);
  }
  const sortRecent = (left, right) => taskTimeValue(right) - taskTimeValue(left) || taskTitle(left).localeCompare(taskTitle(right));
  groups.pinned.sort((left, right) => taskTimeValue(right) - taskTimeValue(left) || taskTitle(left).localeCompare(taskTitle(right)));
  groups.recent.sort(sortRecent);
  groups.archived.sort(sortRecent);
  return groups;
}

export function taskStatusLabel(status, language = "en") {
  const labels = {
    en: { idle: "Idle", running: "Running", waiting: "Waiting", done: "Complete", failed: "Failed", aborted: "Aborted" },
    zh: { idle: "空闲", running: "运行中", waiting: "等待处理", done: "已完成", failed: "失败", aborted: "已中止" },
  };
  return labels[language === "zh" ? "zh" : "en"][taskStatus({ run: { status } })];
}
