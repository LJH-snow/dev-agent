const STATUSES = new Set(["idle", "running", "waiting", "done", "failed", "aborted"]);
const STAGES = new Set(["idle", "model", "tool", "approval", "done", "failed", "aborted"]);
const MAX_SESSIONS = 256;
const MAX_ID_LENGTH = 96;
const MAX_TITLE_LENGTH = 96;
const MAX_TOOL_LENGTH = 128;

export function createExecutionCenterUI(options = {}) {
  const documentRef = options.documentRef ?? document;
  const fetcher = options.fetcher ?? fetch;
  const translate = typeof options.translate === "function" ? options.translate : (key) => key;
  const activateSession = typeof options.activateSession === "function"
    ? options.activateSession
    : () => undefined;
  const status = documentRef.getElementById("execution-center-status");
  const runtime = documentRef.getElementById("execution-center-runtime");
  const summary = documentRef.getElementById("execution-center-summary");
  const list = documentRef.getElementById("execution-center-list");
  const refreshButton = documentRef.getElementById("execution-center-refresh");
  const historyPanel = documentRef.getElementById("execution-center-history");
  const historyStatus = documentRef.getElementById("execution-center-history-status");
  const historyList = documentRef.getElementById("execution-center-history-list");
  const detailPanel = documentRef.getElementById("execution-center-detail");
  const detailTitle = documentRef.getElementById("execution-center-detail-title");
  const detailStatus = documentRef.getElementById("execution-center-detail-status");
  const detailMeta = documentRef.getElementById("execution-center-detail-meta");
  const detailStopButton = documentRef.getElementById("execution-center-stop");
  const detailTraceButton = documentRef.getElementById("execution-center-trace");
  const detailValidationButton = documentRef.getElementById("execution-center-validation");
  const detailAutofixButton = documentRef.getElementById("execution-center-autofix");
  const stopSession = typeof options.stopSession === "function" ? options.stopSession : () => undefined;
  const openTrace = typeof options.openTrace === "function" ? options.openTrace : () => undefined;
  const openValidation = typeof options.openValidation === "function" ? options.openValidation : () => undefined;
  const startAutofix = typeof options.startAutofix === "function" ? options.startAutofix : () => undefined;

  let executionCenterRequestId = 0;
  let executionCenterController = null;
  let selectedSessionId = null;
  let latestPayload = null;

  if (!status || !runtime || !summary || !list || !refreshButton) {
    return {
      refresh: async () => undefined,
      render: () => undefined,
      destroy: () => undefined,
    };
  }

  function render(rawPayload) {
    const payload = normalizeSnapshot(rawPayload);
    latestPayload = payload;
    if (!payload.sessions.some((session) => session.sessionId === selectedSessionId)) {
      selectedSessionId = payload.currentSessionId && payload.sessions.some((session) => session.sessionId === payload.currentSessionId)
        ? payload.currentSessionId
        : payload.sessions[0]?.sessionId ?? null;
    }
    status.textContent = payload.total === 0
      ? translate("executionCenter.empty")
      : translate("executionCenter.ready", {
        active: payload.active,
        waiting: payload.waiting,
        failed: payload.failed,
      });
    runtime.textContent = formatRuntime(payload.runtime);
    summary.textContent = translate("executionCenter.summary", {
      total: payload.total,
      completed: payload.completed,
      aborted: payload.aborted,
    });
    list.replaceChildren();

    if (payload.sessions.length === 0) {
      const empty = documentRef.createElement("li");
      empty.className = "parallel-run-card";
      empty.textContent = translate("executionCenter.empty");
      list.appendChild(empty);
      renderDetail(payload);
      renderHistory(payload);
      return;
    }

    for (const session of payload.sessions) {
      const item = documentRef.createElement("li");
      item.className = "parallel-run-card";
      item.dataset.status = session.status;
      item.dataset.active = session.active ? "true" : "false";
      if (session.sessionId === payload.currentSessionId) item.dataset.current = "true";

      const header = documentRef.createElement("div");
      header.className = "parallel-run-card-header";
      const focus = documentRef.createElement("button");
      focus.type = "button";
      focus.className = "parallel-run-focus";
      focus.dataset.executionCenterSessionId = session.sessionId;
      focus.title = translate("executionCenter.focus");
      focus.textContent = session.title;
      const statusLabel = documentRef.createElement("span");
      statusLabel.className = "parallel-run-status";
      statusLabel.textContent = translate("parallelRuns.status." + session.status);
      header.append(focus, statusLabel);

      const meta = documentRef.createElement("div");
      meta.className = "parallel-run-meta";
      const detail = [
        translate("parallelRuns.stage." + session.stage),
        session.tool ? translate("parallelRuns.tool", { name: session.tool.name }) : "",
        session.approvalPending ? translate("executionCenter.approval") : "",
        formatDuration(session.durationMs),
      ].filter(Boolean);
      meta.textContent = detail.join(" · ");
      item.append(header, meta);
      list.appendChild(item);
    }
    renderDetail(payload);
    renderHistory(payload);
  }

  function renderDetail(payload) {
    if (!detailPanel) return;
    const session = payload.sessions.find((item) => item.sessionId === selectedSessionId);
    if (!session) {
      detailPanel.hidden = true;
      return;
    }
    detailPanel.hidden = false;
    if (detailTitle) detailTitle.textContent = session.title;
    if (detailStatus) detailStatus.textContent = translate("parallelRuns.status." + session.status);
    if (detailMeta) {
      detailMeta.textContent = [
        translate("parallelRuns.stage." + session.stage),
        session.tool ? translate("parallelRuns.tool", { name: session.tool.name }) : "",
        session.approvalPending ? translate("executionCenter.approval") : "",
        formatDuration(session.durationMs),
      ].filter(Boolean).join(" · ");
    }
    if (detailStopButton) detailStopButton.disabled = !session.active;
    if (detailTraceButton) detailTraceButton.disabled = false;
    if (detailValidationButton) detailValidationButton.disabled = false;
    const validationResult = payload.currentSessionId === session.sessionId
      ? payload.runtime?.validation?.lastResult
      : undefined;
    if (detailAutofixButton) {
      detailAutofixButton.disabled = !["failed", "blocked"].includes(validationResult);
    }
  }

  function renderHistory(payload) {
    if (!historyPanel || !historyList) return;
    historyPanel.hidden = payload.history.length === 0;
    historyList.replaceChildren();
    if (historyStatus) {
      historyStatus.textContent = payload.history.length === 0
        ? translate("executionCenter.history.empty")
        : translate("executionCenter.history.count", { count: payload.history.length });
    }
    for (const record of payload.history) {
      const item = documentRef.createElement("li");
      item.className = "parallel-run-card execution-center-history-card";
      item.dataset.status = record.status;
      const heading = documentRef.createElement("div");
      heading.className = "parallel-run-card-header";
      const runId = documentRef.createElement("span");
      runId.className = "parallel-run-focus";
      runId.textContent = record.runId;
      const state = documentRef.createElement("span");
      state.className = "parallel-run-status";
      state.textContent = translate("parallelRuns.status." + record.status);
      heading.append(runId, state);
      const meta = documentRef.createElement("div");
      meta.className = "parallel-run-meta";
      meta.textContent = [
        formatDuration(record.durationMs),
        translate("executionCenter.history.tools", { count: record.toolCount }),
        translate("executionCenter.history.validations", { count: record.validationCount }),
      ].join(" · ");
      item.append(heading, meta);
      historyList.appendChild(item);
    }
  }

  async function refresh(historySessionId = selectedSessionId) {
    const requestId = ++executionCenterRequestId;
    executionCenterController?.abort();
    const controller = new AbortController();
    executionCenterController = controller;
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    status.textContent = translate("executionCenter.checking");
    try {
      const query = typeof historySessionId === "string" && historySessionId
        ? "?historySessionId=" + encodeURIComponent(historySessionId)
        : "";
      const response = await fetcher("/api/execution-center" + query, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("execution-center request failed");
      const payload = await response.json();
      if (requestId !== executionCenterRequestId) return;
      render(payload);
    } catch (error) {
      if (controller.signal.aborted || requestId !== executionCenterRequestId) return;
      list.replaceChildren();
      summary.textContent = "";
      runtime.textContent = "";
      historyPanel?.setAttribute("hidden", "true");
      historyList?.replaceChildren();
      status.textContent = translate("executionCenter.error");
    } finally {
      if (requestId === executionCenterRequestId) {
        executionCenterController = null;
        refreshButton.disabled = false;
        refreshButton.setAttribute("aria-busy", "false");
      }
    }
  }

  function destroy() {
    executionCenterController?.abort();
    executionCenterController = null;
  }

  list.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("[data-execution-center-session-id]")
      : null;
    const sessionId = target?.getAttribute("data-execution-center-session-id");
    if (sessionId) {
      selectedSessionId = sessionId;
      renderDetail(latestPayload ?? normalizeSnapshot({}));
      void activateSession(sessionId);
      void refresh(sessionId);
    }
  });

  detailStopButton?.addEventListener("click", () => {
    if (selectedSessionId) void stopSession(selectedSessionId);
  });
  detailTraceButton?.addEventListener("click", () => {
    if (selectedSessionId) void openTrace(selectedSessionId);
  });
  detailValidationButton?.addEventListener("click", () => {
    if (selectedSessionId) void openValidation(selectedSessionId);
  });
  detailAutofixButton?.addEventListener("click", () => {
    if (selectedSessionId) void startAutofix(selectedSessionId);
  });

  refreshButton.addEventListener("click", () => void refresh());

  return { refresh, render, destroy };

  function formatDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return "";
    const seconds = Math.max(0, Math.floor(durationMs / 1000));
    if (seconds < 60) return translate("parallelRuns.duration.seconds", { count: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return translate("parallelRuns.duration.minutes", { count: minutes });
    return translate("parallelRuns.duration.hours", { count: Math.floor(minutes / 60) });
  }

  function formatRuntime(value) {
    if (!value || typeof value !== "object") return translate("runtime.unavailable");
    const values = [
      value.executor?.mode,
      value.runtime?.platform,
      value.approval?.mode,
      value.validation?.lastResult,
    ].filter((entry) => typeof entry === "string" && entry);
    return values.join(" · ") || translate("runtime.unavailable");
  }
}

function normalizeSnapshot(value) {
  const raw = isRecord(value) ? value : {};
  const sessions = [];
  const seen = new Set();
  for (const item of Array.isArray(raw.sessions) ? raw.sessions.slice(0, MAX_SESSIONS) : []) {
    const sessionId = normalizeId(item?.sessionId);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const status = STATUSES.has(item.status) ? item.status : "idle";
    const stage = STAGES.has(item.stage) ? item.stage : "idle";
    const tool = normalizeTool(item.tool);
    sessions.push({
      sessionId,
      title: normalizeTitle(item.title, sessionId),
      status,
      active: item.active === true && (status === "running" || status === "waiting"),
      stage,
      approvalPending: item.approvalPending === true || status === "waiting",
      ...(tool ? { tool } : {}),
      durationMs: normalizeDuration(item.durationMs),
    });
  }
  const active = sessions.filter((item) => item.active).length;
  const history = (Array.isArray(raw.history) ? raw.history.slice(0, 50) : [])
    .map(normalizeHistoryRecord)
    .filter((record) => record !== undefined);
  return {
    currentSessionId: normalizeId(raw.currentSessionId),
    historySessionId: normalizeId(raw.historySessionId),
    history,
    runtime: isRecord(raw.runtime) ? raw.runtime : undefined,
    total: sessions.length,
    active,
    waiting: sessions.filter((item) => item.status === "waiting").length,
    failed: sessions.filter((item) => item.status === "failed").length,
    completed: sessions.filter((item) => item.status === "done").length,
    aborted: sessions.filter((item) => item.status === "aborted").length,
    sessions,
  };
}

function normalizeHistoryRecord(value) {
  if (!isRecord(value)) return undefined;
  const sessionId = normalizeId(value.sessionId);
  const runId = normalizeId(value.runId);
  if (!sessionId || !runId || !["done", "failed", "aborted"].includes(value.status)) return undefined;
  return {
    sessionId,
    runId,
    status: value.status,
    durationMs: normalizeDuration(value.durationMs) ?? 0,
    toolCount: normalizeCount(value.toolCount),
    validationCount: normalizeCount(value.validationCount),
  };
}

function normalizeCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(1_000_000, Math.max(0, value))
    : 0;
}

function normalizeTool(value) {
  if (!isRecord(value)) return undefined;
  const name = normalizeId(value.name, MAX_TOOL_LENGTH);
  if (!name) return undefined;
  return { name };
}

function normalizeId(value, maxLength = MAX_ID_LENGTH) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (!normalized || normalized.length > maxLength || normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) return undefined;
  return normalized;
}

function normalizeTitle(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  return normalized ? normalized.slice(0, MAX_TITLE_LENGTH) : fallback;
}

function normalizeDuration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, 7 * 24 * 60 * 60 * 1000)
    : undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
