const DEFAULT_STATUS = "all";
const SESSION_STATUSES = new Set([
  "all",
  "idle",
  "running",
  "waiting",
  "done",
  "failed",
  "aborted",
]);

function normalizeQuery(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeStatus(value) {
  return SESSION_STATUSES.has(value) ? value : DEFAULT_STATUS;
}

function getSessionStatus(summary) {
  const status = summary?.run?.status;
  return SESSION_STATUSES.has(status) && status !== DEFAULT_STATUS ? status : "idle";
}

export function filterSessionSummaries(summaries, options = {}) {
  if (!Array.isArray(summaries)) return [];

  const query = normalizeQuery(options.query);
  const status = normalizeStatus(options.status);

  return summaries.filter((summary) => {
    const sessionId = typeof summary?.sessionId === "string" ? summary.sessionId : "";
    if (query && !sessionId.toLowerCase().includes(query)) return false;
    return status === DEFAULT_STATUS || getSessionStatus(summary) === status;
  });
}
