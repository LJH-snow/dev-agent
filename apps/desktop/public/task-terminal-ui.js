
export const TERMINAL_COMMAND_HISTORY_LIMIT = 64;
const TERMINAL_COMMAND_MAX_CHARS = 4096;
export const TERMINAL_SEARCH_QUERY_LIMIT = 256;
export const TERMINAL_SEARCH_MATCH_LIMIT = 2048;

export function normalizeTerminalSearchQuery(value) {
  return String(value ?? "").slice(0, TERMINAL_SEARCH_QUERY_LIMIT);
}

export function findTerminalSearchMatches(text, query, limit = TERMINAL_SEARCH_MATCH_LIMIT) {
  const source = String(text ?? "");
  const needle = normalizeTerminalSearchQuery(query);
  if (!needle) return { matches: [], truncated: false };
  const safeLimit = Math.max(1, Math.min(TERMINAL_SEARCH_MATCH_LIMIT, Number(limit) || TERMINAL_SEARCH_MATCH_LIMIT));
  const normalizedSource = source.toLowerCase();
  const normalizedNeedle = needle.toLowerCase();
  const matches = [];
  let cursor = 0;
  while (matches.length < safeLimit) {
    const start = normalizedSource.indexOf(normalizedNeedle, cursor);
    if (start < 0) break;
    matches.push({ start, end: start + needle.length });
    cursor = start + Math.max(needle.length, 1);
  }
  return { matches, truncated: normalizedSource.indexOf(normalizedNeedle, cursor) >= 0 };
}

/**
 * Keeps command recall bounded to the current page/session. It deliberately
 * does not use browser storage because terminal commands can contain secrets.
 */
export class TerminalCommandHistory {
  constructor(limit = TERMINAL_COMMAND_HISTORY_LIMIT) {
    this.limit = Math.max(1, Math.min(TERMINAL_COMMAND_HISTORY_LIMIT, Number(limit) || TERMINAL_COMMAND_HISTORY_LIMIT));
    this.entries = [];
    this.index = -1;
    this.draft = "";
  }

  add(command) {
    const normalized = String(command ?? "").trim().slice(0, TERMINAL_COMMAND_MAX_CHARS);
    if (!normalized) return;
    this.entries = [...this.entries.filter((entry) => entry !== normalized), normalized].slice(-this.limit);
    this.reset("");
  }

  reset(value = "") {
    this.index = -1;
    this.draft = String(value ?? "").slice(0, TERMINAL_COMMAND_MAX_CHARS);
  }

  previous(currentValue = "") {
    if (this.entries.length === 0) return { value: String(currentValue ?? ""), active: false };
    if (this.index < 0) this.draft = String(currentValue ?? "").slice(0, TERMINAL_COMMAND_MAX_CHARS);
    this.index = this.index < 0 ? this.entries.length - 1 : Math.max(0, this.index - 1);
    return { value: this.entries[this.index] ?? "", active: true };
  }

  next() {
    if (this.index < 0) return { value: this.draft, active: false };
    if (this.index >= this.entries.length - 1) {
      this.index = -1;
      return { value: this.draft, active: false };
    }
    this.index += 1;
    return { value: this.entries[this.index] ?? "", active: true };
  }
}

export function normalizeLoopbackPreviewUrl(rawValue) {
  try {
    const url = new URL(String(rawValue).trim());
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const loopback = hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" || hostname === "::1";
    if (!loopback || !["http:", "https:"].includes(url.protocol) || !url.port || url.username || url.password) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

async function payloadOf(response) {
  try { return await response.json(); } catch { return {}; }
}

export function createTaskTerminalUI({
  documentRef = document,
  fetcher = fetch,
  translate,
  getSessionId,
  insertFeedback = () => {},
  storage,
  storageKeyPrefix = "dev-agent:terminal-selection:",
  onFinished = () => {},
  recordLifecycle = () => {},
}) {
  let terminalStorage = storage;
  if (terminalStorage === undefined) {
    try { terminalStorage = globalThis.sessionStorage; } catch { terminalStorage = undefined; }
  }
  const panel = documentRef.getElementById("task-terminal-panel");
  const statusNode = documentRef.getElementById("task-terminal-status");
  const runList = documentRef.getElementById("task-terminal-runs");
  const commandInput = documentRef.getElementById("task-terminal-command");
  const runButton = documentRef.getElementById("task-terminal-run");
  const stopButton = documentRef.getElementById("task-terminal-stop");
  const reconnectButton = documentRef.getElementById("task-terminal-reconnect");
  const followButton = documentRef.getElementById("task-terminal-follow");
  const clearButton = documentRef.getElementById("task-terminal-clear");
  const exportButton = documentRef.getElementById("task-terminal-export");
  const output = documentRef.getElementById("task-terminal-output");
  const searchInput = documentRef.getElementById("task-terminal-search");
  const searchStatus = documentRef.getElementById("task-terminal-search-status");
  const searchPreviousButton = documentRef.getElementById("task-terminal-search-previous");
  const searchNextButton = documentRef.getElementById("task-terminal-search-next");
  const inputForm = documentRef.getElementById("task-terminal-input-form");
  const inputSubmit = inputForm.querySelector('button[type="submit"]');
  const input = documentRef.getElementById("task-terminal-input");
  const attachButton = documentRef.getElementById("task-terminal-attach-output");
  const previewInput = documentRef.getElementById("task-preview-url");
  const previewButton = documentRef.getElementById("task-preview-open");
  const previewClearButton = documentRef.getElementById("task-preview-clear");
  const previewFrame = documentRef.getElementById("task-preview-frame");
  const previewStatus = documentRef.getElementById("task-preview-status");

  let sessionId;
  let runs = [];
  let activeId;
  let cursor = 0;
  let pollTimer;
  let busy = false;
  let outputText = "";
  let followOutput = true;
  let searchQuery = "";
  let searchMatches = [];
  let searchMatchesTruncated = false;
  let searchMatchIndex = -1;
  let previewActive = false;
  const commandHistory = new TerminalCommandHistory();
  const finishedNotified = new Set();

  function selectionKey(id) {
    return `${storageKeyPrefix}${id}`;
  }

  function readSelectedRun(id) {
    try {
      const value = terminalStorage?.getItem(selectionKey(id));
      return typeof value === "string" && value.length <= 128 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  function rememberSelectedRun(id, value) {
    if (!id || !value) return;
    try { terminalStorage?.setItem(selectionKey(id), value); } catch { /* optional browser storage */ }
  }

  function status(key, values = {}) {
    statusNode.textContent = translate(key, values);
  }

  function emitLifecycle(kind, state) {
    try {
      const result = recordLifecycle(kind, state);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
      // Lifecycle telemetry is best effort and must not change terminal UX.
    }
  }

  function activeRun() { return runs.find((run) => run.id === activeId); }

  function renderOutputControls() {
    followButton.disabled = followOutput || !outputText;
    output.dataset.follow = followOutput ? "true" : "false";
  }

  function renderSearchStatus() {
    const hasMatches = searchMatches.length > 0;
    searchPreviousButton.disabled = !hasMatches;
    searchNextButton.disabled = !hasMatches;
    if (!searchQuery) {
      searchStatus.textContent = translate("terminal.search.empty");
      return;
    }
    if (!hasMatches) {
      searchStatus.textContent = translate("terminal.search.none");
      return;
    }
    searchStatus.textContent = translate(searchMatchesTruncated ? "terminal.search.countCapped" : "terminal.search.count", { current: searchMatchIndex + 1, total: searchMatches.length });
  }

  function renderOutput({ scrollToMatch = false } = {}) {
    const previousScrollTop = output.scrollTop;
    if (!outputText) {
      output.textContent = translate("terminal.output.empty");
    } else if (!searchQuery || searchMatches.length === 0) {
      output.textContent = outputText;
    } else {
      const fragment = documentRef.createDocumentFragment();
      let outputCursor = 0;
      for (const [index, match] of searchMatches.entries()) {
        fragment.appendChild(documentRef.createTextNode(outputText.slice(outputCursor, match.start)));
        const mark = documentRef.createElement("mark");
        mark.className = "task-terminal-match";
        mark.dataset.terminalMatch = String(index);
        if (index === searchMatchIndex) mark.dataset.current = "true";
        mark.textContent = outputText.slice(match.start, match.end);
        fragment.appendChild(mark);
        outputCursor = match.end;
      }
      fragment.appendChild(documentRef.createTextNode(outputText.slice(outputCursor)));
      output.replaceChildren(fragment);
    }
    if (scrollToMatch && searchMatchIndex >= 0) {
      output.querySelector(`[data-terminal-match="${searchMatchIndex}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } else if (followOutput) {
      output.scrollTop = output.scrollHeight;
    } else {
      output.scrollTop = previousScrollTop;
    }
    renderSearchStatus();
  }

  function refreshSearchMatches({ selectFirst = false, scrollToMatch = false } = {}) {
    const result = findTerminalSearchMatches(outputText, searchQuery);
    searchMatches = result.matches;
    searchMatchesTruncated = result.truncated;
    if (searchMatches.length === 0) searchMatchIndex = -1;
    else if (selectFirst || searchMatchIndex < 0) searchMatchIndex = 0;
    else searchMatchIndex = Math.min(searchMatchIndex, searchMatches.length - 1);
    renderOutput({ scrollToMatch });
  }

  function navigateSearch(direction) {
    if (!searchMatches.length) {
      renderSearchStatus();
      return;
    }
    const offset = direction < 0 ? -1 : 1;
    searchMatchIndex = (searchMatchIndex + offset + searchMatches.length) % searchMatches.length;
    renderOutput({ scrollToMatch: true });
  }

  function renderRuns() {
    runList.replaceChildren();
    for (const run of runs) {
      const option = documentRef.createElement("option");
      option.value = run.id;
      option.textContent = `${translate(`terminal.state.${run.state}`)} · ${run.command.slice(0, 48)}`;
      runList.appendChild(option);
    }
    if (activeId && runs.some((run) => run.id === activeId)) runList.value = activeId;
    const selected = activeRun();
    stopButton.disabled = !selected || selected.state !== "running" || busy;
    reconnectButton.disabled = !selected || busy;
    clearButton.disabled = !outputText;
    exportButton.disabled = !outputText;
    input.disabled = !selected || selected.state !== "running" || busy;
    inputSubmit.disabled = input.disabled;
    attachButton.disabled = !outputText;
    renderOutputControls();
  }

  function appendEvents(events) {
    for (const event of events ?? []) {
      outputText += event.text;
    }
    const maxChars = 256 * 1024;
    if (outputText.length > maxChars) outputText = outputText.slice(-maxChars);
    refreshSearchMatches({ selectFirst: Boolean(searchQuery && searchMatchIndex < 0) });
    attachButton.disabled = !outputText;
  }

  function updateOutputFollowState() {
    const distanceFromBottom = output.scrollHeight - output.scrollTop - output.clientHeight;
    followOutput = distanceFromBottom <= 24;
    renderOutputControls();
  }

  function followLatestOutput() {
    followOutput = true;
    output.scrollTop = output.scrollHeight;
    renderOutputControls();
  }

  function setActive(run) {
    activeId = run?.id;
    if (run?.id && sessionId) rememberSelectedRun(sessionId, run.id);
    cursor = 0;
    outputText = "";
    followOutput = true;
    searchQuery = "";
    searchMatches = [];
    searchMatchesTruncated = false;
    searchMatchIndex = -1;
    searchInput.value = "";
    output.dataset.gap = "false";
    refreshSearchMatches();
    if (run) {
      status("terminal.status.selected", { state: translate(`terminal.state.${run.state}`) });
      void pollOutput();
    } else {
      status("terminal.status.ready");
      clearTimeout(pollTimer);
    }
    renderRuns();
  }

  async function refresh() {
    const requestedSessionId = getSessionId();
    sessionId = requestedSessionId;
    if (!requestedSessionId) {
      runs = [];
      setActive(undefined);
      return;
    }
    try {
      const response = await fetcher(`/api/terminal?sessionId=${encodeURIComponent(requestedSessionId)}`, { cache: "no-store" });
      const payload = await payloadOf(response);
      if (!response.ok || getSessionId() !== requestedSessionId) {
        status(response.status === 404 ? "terminal.status.unavailable" : "terminal.status.error");
        return;
      }
      runs = Array.isArray(payload.terminals) ? payload.terminals : [];
      if (!runs.some((run) => run.id === activeId)) {
        const preferred = runs.find((run) => run.state === "running") ?? runs[0];
        setActive(preferred);
      } else {
        renderRuns();
      }
      status("terminal.status.ready");
    } catch {
      status("terminal.status.error");
    }
  }

  async function pollOutput() {
    clearTimeout(pollTimer);
    const requestedSessionId = sessionId;
    const requestedRunId = activeId;
    if (!requestedSessionId || !requestedRunId) return;
    try {
      const response = await fetcher(`/api/terminal/${encodeURIComponent(requestedSessionId)}/${encodeURIComponent(requestedRunId)}?after=${cursor}`, { cache: "no-store" });
      const payload = await payloadOf(response);
      if (!response.ok || requestedSessionId !== sessionId || requestedRunId !== activeId) return;
      if (payload.outputTruncated) {
        outputText = "[Earlier terminal output was truncated or the poll cursor expired; the visible buffer was rehydrated.]\n";
        output.dataset.gap = "true";
      }
      appendEvents(payload.events);
      cursor = Number(payload.lastSequence) || cursor;
      const index = runs.findIndex((run) => run.id === requestedRunId);
      if (index >= 0) runs[index] = { ...runs[index], ...payload };
      renderRuns();
      if (payload.state === "running") pollTimer = setTimeout(pollOutput, 700);
      else {
        status("terminal.status.finished", { state: translate(`terminal.state.${payload.state}`), code: payload.exitCode ?? "—" });
        if (!finishedNotified.has(requestedRunId)) {
          finishedNotified.add(requestedRunId);
          onFinished(payload);
        }
      }
    } catch {
      if (requestedSessionId === sessionId && requestedRunId === activeId) {
        status("terminal.status.error");
        pollTimer = setTimeout(pollOutput, 1500);
      }
    }
  }

  function clearOutput() {
    const run = activeRun();
    outputText = "";
    followOutput = true;
    cursor = Number(run?.lastSequence) || cursor;
    output.dataset.gap = "false";
    refreshSearchMatches();
    status("terminal.status.bufferCleared");
    renderRuns();
  }

  function reconnectOutput() {
    if (!activeRun()) return;
    outputText = "";
    followOutput = true;
    cursor = 0;
    output.dataset.gap = "false";
    refreshSearchMatches();
    status("terminal.status.reconnecting");
    void pollOutput();
  }

  function redactTerminalText(value) {
    return String(value).replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s]+)/gi, "$1=[redacted]");
  }

  function exportOutput() {
    if (!outputText || typeof Blob === "undefined" || !globalThis.URL?.createObjectURL) return;
    const run = activeRun();
    const safeId = String(run?.id ?? "run").replace(/[^a-z0-9_-]/gi, "-").slice(0, 48);
    const blob = new Blob([redactTerminalText(outputText).slice(-256 * 1024)], { type: "text/plain;charset=utf-8" });
    const url = globalThis.URL.createObjectURL(blob);
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = `dev-agent-terminal-${safeId}.log`;
    link.rel = "noopener";
    link.click();
    globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(url), 0);
    status("terminal.status.exported");
  }

  async function startCommand() {
    if (!getSessionId() || busy) return;
    const command = commandInput.value.trim();
    if (!command) return;
    busy = true;
    renderRuns();
    status("terminal.status.starting");
    try {
      const response = await fetcher("/api/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: getSessionId(), command }),
      });
      const payload = await payloadOf(response);
      if (!response.ok) {
        statusNode.textContent = payload?.error || translate("terminal.status.error");
        return;
      }
      commandHistory.add(command);
      runs = [payload, ...runs.filter((run) => run.id !== payload.id)];
      activeId = payload.id;
      cursor = 0;
      outputText = "";
      followOutput = true;
      appendEvents(payload.events);
      cursor = Number(payload.lastSequence) || 0;
      commandInput.value = "";
      status("terminal.status.running");
      renderRuns();
      pollTimer = setTimeout(pollOutput, 250);
    } catch {
      status("terminal.status.error");
    } finally {
      busy = false;
      renderRuns();
    }
  }

  async function stopCommand() {
    const run = activeRun();
    if (!run || run.state !== "running" || busy) return;
    busy = true;
    renderRuns();
    try {
      const response = await fetcher(`/api/terminal/${encodeURIComponent(sessionId)}/${encodeURIComponent(run.id)}`, { method: "DELETE" });
      const payload = await payloadOf(response);
      if (!response.ok) {
        status("terminal.status.error");
      } else {
        const index = runs.findIndex((candidate) => candidate.id === run.id);
        if (index >= 0) runs[index] = { ...runs[index], ...payload };
        status("terminal.status.stopping");
        pollTimer = setTimeout(pollOutput, 300);
      }
    } catch {
      status("terminal.status.error");
    } finally {
      busy = false;
      renderRuns();
    }
  }

  async function sendInput(event) {
    event.preventDefault();
    const run = activeRun();
    if (!run || run.state !== "running" || busy || !input.value) return;
    const text = `${input.value}\n`;
    input.value = "";
    try {
      const response = await fetcher(`/api/terminal/${encodeURIComponent(sessionId)}/${encodeURIComponent(run.id)}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = await payloadOf(response);
      if (!response.ok) status("terminal.status.error");
      else {
        const index = runs.findIndex((candidate) => candidate.id === run.id);
        if (index >= 0) runs[index] = { ...runs[index], ...payload };
        await pollOutput();
      }
    } catch {
      status("terminal.status.error");
    }
  }

  function openPreview() {
    const url = normalizeLoopbackPreviewUrl(previewInput.value);
    if (!url) {
      emitLifecycle("preview", "failed");
      clearPreview("preview.status.invalid");
      return;
    }
    previewActive = true;
    emitLifecycle("preview", "started");
    previewFrame.src = url;
    previewFrame.hidden = false;
    previewFrame.setAttribute("aria-busy", "true");
    previewStatus.dataset.state = "loading";
    previewStatus.textContent = translate("preview.status.loading", { url });
  }

  function clearPreview(message = "preview.status.cleared") {
    const wasActive = previewActive;
    previewActive = false;
    if (wasActive) emitLifecycle("preview", "cleared");
    previewFrame.hidden = true;
    previewFrame.removeAttribute("src");
    previewFrame.removeAttribute("aria-busy");
    previewStatus.dataset.state = "idle";
    previewStatus.textContent = translate(message);
  }

  function sessionChanged() {
    sessionId = getSessionId();
    runs = [];
    activeId = undefined;
    cursor = 0;
    outputText = "";
    followOutput = true;
    searchQuery = "";
    searchMatches = [];
    searchMatchesTruncated = false;
    searchMatchIndex = -1;
    searchInput.value = "";
    commandHistory.reset();
    refreshSearchMatches();
    clearPreview();
    previewInput.value = "";
    clearTimeout(pollTimer);
    renderRuns();
    void refresh();
  }

  runButton.addEventListener("click", () => void startCommand());
  commandInput.addEventListener("input", () => {
    commandHistory.reset(commandInput.value);
  });
  commandInput.addEventListener("keydown", (event) => {
    const value = commandInput.value;
    const singleLine = !value.includes("\n");
    const atStart = (commandInput.selectionStart ?? 0) === 0;
    const atEnd = (commandInput.selectionEnd ?? value.length) === value.length;
    if (singleLine && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowUp" && atStart) {
      const next = commandHistory.previous(value);
      if (next.active) {
        event.preventDefault();
        commandInput.value = next.value;
        commandInput.setSelectionRange?.(next.value.length, next.value.length);
      }
      return;
    }
    if (singleLine && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowDown" && atEnd) {
      const next = commandHistory.next();
      if (next.active || value !== next.value) {
        event.preventDefault();
        commandInput.value = next.value;
        commandInput.setSelectionRange?.(next.value.length, next.value.length);
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void startCommand();
    }
  });
  stopButton.addEventListener("click", () => void stopCommand());
  reconnectButton.addEventListener("click", reconnectOutput);
  followButton.addEventListener("click", followLatestOutput);
  clearButton.addEventListener("click", clearOutput);
  exportButton.addEventListener("click", exportOutput);
  searchInput.addEventListener("input", () => {
    searchQuery = normalizeTerminalSearchQuery(searchInput.value);
    if (searchInput.value !== searchQuery) searchInput.value = searchQuery;
    searchMatchIndex = -1;
    refreshSearchMatches({ selectFirst: Boolean(searchQuery), scrollToMatch: Boolean(searchQuery) });
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    navigateSearch(event.shiftKey ? -1 : 1);
  });
  searchPreviousButton.addEventListener("click", () => navigateSearch(-1));
  searchNextButton.addEventListener("click", () => navigateSearch(1));
  output.addEventListener("scroll", updateOutputFollowState);
  runList.addEventListener("change", () => {
    setActive(runs.find((run) => run.id === runList.value));
  });
  inputForm.addEventListener("submit", sendInput);
  previewButton.addEventListener("click", openPreview);
  previewClearButton.addEventListener("click", () => clearPreview());
  previewFrame.addEventListener("load", () => {
    if (previewActive && !previewFrame.hidden) {
      previewFrame.removeAttribute("aria-busy");
      previewStatus.dataset.state = "loaded";
      emitLifecycle("preview", "loaded");
      previewStatus.textContent = translate("preview.status.loaded", { url: previewFrame.src });
    }
  });
  previewFrame.addEventListener("error", () => {
    if (previewActive && !previewFrame.hidden) {
      previewFrame.removeAttribute("aria-busy");
      previewStatus.dataset.state = "error";
      emitLifecycle("preview", "failed");
      previewStatus.textContent = translate("preview.status.error");
    }
  });
  attachButton.addEventListener("click", () => {
    if (outputText) insertFeedback(outputText.slice(-8000));
  });

  renderRuns();
  return { refresh, sessionChanged };
}
