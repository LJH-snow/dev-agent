const TASK_VALIDATION_POLL_MS = 750;
const TASK_VALIDATION_FEEDBACK_BYTES = 8 * 1024;

function truncateUtf8(value, maxBytes) {
  const source = String(value ?? "");
  const encoder = new TextEncoder();
  if (encoder.encode(source).byteLength <= maxBytes) return source;
  if (maxBytes <= 0) return "";
  const suffix = "…";
  const suffixBytes = encoder.encode(suffix).byteLength;
  const contentBudget = Math.max(0, maxBytes - suffixBytes);
  let output = "";
  for (const character of source) {
    const candidate = output + character;
    if (encoder.encode(candidate).byteLength > contentBudget) break;
    output = candidate;
  }
  return `${output}${suffix}`;
}

function redactSensitiveText(value) {
  return value
    .replace(/((?:["']?(?:api[-_ ]?key|access[-_ ]?token|authorization|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*)(["']))[^"'\\]*(?:\\.[^"'\\]*)*\2/gi, "$1$2[redacted]$2")
    .replace(/((?:["']?(?:api[-_ ]?key|access[-_ ]?token|authorization|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*))(?!["'])([^"'\s,}\]]+)/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gi, "[redacted-token]");
}

function safeText(value, maxBytes = 768) {
  return truncateUtf8(redactSensitiveText(String(value ?? ""))
    .replace(/\0/g, "�")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim(), maxBytes);
}

export function formatTaskValidationFeedback(snapshot) {
  if (!snapshot || (snapshot.state !== "failed" && snapshot.state !== "blocked")) return "";
  const summary = safeText(snapshot.summary, 512) || "Task validation did not pass.";
  const details = safeText(snapshot.failureSummary, TASK_VALIDATION_FEEDBACK_BYTES);
  const block = [
    "[Task validation failure]",
    summary,
    details,
    "Please inspect the affected task worktree and fix the reported checks.",
  ].filter(Boolean).join("\n");
  return truncateUtf8(block, TASK_VALIDATION_FEEDBACK_BYTES);
}

async function responsePayload(response) {
  try { return await response.json(); } catch { return {}; }
}

export function createTaskValidationUI({
  documentRef = document,
  fetcher = fetch,
  translate,
  getSessionId,
  insertFeedback = () => {},
  onStateChanged = () => {},
}) {
  const panel = documentRef.getElementById("task-validation-panel");
  const statusNode = documentRef.getElementById("task-validation-status");
  const policyNode = documentRef.getElementById("task-validation-policy");
  const summaryNode = documentRef.getElementById("task-validation-summary");
  const checksNode = documentRef.getElementById("task-validation-checks");
  const runButton = documentRef.getElementById("task-validation-run");
  const rerunFailedButton = documentRef.getElementById("task-validation-rerun-failed");
  const cancelButton = documentRef.getElementById("task-validation-cancel");
  const refreshButton = documentRef.getElementById("task-validation-refresh");
  const feedbackButton = documentRef.getElementById("task-validation-feedback");

  let snapshot;
  let available = false;
  let requestSequence = 0;
  let pollTimer;
  let pollInFlight = false;
  let operationInProgress = false;
  let sessionToken = 0;
  let lastStateSignature;

  const stateKeys = {
    idle: "taskValidation.state.idle",
    running: "taskValidation.state.running",
    passed: "taskValidation.state.passed",
    failed: "taskValidation.state.failed",
    skipped: "taskValidation.state.skipped",
    blocked: "taskValidation.state.blocked",
  };
  const checkStateKeys = {
    pending: "taskValidation.check.pending",
    passed: "taskValidation.check.passed",
    failed: "taskValidation.check.failed",
    skipped: "taskValidation.check.skipped",
    blocked: "taskValidation.check.blocked",
  };

  function setStatus(key, values = {}) {
    if (!statusNode) return;
    statusNode.textContent = translate(key, values);
    statusNode.dataset.state = key.includes("error") ? "error" : "info";
  }

  function stateLabel(state) {
    return translate(stateKeys[state] ?? stateKeys.idle);
  }

  function notifyStateChangedIfNeeded() {
    const state = available ? snapshot?.state ?? "idle" : "unavailable";
    const runId = available ? snapshot?.runId ?? "" : "";
    const signature = `${state}:${runId}`;
    if (signature === lastStateSignature) return;
    lastStateSignature = signature;
    try {
      onStateChanged();
    } catch {
      // A workspace refresh is a presentation enhancement; it must not break
      // validation rendering when an integration callback fails.
    }
  }

  function renderChecks() {
    if (!checksNode) return;
    checksNode.replaceChildren();
    const checks = Array.isArray(snapshot?.checks) ? snapshot.checks.slice(0, 256) : [];
    if (checks.length === 0) {
      const empty = documentRef.createElement("li");
      empty.className = "task-validation-empty";
      empty.textContent = translate("taskValidation.checks.empty");
      checksNode.appendChild(empty);
      return;
    }
    for (const check of checks) {
      const item = documentRef.createElement("li");
      item.className = "task-validation-check";
      item.dataset.state = check?.state ?? "pending";
      const heading = documentRef.createElement("div");
      heading.className = "task-validation-check-heading";
      const label = documentRef.createElement("strong");
      label.textContent = safeText(check?.label, 256) || translate("taskValidation.check.unknown");
      const state = documentRef.createElement("span");
      state.textContent = translate(checkStateKeys[check?.state] ?? checkStateKeys.pending);
      heading.append(label, state);
      item.appendChild(heading);
      const meta = documentRef.createElement("div");
      meta.className = "task-validation-check-meta";
      const duration = Number.isFinite(check?.durationMs) ? `${Math.max(0, Math.floor(check.durationMs))} ms` : "—";
      const exitCode = Number.isSafeInteger(check?.exitCode) ? ` · exit ${check.exitCode}` : "";
      meta.textContent = `${duration}${exitCode}`;
      item.appendChild(meta);
      if (check?.reason) {
        const reason = documentRef.createElement("div");
        reason.className = "task-validation-check-reason";
        reason.textContent = safeText(check.reason, 768);
        item.appendChild(reason);
      }
      checksNode.appendChild(item);
    }
  }

  function render() {
    notifyStateChangedIfNeeded();
    if (!panel) return;
    panel.hidden = !available;
    const state = snapshot?.state ?? "idle";
    const hasFailedChecks = Array.isArray(snapshot?.checks)
      && snapshot.checks.some((check) => check?.state === "failed" || check?.state === "blocked");
    panel.dataset.state = state;
    panel.dataset.mode = snapshot?.mode === "failed" ? "failed" : "all";
    if (policyNode) {
      policyNode.textContent = translate(`taskValidation.policy.${snapshot?.policy ?? "unknown"}`);
    }
    if (summaryNode) {
      const summary = safeText(snapshot?.summary, 512) || translate("taskValidation.summary.empty");
      const changedFiles = Number.isSafeInteger(snapshot?.changedFiles) ? snapshot.changedFiles : 0;
      summaryNode.textContent = `${summary} · ${translate("taskValidation.files", { count: changedFiles })}`;
    }
    if (runButton) runButton.disabled = !available || operationInProgress || state === "running";
    if (rerunFailedButton) {
      rerunFailedButton.disabled = !available || operationInProgress || state === "running" || !hasFailedChecks;
    }
    if (cancelButton) cancelButton.disabled = !available || operationInProgress || state !== "running";
    if (refreshButton) refreshButton.disabled = operationInProgress;
    if (feedbackButton) {
      feedbackButton.disabled = !snapshot || !["failed", "blocked"].includes(state) || !snapshot.failureSummary;
    }
    renderChecks();
  }

  function clearPoll() {
    if (pollTimer !== undefined) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  }

  function schedulePoll(token) {
    clearPoll();
    if (snapshot?.state !== "running") return;
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      if (token !== sessionToken) return;
      void refresh();
    }, TASK_VALIDATION_POLL_MS);
  }

  async function refresh() {
    const sessionId = getSessionId();
    const token = sessionToken;
    const requestId = ++requestSequence;
    if (!sessionId) {
      available = false;
      snapshot = undefined;
      clearPoll();
      render();
      return;
    }
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const response = await fetcher(`/api/task-validation?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const payload = await responsePayload(response);
      if (token !== sessionToken || requestId !== requestSequence) return;
      if (!response.ok) {
        if (payload?.code === "task-validation-requires-workspace" || payload?.code === "workspace-cleaned") {
          available = false;
          snapshot = undefined;
          clearPoll();
          render();
          return;
        }
        available = true;
        setStatus("taskValidation.error.generic");
        render();
        return;
      }
      available = true;
      snapshot = payload;
      setStatus(snapshot?.state === "running" ? "taskValidation.status.running" : "taskValidation.status.ready");
      render();
      schedulePoll(token);
    } catch {
      if (token === sessionToken && requestId === requestSequence) {
        available = true;
        setStatus("taskValidation.error.generic");
        render();
      }
    } finally {
      pollInFlight = false;
    }
  }

  async function start(mode = "all") {
    const sessionId = getSessionId();
    if (!sessionId || !available || snapshot?.state === "running" || operationInProgress) return;
    operationInProgress = true;
    clearPoll();
    setStatus("taskValidation.status.starting");
    render();
    try {
      const response = await fetcher("/api/task-validation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, ...(mode === "failed" ? { mode: "failed" } : {}) }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        setStatus("taskValidation.error.generic");
        if (payload?.code === "task-validation-files-truncated") setStatus("taskValidation.error.truncated");
        if (payload?.code === "task-validation-no-failed-checks") setStatus("taskValidation.error.noFailedChecks");
        return;
      }
      snapshot = payload;
      setStatus("taskValidation.status.running");
      render();
      schedulePoll(sessionToken);
    } catch {
      setStatus("taskValidation.error.generic");
    } finally {
      operationInProgress = false;
      render();
    }
  }

  async function cancel() {
    const sessionId = getSessionId();
    if (!sessionId || snapshot?.state !== "running" || operationInProgress) return;
    operationInProgress = true;
    setStatus("taskValidation.status.cancelling");
    render();
    try {
      const response = await fetcher(`/api/task-validation/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      const payload = await responsePayload(response);
      if (response.ok) snapshot = payload;
      else setStatus("taskValidation.error.generic");
    } catch {
      setStatus("taskValidation.error.generic");
    } finally {
      operationInProgress = false;
      render();
      schedulePoll(sessionToken);
    }
  }

  function insertFailure() {
    const feedback = formatTaskValidationFeedback(snapshot);
    if (!feedback) return;
    insertFeedback(feedback);
    setStatus("taskValidation.status.inserted");
  }

  runButton?.addEventListener("click", () => void start());
  rerunFailedButton?.addEventListener("click", () => void start("failed"));
  cancelButton?.addEventListener("click", () => void cancel());
  refreshButton?.addEventListener("click", () => void refresh());
  feedbackButton?.addEventListener("click", insertFailure);

  function sessionChanged() {
    sessionToken += 1;
    requestSequence += 1;
    clearPoll();
    snapshot = undefined;
    available = false;
    operationInProgress = false;
    lastStateSignature = "unavailable:";
    render();
    void refresh();
  }

  return { refresh, sessionChanged, render };
}
