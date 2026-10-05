const MAX_ID_LENGTH = 96;
const MAX_HISTORY_ROWS = 20;
const SCAN_STATUSES = new Set(["clean", "findings", "partial"]);

export function createSecurityCenterUI(options = {}) {
  const documentRef = options.documentRef ?? document;
  const fetcher = options.fetcher ?? fetch;
  const translate = typeof options.translate === "function" ? options.translate : (key) => key;
  const status = documentRef.getElementById("security-center-status");
  const summary = documentRef.getElementById("security-center-summary");
  const list = documentRef.getElementById("security-center-list");
  const refreshButton = documentRef.getElementById("security-center-refresh");
  const scanButton = documentRef.getElementById("security-center-run-scan");
  const clearButton = documentRef.getElementById("security-center-clear");
  const clearStatus = documentRef.getElementById("security-center-clear-status");
  const sessionSelect = documentRef.getElementById("security-center-session");
  const findingsPanel = documentRef.getElementById("security-center-findings");
  const findingsTitle = documentRef.getElementById("security-center-findings-title");
  const findingsList = documentRef.getElementById("security-center-findings-list");
  let requestId = 0;

  const scanRecordFromSnapshot = (value) => {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value;
    const scanId = typeof record.scanId === "string" ? record.scanId.slice(0, MAX_ID_LENGTH) : "";
    if (!scanId) return undefined;
    return {
      scanId,
      status: SCAN_STATUSES.has(record.status) || record.status === "error" ? record.status : "error",
      startedAt: typeof record.startedAt === "string" ? record.startedAt : "",
      durationMs: typeof record.durationMs === "number" && Number.isFinite(record.durationMs) ? record.durationMs : 0,
      filesScanned: Number.isSafeInteger(record.filesScanned) ? record.filesScanned : 0,
      bytesScanned: Number.isSafeInteger(record.bytesScanned) ? record.bytesScanned : 0,
      skippedEntries: Number.isSafeInteger(record.skippedEntries) ? record.skippedEntries : 0,
      findingCount: Number.isSafeInteger(record.findingCount) ? record.findingCount : 0,
      severityCounts: normalizeCounts(record.severityCounts),
      categoryCounts: normalizeCounts(record.categoryCounts),
    };
  };

  function normalizeCounts(value) {
    const source = typeof value === "object" && value !== null ? value : {};
    const counts = {};
    for (const key of Object.keys(source)) {
      const numberValue = source[key];
      if (Number.isSafeInteger(numberValue) && numberValue >= 0) counts[key] = numberValue;
    }
    return counts;
  }

  const formatBytes = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
  };

  const renderHistory = (records) => {
    if (!list) return;
    list.replaceChildren();
    for (const record of records) {
      const item = documentRef.createElement("li");
      item.className = "security-center-record";
      item.dataset.status = record.status;

      const head = documentRef.createElement("div");
      head.className = "security-center-record-head";
      const id = documentRef.createElement("strong");
      id.textContent = record.scanId;
      const badge = documentRef.createElement("span");
      badge.className = "execution-center-detail-status";
      badge.textContent = record.status;
      head.append(id, badge);

      const meta = documentRef.createElement("div");
      meta.className = "security-center-record-meta";
      const severityText = ["high", "medium", "low"]
        .filter((key) => record.severityCounts[key])
        .map((key) => `${key} ${record.severityCounts[key]}`)
        .join(" · ");
      const parts = [
        record.startedAt,
        `${record.durationMs}ms`,
        `${record.filesScanned} ${translate("securityCenter.files")}`,
        formatBytes(record.bytesScanned),
        `${record.findingCount} ${translate("securityCenter.findings")}`,
      ];
      if (severityText) parts.push(severityText);
      meta.textContent = parts.filter((part) => part).join(" · ");

      item.append(head, meta);
      list.append(item);
    }
  };

  const renderFindings = (scan) => {
    if (!findingsPanel || !findingsTitle || !findingsList) return;
    const findings = Array.isArray(scan?.findings) ? scan.findings : [];
    findingsPanel.hidden = false;
    findingsTitle.textContent = translate("securityCenter.findingsTitle");
    findingsList.replaceChildren();
    if (findings.length === 0) {
      const empty = documentRef.createElement("li");
      empty.className = "security-center-finding";
      empty.textContent = translate("securityCenter.noFindings");
      findingsList.append(empty);
      return;
    }
    for (const finding of findings.slice(0, 32)) {
      if (typeof finding !== "object" || finding === null) continue;
      const item = documentRef.createElement("li");
      item.className = "security-center-finding";
      const badge = documentRef.createElement("span");
      badge.className = "security-center-finding-severity";
      badge.textContent = `${finding.severity ?? "?"} · ${finding.category ?? "?"}`;
      const text = documentRef.createElement("span");
      const location = typeof finding.location === "string" ? finding.location : "";
      const summaryText = typeof finding.summary === "string" ? finding.summary : "";
      text.textContent = location ? `${location} — ${summaryText}` : summaryText;
      item.append(badge, text);
      findingsList.append(item);
    }
  };

  /**
   * Loads the bounded session list for the scan-scope picker. Only session
   * ids are read from the response; previews and other content-derived
   * fields are ignored.
   */
  const loadSessions = async () => {
    if (!sessionSelect) return;
    const selected = sessionSelect.value;
    const response = await fetcher("/api/sessions", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const ids = Array.isArray(payload?.sessions)
      ? payload.sessions
        .map((summary) => (typeof summary?.sessionId === "string" ? summary.sessionId : ""))
        .filter((id) => id && id.length <= MAX_ID_LENGTH)
        .slice(0, 256)
      : [];
    const defaultOption = documentRef.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = translate("securityCenter.sessionDefault");
    sessionSelect.replaceChildren(defaultOption);
    for (const id of ids) {
      const option = documentRef.createElement("option");
      option.value = id;
      option.textContent = id;
      sessionSelect.append(option);
    }
    if (selected && ids.includes(selected)) sessionSelect.value = selected;
  };

  const refresh = async () => {
    const currentRequest = ++requestId;
    if (status) status.textContent = translate("securityCenter.loading");
    try {
      await loadSessions();
      const response = await fetcher("/api/security-center", { cache: "no-store" });
      if (currentRequest !== requestId) return;
      if (!response.ok) throw new Error("security center unavailable");
      const payload = await response.json();
      const records = Array.isArray(payload?.history)
        ? payload.history.map(scanRecordFromSnapshot).filter((record) => record !== undefined)
        : [];
      renderHistory(records);
      if (status) status.textContent = "";
      if (summary) {
        summary.textContent = records.length === 0
          ? translate("securityCenter.empty")
          : translate("securityCenter.summary", { count: String(records.length) });
      }
    } catch {
      if (currentRequest !== requestId) return;
      if (list) list.replaceChildren();
      if (summary) summary.textContent = "";
      if (status) status.textContent = translate("securityCenter.error");
    }
  };

  const runScan = async () => {
    const currentRequest = ++requestId;
    if (scanButton) scanButton.disabled = true;
    if (status) status.textContent = translate("securityCenter.scanning");
    try {
      const selectedSession = sessionSelect && typeof sessionSelect.value === "string" ? sessionSelect.value : "";
      const response = await fetcher("/api/security-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selectedSession ? { sessionId: selectedSession } : {}),
        cache: "no-store",
      });
      if (currentRequest !== requestId) return;
      if (!response.ok) throw new Error("security scan failed");
      const scan = await response.json();
      renderFindings(scan);
      if (status) {
        status.textContent = SCAN_STATUSES.has(scan?.status)
          ? translate("securityCenter.scanDone", {
            status: String(scan.status),
            files: String(scan.filesScanned ?? 0),
            findings: String(scan.record?.findingCount ?? 0),
          })
          : translate("securityCenter.scanError");
      }
      await refresh();
    } catch {
      if (currentRequest !== requestId) return;
      if (status) status.textContent = translate("securityCenter.error");
    } finally {
      if (currentRequest === requestId && scanButton) scanButton.disabled = false;
    }
  };

  const clearHistory = async () => {
    if (clearButton) clearButton.disabled = true;
    if (clearStatus) clearStatus.textContent = "";
    try {
      const response = await fetcher("/api/security-center", {
        method: "DELETE",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("security history clear failed");
      if (clearStatus) clearStatus.textContent = translate("securityCenter.cleared");
      await refresh();
    } catch {
      if (clearStatus) clearStatus.textContent = translate("securityCenter.error");
    } finally {
      if (clearButton) clearButton.disabled = false;
    }
  };

  refreshButton?.addEventListener("click", () => { void refresh(); });
  scanButton?.addEventListener("click", () => { void runScan(); });
  clearButton?.addEventListener("click", () => {
    if (documentRef.defaultView?.confirm(translate("securityCenter.clearConfirm"))) {
      void clearHistory();
    }
  });

  return { refresh, runScan, clearHistory };
}
