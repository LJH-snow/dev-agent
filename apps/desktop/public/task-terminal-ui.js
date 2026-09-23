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
}) {
  const panel = documentRef.getElementById("task-terminal-panel");
  const statusNode = documentRef.getElementById("task-terminal-status");
  const runList = documentRef.getElementById("task-terminal-runs");
  const commandInput = documentRef.getElementById("task-terminal-command");
  const runButton = documentRef.getElementById("task-terminal-run");
  const stopButton = documentRef.getElementById("task-terminal-stop");
  const output = documentRef.getElementById("task-terminal-output");
  const inputForm = documentRef.getElementById("task-terminal-input-form");
  const inputSubmit = inputForm.querySelector('button[type="submit"]');
  const input = documentRef.getElementById("task-terminal-input");
  const attachButton = documentRef.getElementById("task-terminal-attach-output");
  const previewInput = documentRef.getElementById("task-preview-url");
  const previewButton = documentRef.getElementById("task-preview-open");
  const previewFrame = documentRef.getElementById("task-preview-frame");
  const previewStatus = documentRef.getElementById("task-preview-status");

  let sessionId;
  let runs = [];
  let activeId;
  let cursor = 0;
  let pollTimer;
  let busy = false;
  let outputText = "";

  function status(key, values = {}) {
    statusNode.textContent = translate(key, values);
  }

  function activeRun() { return runs.find((run) => run.id === activeId); }

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
    input.disabled = !selected || selected.state !== "running" || busy;
    inputSubmit.disabled = input.disabled;
    attachButton.disabled = !outputText;
  }

  function appendEvents(events) {
    for (const event of events ?? []) {
      outputText += event.text;
    }
    const maxChars = 256 * 1024;
    if (outputText.length > maxChars) outputText = outputText.slice(-maxChars);
    output.textContent = outputText || translate("terminal.output.empty");
    output.scrollTop = output.scrollHeight;
    attachButton.disabled = !outputText;
  }

  function setActive(run) {
    activeId = run?.id;
    cursor = 0;
    outputText = "";
    output.textContent = translate("terminal.output.empty");
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
        outputText = "[Earlier terminal output was truncated or the poll cursor expired.]\n";
      }
      appendEvents(payload.events);
      cursor = Number(payload.lastSequence) || cursor;
      const index = runs.findIndex((run) => run.id === requestedRunId);
      if (index >= 0) runs[index] = { ...runs[index], ...payload };
      renderRuns();
      if (payload.state === "running") pollTimer = setTimeout(pollOutput, 700);
      else status("terminal.status.finished", { state: translate(`terminal.state.${payload.state}`), code: payload.exitCode ?? "—" });
    } catch {
      if (requestedSessionId === sessionId && requestedRunId === activeId) {
        status("terminal.status.error");
        pollTimer = setTimeout(pollOutput, 1500);
      }
    }
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
      runs = [payload, ...runs.filter((run) => run.id !== payload.id)];
      activeId = payload.id;
      cursor = 0;
      outputText = "";
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
      if (!response.ok) status("terminal.status.error");
      else {
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
      previewFrame.hidden = true;
      previewFrame.removeAttribute("src");
      previewStatus.textContent = translate("preview.status.invalid");
      return;
    }
    previewFrame.src = url;
    previewFrame.hidden = false;
    previewStatus.textContent = translate("preview.status.loading", { url });
  }

  function sessionChanged() {
    sessionId = getSessionId();
    runs = [];
    activeId = undefined;
    cursor = 0;
    outputText = "";
    output.textContent = translate("terminal.output.empty");
    previewFrame.hidden = true;
    previewFrame.removeAttribute("src");
    previewInput.value = "";
    clearTimeout(pollTimer);
    renderRuns();
    void refresh();
  }

  runButton.addEventListener("click", () => void startCommand());
  commandInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void startCommand();
    }
  });
  stopButton.addEventListener("click", () => void stopCommand());
  runList.addEventListener("change", () => {
    setActive(runs.find((run) => run.id === runList.value));
  });
  inputForm.addEventListener("submit", sendInput);
  previewButton.addEventListener("click", openPreview);
  previewFrame.addEventListener("load", () => {
    if (!previewFrame.hidden) previewStatus.textContent = translate("preview.status.loaded", { url: previewFrame.src });
  });
  attachButton.addEventListener("click", () => {
    if (outputText) insertFeedback(outputText.slice(-8000));
  });

  renderRuns();
  return { refresh, sessionChanged };
}
