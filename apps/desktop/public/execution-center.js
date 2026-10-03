import { createExecutionNotificationStore } from "./execution-notifications.js";
import { readExecutionHistoryFilters, writeExecutionHistoryFilters } from "./execution-history-filters.js";

const STATUSES = new Set(["idle", "running", "waiting", "done", "failed", "aborted"]);
const STAGES = new Set(["idle", "model", "tool", "approval", "done", "failed", "aborted"]);
const MAX_SESSIONS = 256;
const MAX_ID_LENGTH = 96;
const MAX_TITLE_LENGTH = 96;
const MAX_TOOL_LENGTH = 128;
const MAX_HISTORY_EXPORT_RECORDS = 50;
const MAX_HISTORY_EXPORT_CHARS = 64 * 1024;
const HISTORY_PAGE_SIZE = 20;

export function buildExecutionHistoryExport(records, format = "json") {
  const candidates = (Array.isArray(records) ? records : [])
    .slice(0, MAX_HISTORY_EXPORT_RECORDS)
    .map(normalizeHistoryRecord)
    .filter((record) => record !== undefined)
    .map(toHistoryExportRecord);
  const truncatedByCount = Array.isArray(records) && records.length > candidates.length;
  const selected = fitHistoryExportRecords(candidates, format === "markdown" ? "markdown" : "json", truncatedByCount);
  return format === "markdown"
    ? renderHistoryExportMarkdown(selected.records, selected.truncated)
    : JSON.stringify({
      schemaVersion: 1,
      records: selected.records,
      ...(selected.truncated ? { truncated: true } : {}),
    }, null, 2);
}

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
  const historyUnread = documentRef.getElementById("execution-center-history-unread");
  const historyMarkReadButton = documentRef.getElementById("execution-center-history-mark-read");
  const historyExportFormat = documentRef.getElementById("execution-center-history-export-format");
  const historyExportButton = documentRef.getElementById("execution-center-history-export");
  const historyExportStatus = documentRef.getElementById("execution-center-history-export-status");
  const historyLoadMoreButton = documentRef.getElementById("execution-center-history-load-more");
  const historySearch = documentRef.getElementById("execution-center-history-search");
  const historyStatusFilter = documentRef.getElementById("execution-center-history-status-filter");
  const historyValidationFilter = documentRef.getElementById("execution-center-history-validation-filter");
  const historyDetailPanel = documentRef.getElementById("execution-center-history-detail");
  const historyDetailTitle = documentRef.getElementById("execution-center-history-detail-title");
  const historyDetailStatus = documentRef.getElementById("execution-center-history-detail-status");
  const historyDetailMeta = documentRef.getElementById("execution-center-history-detail-meta");
  const historyCopyButton = documentRef.getElementById("execution-center-history-copy");
  const historyCopyStatus = documentRef.getElementById("execution-center-history-copy-status");
  const historyComparisonPanel = documentRef.getElementById("execution-center-history-comparison");
  const historyComparisonCurrentId = documentRef.getElementById("execution-center-history-comparison-current-id");
  const historyComparisonCurrentMeta = documentRef.getElementById("execution-center-history-comparison-current-meta");
  const historyComparisonPreviousId = documentRef.getElementById("execution-center-history-comparison-previous-id");
  const historyComparisonPreviousMeta = documentRef.getElementById("execution-center-history-comparison-previous-meta");
  const historyComparisonDeltas = documentRef.getElementById("execution-center-history-comparison-deltas");
  const historyValidationButton = documentRef.getElementById("execution-center-history-validation");
  const historyChangeSetButton = documentRef.getElementById("execution-center-history-change-set");
  const filterStorage = options.filterStorage ?? getHistoryFilterStorage();
  const persistedFilters = readExecutionHistoryFilters(filterStorage);
  if (historySearch) historySearch.value = persistedFilters.search;
  if (historyStatusFilter) historyStatusFilter.value = persistedFilters.status;
  if (historyValidationFilter) historyValidationFilter.value = persistedFilters.validation;
  if (historyExportFormat) historyExportFormat.value = persistedFilters.format;
  const detailPanel = documentRef.getElementById("execution-center-detail");
  const detailTitle = documentRef.getElementById("execution-center-detail-title");
  const detailStatus = documentRef.getElementById("execution-center-detail-status");
  const detailMeta = documentRef.getElementById("execution-center-detail-meta");
  const detailStopButton = documentRef.getElementById("execution-center-stop");
  const detailTraceButton = documentRef.getElementById("execution-center-trace");
  const detailValidationButton = documentRef.getElementById("execution-center-validation");
  const detailAutofixButton = documentRef.getElementById("execution-center-autofix");
  const stopSession = typeof options.stopSession === "function" ? options.stopSession : () => undefined;
  const canCopyHistory = typeof options.copyText === "function";
  const copyText = canCopyHistory ? options.copyText : async () => false;
  const canDownloadHistory = typeof options.downloadFile === "function"
    || typeof documentRef.createElement === "function";
  const downloadFile = typeof options.downloadFile === "function"
    ? options.downloadFile
    : (filename, content, mimeType) => downloadHistoryFile(documentRef, filename, content, mimeType);
  const openTrace = typeof options.openTrace === "function" ? options.openTrace : () => undefined;
  const openValidation = typeof options.openValidation === "function" ? options.openValidation : () => undefined;
  const startAutofix = typeof options.startAutofix === "function" ? options.startAutofix : () => undefined;

  let executionCenterRequestId = 0;
  let executionCenterController = null;
  let selectedSessionId = null;
  let selectedHistoryRunId = null;
  let latestPayload = null;
  let visibleHistoryRecords = [];
  let historyVisibleLimit = HISTORY_PAGE_SIZE;
  const historyNotifications = createExecutionNotificationStore();
  const initializedHistorySessions = new Set();
  const openValidationEvidence = typeof options.openValidationEvidence === "function"
    ? options.openValidationEvidence
    : () => undefined;
  const openChangeSetEvidence = typeof options.openChangeSetEvidence === "function"
    ? options.openChangeSetEvidence
    : () => undefined;

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
    syncHistoryNotifications(payload);
    historyPanel.hidden = payload.history.length === 0;
    const searchTerm = typeof historySearch?.value === "string"
      ? historySearch.value.trim().toLowerCase()
      : "";
    const statusFilter = ["done", "failed", "aborted"].includes(historyStatusFilter?.value)
      ? historyStatusFilter.value
      : "all";
    const validationFilter = ["passed", "failed", "skipped", "blocked"].includes(historyValidationFilter?.value)
      ? historyValidationFilter.value
      : historyValidationFilter?.value === "none"
        ? "none"
        : "all";
    const matchingHistory = payload.history.filter((record) => (
      (!searchTerm || record.runId.toLowerCase().includes(searchTerm))
      && (statusFilter === "all" || record.status === statusFilter)
      && (validationFilter === "all"
        || (validationFilter === "none" ? !record.validationStatus : record.validationStatus === validationFilter))
    ));
    visibleHistoryRecords = matchingHistory;
    const renderedHistory = matchingHistory.slice(0, historyVisibleLimit);
    if (!renderedHistory.some((record) => record.runId === selectedHistoryRunId)) {
      selectedHistoryRunId = null;
    }
    historyList.replaceChildren();
    if (historyStatus) {
      historyStatus.textContent = payload.history.length === 0
        ? translate("executionCenter.history.empty")
        : matchingHistory.length === 0
          ? translate("executionCenter.history.noMatches")
          : translate("executionCenter.history.count", { count: matchingHistory.length });
    }
    if (payload.history.length === 0 && historyExportStatus) historyExportStatus.textContent = "";
    const notificationSessionId = payload.historySessionId ?? payload.currentSessionId;
    const unreadCount = historyNotifications.unreadCount(notificationSessionId);
    if (historyUnread) {
      historyUnread.hidden = unreadCount === 0;
      historyUnread.textContent = unreadCount > 0
        ? translate("executionCenter.history.unread", { count: unreadCount })
        : "";
    }
    if (historyMarkReadButton) historyMarkReadButton.disabled = unreadCount === 0;
    if (historyExportButton) historyExportButton.disabled = !canDownloadHistory || matchingHistory.length === 0;
    if (historyLoadMoreButton) {
      historyLoadMoreButton.hidden = renderedHistory.length >= matchingHistory.length;
      historyLoadMoreButton.disabled = renderedHistory.length >= matchingHistory.length;
    }
    for (const record of renderedHistory) {
      const item = documentRef.createElement("li");
      item.className = "parallel-run-card execution-center-history-card";
      item.dataset.status = record.status;
      const heading = documentRef.createElement("div");
      heading.className = "parallel-run-card-header";
      const runId = documentRef.createElement("button");
      runId.type = "button";
      runId.className = "parallel-run-focus";
      runId.dataset.executionHistoryRunId = record.runId;
      runId.setAttribute("aria-pressed", String(record.runId === selectedHistoryRunId));
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
    renderHistoryDetail(payload, renderedHistory);
  }

  function syncHistoryNotifications(payload) {
    const knownSessionIds = new Set(payload.sessions.map((session) => session.sessionId));
    for (const notification of historyNotifications.list()) {
      if (!knownSessionIds.has(notification.sessionId)) {
        historyNotifications.clearSession(notification.sessionId);
        initializedHistorySessions.delete(notification.sessionId);
      }
    }
    const historySessionId = payload.historySessionId ?? payload.currentSessionId;
    if (!historySessionId) return;
    if (!initializedHistorySessions.has(historySessionId)) {
      for (const record of payload.history) recordHistoryNotification(record);
      historyNotifications.markAllRead(historySessionId);
      initializedHistorySessions.add(historySessionId);
      return;
    }
    for (const record of payload.history) {
      recordHistoryNotification(record);
    }
  }

  function recordHistoryNotification(record) {
    historyNotifications.record({
      sessionId: record.sessionId,
      runId: record.runId,
      status: record.status,
      finishedAt: record.finishedAt,
    });
  }

  function renderHistoryDetail(payload, visibleHistory = payload.history) {
    if (!historyDetailPanel) return;
    const selectedIndex = visibleHistory.findIndex((item) => item.runId === selectedHistoryRunId);
    const record = selectedIndex < 0 ? undefined : visibleHistory[selectedIndex];
    const previousRecord = selectedIndex < 0 ? undefined : visibleHistory[selectedIndex + 1];
    historyDetailPanel.hidden = record === undefined;
    if (historyComparisonPanel) historyComparisonPanel.hidden = previousRecord === undefined;
    if (!record) {
      if (historyDetailTitle) historyDetailTitle.textContent = "";
      if (historyDetailStatus) historyDetailStatus.textContent = "";
      if (historyDetailMeta) historyDetailMeta.textContent = "";
      if (historyCopyButton) historyCopyButton.disabled = true;
      if (historyCopyStatus) historyCopyStatus.textContent = "";
      if (historyComparisonCurrentId) historyComparisonCurrentId.textContent = "";
      if (historyComparisonCurrentMeta) historyComparisonCurrentMeta.textContent = "";
      if (historyComparisonPreviousId) historyComparisonPreviousId.textContent = "";
      if (historyComparisonPreviousMeta) historyComparisonPreviousMeta.textContent = "";
      if (historyComparisonDeltas) historyComparisonDeltas.textContent = "";
      if (historyValidationButton) historyValidationButton.disabled = true;
      if (historyChangeSetButton) historyChangeSetButton.disabled = true;
      return;
    }
    if (historyDetailTitle) historyDetailTitle.textContent = record.runId;
    if (historyDetailStatus) {
      historyDetailStatus.textContent = record.validationStatus
        ? translate("parallelRuns.status." + record.status) + " · " + translate("validation.status." + record.validationStatus)
        : translate("parallelRuns.status." + record.status);
    }
    if (historyDetailMeta) {
      historyDetailMeta.textContent = [
        formatHistoryTime(record.startedAt),
        formatDuration(record.durationMs),
        translate("executionCenter.history.tools", { count: record.toolCount }),
        translate("executionCenter.history.approvals", { count: record.approvalCount }),
        translate("executionCenter.history.validations", { count: record.validationCount }),
      ].filter(Boolean).join(" · ");
    }
    if (historyValidationButton) {
      historyValidationButton.disabled = !record.validationId && !(record.changeSetId && record.validationStatus);
    }
    if (historyChangeSetButton) historyChangeSetButton.disabled = !record.changeSetId;
    if (historyCopyButton) historyCopyButton.disabled = !canCopyHistory;
    if (historyCopyStatus) historyCopyStatus.textContent = "";
    if (previousRecord) {
      if (historyComparisonCurrentId) historyComparisonCurrentId.textContent = record.runId;
      if (historyComparisonCurrentMeta) historyComparisonCurrentMeta.textContent = formatHistoryComparisonMeta(record);
      if (historyComparisonPreviousId) historyComparisonPreviousId.textContent = previousRecord.runId;
      if (historyComparisonPreviousMeta) historyComparisonPreviousMeta.textContent = formatHistoryComparisonMeta(previousRecord);
      if (historyComparisonDeltas) {
        historyComparisonDeltas.textContent = translate("executionCenter.history.comparisonDeltas", {
          durationMs: formatSignedDelta(record.durationMs - previousRecord.durationMs) + " ms",
          tools: formatSignedDelta(record.toolCount - previousRecord.toolCount),
          approvals: formatSignedDelta(record.approvalCount - previousRecord.approvalCount),
          validations: formatSignedDelta(record.validationCount - previousRecord.validationCount),
        });
      }
    } else {
      if (historyComparisonCurrentId) historyComparisonCurrentId.textContent = "";
      if (historyComparisonCurrentMeta) historyComparisonCurrentMeta.textContent = "";
      if (historyComparisonPreviousId) historyComparisonPreviousId.textContent = "";
      if (historyComparisonPreviousMeta) historyComparisonPreviousMeta.textContent = "";
      if (historyComparisonDeltas) historyComparisonDeltas.textContent = "";
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

  historyList?.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("[data-execution-history-run-id]")
      : null;
    const runId = target?.getAttribute("data-execution-history-run-id");
    if (!runId || !latestPayload) return;
    selectedHistoryRunId = runId;
    const record = latestPayload.history.find((item) => item.runId === runId);
    if (record) historyNotifications.markRead(record.sessionId, record.runId);
    renderHistory(latestPayload);
  });

  historySearch?.addEventListener("input", () => {
    persistHistoryFilters();
    historyVisibleLimit = HISTORY_PAGE_SIZE;
    if (latestPayload) renderHistory(latestPayload);
  });

  historyStatusFilter?.addEventListener("change", () => {
    persistHistoryFilters();
    historyVisibleLimit = HISTORY_PAGE_SIZE;
    if (latestPayload) renderHistory(latestPayload);
  });

  historyValidationFilter?.addEventListener("change", () => {
    persistHistoryFilters();
    historyVisibleLimit = HISTORY_PAGE_SIZE;
    if (latestPayload) renderHistory(latestPayload);
  });

  historyExportFormat?.addEventListener("change", () => {
    persistHistoryFilters();
  });

  historyLoadMoreButton?.addEventListener("click", () => {
    historyVisibleLimit += HISTORY_PAGE_SIZE;
    if (latestPayload) renderHistory(latestPayload);
  });

  historyMarkReadButton?.addEventListener("click", () => {
    const sessionId = latestPayload?.historySessionId ?? latestPayload?.currentSessionId;
    historyNotifications.markAllRead(sessionId);
    if (latestPayload) renderHistory(latestPayload);
  });

  historyExportButton?.addEventListener("click", async () => {
    if (!canDownloadHistory || visibleHistoryRecords.length === 0) return;
    const format = historyExportFormat?.value === "markdown" ? "markdown" : "json";
    const content = buildExecutionHistoryExport(visibleHistoryRecords, format);
    const filename = format === "markdown" ? "execution-history.md" : "execution-history.json";
    const mimeType = format === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8";
    try {
      const result = await downloadFile(filename, content, mimeType);
      if (historyExportStatus) {
        historyExportStatus.textContent = translate(
          result === false ? "executionCenter.history.exportFailure" : "executionCenter.history.exportSuccess",
        );
      }
    } catch {
      if (historyExportStatus) historyExportStatus.textContent = translate("executionCenter.history.exportFailure");
    }
  });

  historyValidationButton?.addEventListener("click", () => {
    const record = latestPayload?.history.find((item) => item.runId === selectedHistoryRunId);
    if (record?.validationId || (record?.changeSetId && record.validationStatus)) {
      void openValidationEvidence(record.sessionId, record.validationId, record.changeSetId);
    }
  });

  historyChangeSetButton?.addEventListener("click", () => {
    const record = latestPayload?.history.find((item) => item.runId === selectedHistoryRunId);
    if (record?.changeSetId) void openChangeSetEvidence(record.sessionId, record.changeSetId);
  });

  historyCopyButton?.addEventListener("click", async () => {
    const record = latestPayload?.history.find((item) => item.runId === selectedHistoryRunId);
    if (!record || !canCopyHistory) return;
    try {
      const copied = await copyText(formatHistoryCopySummary(record));
      if (historyCopyStatus) {
        historyCopyStatus.textContent = translate(
          copied ? "executionCenter.history.copySuccess" : "executionCenter.history.copyFailure",
        );
      }
    } catch {
      if (historyCopyStatus) historyCopyStatus.textContent = translate("executionCenter.history.copyFailure");
    }
  });

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

  function formatHistoryTime(value) {
    const time = Date.parse(value ?? "");
    return Number.isFinite(time) ? new Date(time).toLocaleString() : "";
  }

  function persistHistoryFilters() {
    writeExecutionHistoryFilters(filterStorage, {
      search: historySearch?.value ?? "",
      status: historyStatusFilter?.value ?? "all",
      validation: historyValidationFilter?.value ?? "all",
      format: historyExportFormat?.value ?? "json",
    });
  }

  function formatHistoryComparisonMeta(record) {
    return [
      translate("parallelRuns.status." + record.status),
      record.validationStatus
        ? translate("validation.status." + record.validationStatus)
        : translate("executionCenter.history.filterNoValidation"),
      formatDuration(record.durationMs),
      translate("executionCenter.history.tools", { count: record.toolCount }),
      translate("executionCenter.history.approvals", { count: record.approvalCount }),
      translate("executionCenter.history.validations", { count: record.validationCount }),
    ].join(" · ");
  }

  function formatHistoryCopySummary(record) {
    const validationStatus = record.validationStatus
      ? translate("validation.status." + record.validationStatus)
      : translate("executionCenter.history.filterNoValidation");
    return [
      translate("executionCenter.history.summaryRun", { id: record.runId }),
      translate("executionCenter.history.summaryStatus", {
        status: translate("parallelRuns.status." + record.status),
      }),
      translate("executionCenter.history.summaryStarted", {
        time: formatHistoryTime(record.startedAt) || "—",
      }),
      translate("executionCenter.history.summaryDuration", {
        duration: formatDuration(record.durationMs),
      }),
      translate("executionCenter.history.tools", { count: record.toolCount }),
      translate("executionCenter.history.approvals", { count: record.approvalCount }),
      translate("executionCenter.history.validations", { count: record.validationCount }),
      translate("executionCenter.history.summaryValidation", { status: validationStatus }),
    ].join("\n");
  }

  function formatSignedDelta(value) {
    return (value > 0 ? "+" : value < 0 ? "-" : "") + String(Math.abs(value));
  }
}

function getHistoryFilterStorage() {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
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
    startedAt: normalizeTimestamp(value.startedAt),
    finishedAt: normalizeTimestamp(value.finishedAt) ?? normalizeTimestamp(value.startedAt),
    sequence: normalizeSequence(value.sequence),
    durationMs: normalizeDuration(value.durationMs) ?? 0,
    toolCount: normalizeCount(value.toolCount),
    approvalCount: normalizeCount(value.approvalCount),
    validationCount: normalizeCount(value.validationCount),
    ...(normalizeId(value.validationId) === undefined ? {} : { validationId: normalizeId(value.validationId) }),
    ...(normalizeId(value.changeSetId) === undefined ? {} : { changeSetId: normalizeId(value.changeSetId) }),
    ...(["passed", "failed", "skipped", "blocked"].includes(value.validationStatus)
      ? { validationStatus: value.validationStatus }
      : {}),
  };
}

function toHistoryExportRecord(record) {
  return {
    sessionId: record.sessionId,
    runId: record.runId,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: record.durationMs,
    sequence: record.sequence,
    toolCount: record.toolCount,
    approvalCount: record.approvalCount,
    validationCount: record.validationCount,
    ...(record.validationId === undefined ? {} : { validationId: record.validationId }),
    ...(record.changeSetId === undefined ? {} : { changeSetId: record.changeSetId }),
    ...(record.validationStatus === undefined ? {} : { validationStatus: record.validationStatus }),
  };
}

function fitHistoryExportRecords(records, format, truncated) {
  let selected = [...records];
  let wasTruncated = truncated;
  if (selected.length === 0 && !wasTruncated) return { records: [], truncated: false };
  while (selected.length > 0) {
    const candidate = format === "markdown"
      ? renderHistoryExportMarkdown(selected, wasTruncated)
      : JSON.stringify({ schemaVersion: 1, records: selected, ...(wasTruncated ? { truncated: true } : {}) });
    if (candidate.length <= MAX_HISTORY_EXPORT_CHARS) return { records: selected, truncated: wasTruncated };
    selected = selected.slice(0, -1);
    wasTruncated = true;
  }
  return { records: [], truncated: true };
}

function renderHistoryExportMarkdown(records, truncated) {
  const lines = ["# Execution history", "", "Records: " + String(records.length)];
  if (truncated) lines.push("Truncated: true");
  for (const record of records) {
    lines.push(
      "",
      "## " + record.runId,
      "- Session: " + record.sessionId,
      "- Outcome: " + record.status,
      "- Started: " + record.startedAt,
      "- Finished: " + record.finishedAt,
      "- Duration: " + String(record.durationMs) + " ms",
      "- Sequence: " + String(record.sequence),
      "- Tools: " + String(record.toolCount),
      "- Approvals: " + String(record.approvalCount),
      "- Validations: " + String(record.validationCount),
      ...(record.validationId === undefined ? [] : ["- Validation ID: " + record.validationId]),
      ...(record.changeSetId === undefined ? [] : ["- Change-set ID: " + record.changeSetId]),
      ...(record.validationStatus === undefined ? [] : ["- Validation status: " + record.validationStatus]),
    );
  }
  return lines.join("\n");
}

function normalizeTimestamp(value) {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function normalizeCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(1_000_000, Math.max(0, value))
    : 0;
}

function normalizeSequence(value) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(10_000_000, Math.max(0, value))
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

export function buildExecutionHistoryEvidenceUrl(sessionId, filters = {}) {
  const normalizedSessionId = normalizeId(sessionId);
  if (!normalizedSessionId || !isRecord(filters)) return null;

  for (const value of [filters.validationId, filters.changeSetId]) {
    if (value !== undefined && value !== null && value !== "" && !normalizeId(value)) return null;
  }

  const query = new URLSearchParams();
  const validationId = normalizeId(filters.validationId);
  const changeSetId = normalizeId(filters.changeSetId);
  if (validationId) query.set("validationId", validationId);
  if (changeSetId) query.set("changeSetId", changeSetId);

  const suffix = query.toString();
  return "/api/sessions/" + encodeURIComponent(normalizedSessionId) + "/messages"
    + (suffix ? "?" + suffix : "");
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

function downloadHistoryFile(documentRef, filename, content, mimeType) {
  if (typeof Blob !== "function" || typeof URL?.createObjectURL !== "function") return false;
  const anchor = documentRef.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  anchor.href = url;
  anchor.download = filename;
  anchor.setAttribute("aria-hidden", "true");
  documentRef.body?.appendChild(anchor);
  if (typeof anchor.click !== "function") {
    URL.revokeObjectURL(url);
    anchor.remove?.();
    return false;
  }
  anchor.click();
  URL.revokeObjectURL(url);
  anchor.remove?.();
  return true;
}
