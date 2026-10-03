const MAX_ROWS = 64;
const MAX_HISTORY = 20;
const TOKEN = /\b(?:gh[pousr]|sk|pk|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gi;
const SECRET = /\b((?:api[_-]?key|access[_-]?token|authorization|cookie|password|passphrase|secret|token)\s*[:=]\s*)[^\s,;]+/gi;
function clean(value, limit = 512) {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").replace(SECRET, "$1[redacted]").replace(TOKEN, "[redacted-token]").slice(0, limit) : "";
}
export function createScheduledTasksUI({
  documentRef = globalThis.document,
  fetcher = globalThis.fetch?.bind(globalThis),
  translate = (key) => key,
} = {}) {
  const panel = documentRef?.getElementById("scheduled-tasks-panel");
  const statusNode = documentRef?.getElementById("scheduled-tasks-status");
  const refreshButton = documentRef?.getElementById("scheduled-tasks-refresh");
  const listNode = documentRef?.getElementById("scheduled-tasks-definitions");
  const form = documentRef?.getElementById("scheduled-tasks-form");
  const titleInput = documentRef?.getElementById("scheduled-tasks-title");
  const repoInput = documentRef?.getElementById("scheduled-tasks-repo");
  const kindSelect = documentRef?.getElementById("scheduled-tasks-kind");
  const intervalInput = documentRef?.getElementById("scheduled-tasks-interval");
  const timeInput = documentRef?.getElementById("scheduled-tasks-time");
  const createButton = documentRef?.getElementById("scheduled-tasks-create");
  const historyNode = documentRef?.getElementById("scheduled-tasks-history");
  let schedules = [];
  let requestSequence = 0;
  let busy = false;
  let status = "scheduledTasks.ready";
  let selectedId = "";
  const t = (key) => { try { return translate(key); } catch { return key; } };
  const cadenceLabel = (schedule) => schedule.kind === "daily"
    ? t("scheduledTasks.cadence.daily") + " " + clean(schedule.timeOfDay, 5)
    : t("scheduledTasks.cadence.every") + " " + String(Number(schedule.intervalMinutes) || 0);
  function rowLabel(schedule) {
    const bits = [clean(schedule.title, 120) || t("scheduledTasks.untitled"), clean(schedule.job, 32)];
    if (schedule.repo) bits.push(clean(schedule.repo, 512));
    bits.push(cadenceLabel(schedule));
    if (schedule.running) bits.push(t("scheduledTasks.running"));
    else bits.push(`${t("scheduledTasks.next")}: ${clean(schedule.enabled ? schedule.nextRunAt : "—", 40)}`);
    bits.push(schedule.lastRunAt
      ? `${t("scheduledTasks.lastRun")}: ${schedule.lastOk ? t("scheduledTasks.ok") : t("scheduledTasks.failed")}`
      : `${t("scheduledTasks.lastRun")}: ${t("scheduledTasks.never")}`);
    if (!schedule.enabled) bits.push(t("scheduledTasks.disabled"));
    return bits.join(" · ");
  }
  function list() {
    if (!listNode) return;
    listNode.replaceChildren();
    if (!schedules.length) {
      const item = documentRef.createElement("li");
      item.textContent = t(status === "scheduledTasks.loaded" ? "scheduledTasks.empty" : "scheduledTasks.emptyIdle");
      listNode.append(item);
      return;
    }
    for (const schedule of schedules.slice(0, MAX_ROWS)) {
      const item = documentRef.createElement("li");
      const label = documentRef.createElement("span");
      label.className = "scheduled-tasks-row-label";
      label.textContent = rowLabel(schedule);
      item.append(label);
      const action = (text, handler) => {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "scheduled-tasks-action";
        button.textContent = text;
        button.dataset.scheduleId = String(schedule.id);
        button.addEventListener("click", handler);
        item.append(button);
      };
      action(t("scheduledTasks.runNow"), () => { void runNow(schedule.id); });
      action(schedule.enabled ? t("scheduledTasks.disable") : t("scheduledTasks.enable"),
        () => { void toggle(schedule); });
      action(t("scheduledTasks.history"), () => { void loadHistory(schedule.id); });
      action(t("scheduledTasks.delete"), () => { void remove(schedule.id); });
      listNode.append(item);
    }
  }
  function render() {
    if (!panel) return;
    panel.dataset.state = schedules.length ? "loaded" : "idle";
    if (statusNode) statusNode.textContent = t(status);
    list();
    if (refreshButton) refreshButton.disabled = busy;
    if (createButton) createButton.disabled = busy;
  }
  async function refresh() {
    if (typeof fetcher !== "function" || busy) return false;
    const requestId = ++requestSequence;
    busy = true; status = "scheduledTasks.loading"; render();
    try {
      const response = await fetcher("/api/schedules");
      const payload = await response.json().catch(() => ({}));
      if (requestId !== requestSequence) return false;
      if (!response.ok || !Array.isArray(payload?.schedules)) {
        schedules = []; status = "scheduledTasks.error"; render(); return false;
      }
      schedules = payload.schedules;
      status = "scheduledTasks.loaded"; render(); return true;
    } catch {
      if (requestId !== requestSequence) return false;
      schedules = []; status = "scheduledTasks.error"; render(); return false;
    } finally { if (requestId === requestSequence) { busy = false; render(); } }
  }
  function buildPayload() {
    const kind = clean(kindSelect?.value, 16) === "daily" ? "daily" : "interval";
    const payload = {
      title: clean(titleInput?.value, 120).trim(),
      job: "ci-watch",
      repo: clean(repoInput?.value, 512).trim(),
      kind,
    };
    if (kind === "interval") payload.intervalMinutes = Number(clean(intervalInput?.value, 8)) || 60;
    if (kind === "daily") payload.timeOfDay = clean(timeInput?.value, 5) || "09:00";
    return payload;
  }
  async function create() {
    if (busy) return false;
    const payload = buildPayload();
    if (!payload.title || !payload.repo) { status = "scheduledTasks.invalidInput"; render(); return false; }
    const requestId = ++requestSequence;
    busy = true; status = "scheduledTasks.creating"; render();
    try {
      const response = await fetcher("/api/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const payloadBody = await response.json().catch(() => ({}));
      if (requestId !== requestSequence) return false;
      if (!response.ok) {
        status = ({ "schedule-limit": "scheduledTasks.limit", "invalid-cadence": "scheduledTasks.invalidInput",
          "invalid-title": "scheduledTasks.invalidInput", "invalid-repo": "scheduledTasks.invalidInput" })[payloadBody?.code] || "scheduledTasks.error";
        render(); return false;
      }
      if (titleInput) titleInput.value = "";
      status = "scheduledTasks.created"; render(); return true;
    } catch {
      if (requestId !== requestSequence) return false;
      status = "scheduledTasks.error"; render(); return false;
    } finally { if (requestId === requestSequence) { busy = false; render(); } }
  }
  async function mutate(id, body, busyStatus, doneStatus) {
    if (busy) return false;
    const requestId = ++requestSequence;
    busy = true; status = busyStatus; render();
    try {
      const response = await fetcher(`/api/schedules/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (requestId !== requestSequence) return false;
      if (!response.ok) { status = "scheduledTasks.error"; render(); return false; }
      status = doneStatus; await refresh(); return true;
    } catch {
      if (requestId !== requestSequence) return false;
      status = "scheduledTasks.error"; render(); return false;
    } finally { if (requestId === requestSequence) { busy = false; render(); } }
  }
  function toggle(schedule) {
    return mutate(schedule.id, { enabled: !schedule.enabled }, "scheduledTasks.updating", "scheduledTasks.updated");
  }
  async function remove(id) {
    if (busy) return false;
    const requestId = ++requestSequence;
    busy = true; status = "scheduledTasks.deleting"; render();
    try {
      const response = await fetcher(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (requestId !== requestSequence) return false;
      if (!response.ok) { status = "scheduledTasks.error"; render(); return false; }
      if (selectedId === id) selectedId = "";
      status = "scheduledTasks.deleted"; await refresh(); return true;
    } catch {
      if (requestId !== requestSequence) return false;
      status = "scheduledTasks.error"; render(); return false;
    } finally { if (requestId === requestSequence) { busy = false; render(); } }
  }
  async function runNow(id) {
    if (busy) return false;
    const requestId = ++requestSequence;
    busy = true; status = "scheduledTasks.runStarted"; render();
    try {
      const response = await fetcher(`/api/schedules/${encodeURIComponent(id)}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (requestId !== requestSequence) return false;
      if (!response.ok) {
        status = ({ "unknown-schedule": "scheduledTasks.error", "already-running": "scheduledTasks.running" })[ (await response.json().catch(() => ({})))?.code ] || "scheduledTasks.runFailed";
        render(); return false;
      }
      status = "scheduledTasks.loaded"; await refresh(); return true;
    } catch {
      if (requestId !== requestSequence) return false;
      status = "scheduledTasks.runFailed"; render(); return false;
    } finally { if (requestId === requestSequence) { busy = false; render(); } }
  }
  function renderHistory(records) {
    if (!historyNode) return;
    historyNode.replaceChildren();
    if (!records.length) {
      const item = documentRef.createElement("div");
      item.textContent = t("scheduledTasks.historyEmpty");
      historyNode.append(item);
      return;
    }
    for (const record of records.slice(0, MAX_HISTORY)) {
      const item = documentRef.createElement("div");
      const summaryBits = isRecord(record.summary) && typeof record.summary.repo === "string"
        ? ` · ${clean(record.summary.repo, 512)} · ${String(Number(record.summary.failingCount) || 0)}`
        : isRecord(record.summary) && typeof record.summary.code === "string" ? ` · ${clean(record.summary.code, 64)}` : "";
      item.textContent = `${clean(record.startedAt, 40)} · ${record.ok ? t("scheduledTasks.ok") : t("scheduledTasks.failed")}`
        + ` · ${t(`scheduledTasks.trigger.${record.trigger || "schedule"}`)}${summaryBits}`;
      historyNode.append(item);
    }
  }
  function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
  async function loadHistory(id) {
    if (typeof fetcher !== "function" || busy) return false;
    const requestId = ++requestSequence;
    selectedId = id;
    try {
      const response = await fetcher(`/api/schedules/${encodeURIComponent(id)}/runs`);
      const payload = await response.json().catch(() => ({}));
      if (requestId !== requestSequence || selectedId !== id) return false;
      if (!response.ok || payload?.id !== id || !Array.isArray(payload?.runs)) {
        renderHistory([]); return false;
      }
      renderHistory(payload.runs);
      return true;
    } catch { return false; }
  }
  refreshButton?.addEventListener("click", () => { void refresh(); });
  form?.addEventListener("submit", (event) => { event.preventDefault(); void create(); });
  render();
  return { refresh, render, create, runNow, remove, toggle, loadHistory, getSchedules: () => schedules };
}
