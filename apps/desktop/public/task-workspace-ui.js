const REVIEW_COMMENT_STORAGE_VERSION = 1;
const MAX_REVIEW_COMMENTS = 64;
const MAX_REVIEW_COMMENT_TEXT = 2000;
const MAX_REVIEW_COMMENT_PATH = 512;
const MAX_REVIEW_COMMENT_ANCHOR = 128;
const MAX_REVIEW_COMMENT_BYTES = 32 * 1024;

const REVIEW_COMMENT_GROUPS = new Set(["committed", "staged", "unstaged", "untracked", "all"]);

function truncateUtf8(value, maxBytes) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  return new TextDecoder().decode(bytes.slice(0, maxBytes));
}

function normalizedReviewComment(value) {
  if (!value || typeof value !== "object") return undefined;
  const path = typeof value.path === "string" ? value.path.replace(/[\u0000-\u001f\u007f]/g, "�").trim().slice(0, MAX_REVIEW_COMMENT_PATH) : "";
  const anchor = typeof value.anchor === "string" ? value.anchor.replace(/[\u0000-\u001f\u007f]/g, "�").trim().slice(0, MAX_REVIEW_COMMENT_ANCHOR) : "";
  const text = typeof value.text === "string" ? value.text.replace(/\0/g, "�").trim().slice(0, MAX_REVIEW_COMMENT_TEXT) : "";
  const group = typeof value.group === "string" && REVIEW_COMMENT_GROUPS.has(value.group) ? value.group : "all";
  if (!path || !anchor || !text) return undefined;
  return { path, anchor, group, text };
}

export function formatReviewComments(input) {
  const comments = Array.isArray(input) ? input.map(normalizedReviewComment).filter(Boolean).slice(0, MAX_REVIEW_COMMENTS) : [];
  const output = comments.map((comment) => `[Review comment ${comment.path}:${comment.anchor}]\n${comment.text}`).join("\n\n");
  return truncateUtf8(output, MAX_REVIEW_COMMENT_BYTES);
}

export function readReviewComments(storage, key) {
  if (!storage || typeof storage.getItem !== "function") return [];
  try {
    const raw = storage.getItem(key);
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_REVIEW_COMMENT_BYTES) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== REVIEW_COMMENT_STORAGE_VERSION || !Array.isArray(parsed.comments)) return [];
    return parsed.comments.map(normalizedReviewComment).filter(Boolean).slice(0, MAX_REVIEW_COMMENTS);
  } catch {
    return [];
  }
}

export function writeReviewComments(storage, key, comments) {
  if (!storage || typeof storage.setItem !== "function") return false;
  const normalized = (Array.isArray(comments) ? comments : []).map(normalizedReviewComment).filter(Boolean).slice(0, MAX_REVIEW_COMMENTS);
  try {
    const raw = JSON.stringify({ version: REVIEW_COMMENT_STORAGE_VERSION, comments: normalized });
    if (new TextEncoder().encode(raw).byteLength > MAX_REVIEW_COMMENT_BYTES) return false;
    storage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

const workspaceStateKeys = {
  ready: "workspace.state.ready",
  dirty: "workspace.state.dirty",
  running: "workspace.state.running",
  merged: "workspace.state.merged",
  cleaned: "workspace.state.cleaned",
  missing: "workspace.state.missing",
};

const workspaceErrorKeys = {
  "not-a-git-repository": "workspace.error.notGit",
  "workspace-limit": "workspace.error.limit",
  "workspace-running": "workspace.error.running",
  "workspace-dirty": "workspace.error.dirty",
  "base-worktree-dirty": "workspace.error.baseDirty",
  "base-branch-changed": "workspace.error.baseBranchChanged",
  "merge-failed": "workspace.error.mergeFailed",
  "workspace-missing": "workspace.error.missing",
  "workspace-cleaned": "workspace.error.cleaned",
  "workspace-file-not-found": "workspace.error.missingFile",
};

async function responsePayload(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function createTaskWorkspaceUI({
  documentRef = document,
  fetcher = fetch,
  translate,
  getSessionId,
  activateSession,
  confirmAction = (message) => window.confirm(message),
  requestReviewComment = () => window.prompt(translate("workspace.comment.prompt"), ""),
  insertReviewComments = () => {},
  storage,
  storageKeyPrefix = "dev-agent:review-comments:",
}) {
  let reviewStorage = storage;
  if (reviewStorage === undefined) {
    try { reviewStorage = globalThis.sessionStorage; } catch { reviewStorage = undefined; }
  }
  const newTaskButton = documentRef.getElementById("new-task");
  const refreshButton = documentRef.getElementById("task-workspace-refresh");
  const statusNode = documentRef.getElementById("task-workspace-status");
  const listNode = documentRef.getElementById("task-workspace-list");
  const emptyNode = documentRef.getElementById("task-workspace-empty");
  const detailsNode = documentRef.getElementById("task-workspace-details");
  const branchNode = documentRef.getElementById("task-workspace-branch");
  const directoryNode = documentRef.getElementById("task-workspace-directory");
  const stateNode = documentRef.getElementById("task-workspace-state");
  const changesNode = documentRef.getElementById("task-workspace-changes");
  const compareButton = documentRef.getElementById("task-workspace-compare");
  const mergeButton = documentRef.getElementById("task-workspace-merge");
  const cleanupButton = documentRef.getElementById("task-workspace-cleanup");
  const diffPanel = documentRef.getElementById("task-workspace-diff-panel");
  const diffTabs = documentRef.getElementById("task-workspace-diff-tabs");
  const diffFiles = documentRef.getElementById("task-workspace-diff-files");
  const diffContent = documentRef.getElementById("task-workspace-diff");
  const commentsPanel = documentRef.getElementById("task-workspace-comments-panel");
  const commentsList = documentRef.getElementById("task-workspace-comments-list");
  const insertCommentsButton = documentRef.getElementById("task-workspace-insert-comments");

  let available = false;
  let loading = false;
  let workspaces = [];
  let requestSequence = 0;
  let diffSequence = 0;
  let operationInProgress = false;
  let selectedFile;
  let activeDiffGroup = "all";
  let currentDiff;
  const commentsBySession = new Map();

  function commentsStorageKey(sessionId) {
    return `${storageKeyPrefix}${sessionId}`;
  }

  function persistComments(sessionId) {
    writeReviewComments(reviewStorage, commentsStorageKey(sessionId), commentsBySession.get(sessionId) ?? []);
  }

  function stateLabel(state) {
    const key = workspaceStateKeys[state] ?? "workspace.state.missing";
    return translate(key);
  }

  function setStatus(key, values = {}) {
    statusNode.textContent = translate(key, values);
    statusNode.dataset.state = key.includes("error") ? "error" : "info";
  }

  function clearDiff() {
    diffSequence += 1;
    diffPanel.hidden = true;
    diffTabs.replaceChildren();
    diffFiles.replaceChildren();
    diffContent.textContent = "";
    selectedFile = undefined;
    activeDiffGroup = "all";
    currentDiff = undefined;
  }

  function selectedWorkspace() {
    return workspaces.find((workspace) => workspace.sessionId === getSessionId());
  }

  function renderList() {
    listNode.replaceChildren();
    const selectedSessionId = getSessionId();
    for (const workspace of workspaces) {
      const card = documentRef.createElement("button");
      card.type = "button";
      card.className = "task-workspace-card";
      card.dataset.state = workspace.state;
      card.setAttribute("aria-current", String(workspace.sessionId === selectedSessionId));
      card.addEventListener("click", () => activateSession(workspace.sessionId));

      const heading = documentRef.createElement("span");
      heading.className = "task-workspace-card-heading";
      heading.textContent = workspace.sessionId;
      const meta = documentRef.createElement("span");
      meta.className = "task-workspace-card-meta";
      meta.textContent = `${workspace.branch} · ${stateLabel(workspace.state)}`;
      const directory = documentRef.createElement("span");
      directory.className = "task-workspace-card-directory";
      directory.textContent = workspace.directory;
      const changes = documentRef.createElement("span");
      changes.className = "task-workspace-card-changes";
      changes.textContent = translate("workspace.files", { count: workspace.changedFiles });
      card.append(heading, meta, directory, changes);
      listNode.appendChild(card);
    }

    emptyNode.hidden = workspaces.length > 0;
    if (!available) {
      emptyNode.textContent = translate("workspace.notGit");
      newTaskButton.disabled = true;
      return;
    }
    if (workspaces.length === 0) emptyNode.textContent = translate("workspace.empty");
    newTaskButton.disabled = loading || operationInProgress;
  }

  function commentsFor(sessionId) {
    if (!commentsBySession.has(sessionId)) {
      commentsBySession.set(sessionId, readReviewComments(reviewStorage, commentsStorageKey(sessionId)));
    }
    return commentsBySession.get(sessionId);
  }

  function renderComments() {
    commentsList.replaceChildren();
    const workspace = selectedWorkspace();
    const comments = workspace ? commentsFor(workspace.sessionId) : [];
    commentsPanel.hidden = comments.length === 0;
    insertCommentsButton.disabled = comments.length === 0;
    for (const [index, comment] of comments.entries()) {
      const item = documentRef.createElement("li");
      const copy = documentRef.createElement("span");
      copy.className = "task-workspace-comment-copy";
      copy.textContent = `${comment.path}:${comment.anchor} · ${comment.text}`;
      const remove = documentRef.createElement("button");
      remove.type = "button";
      remove.className = "task-workspace-comment-remove";
      remove.textContent = translate("workspace.comment.remove");
      remove.setAttribute("aria-label", translate("workspace.comment.removeAt", { path: comment.path, anchor: comment.anchor }));
      remove.addEventListener("click", () => {
        comments.splice(index, 1);
        persistComments(workspace.sessionId);
        renderComments();
      });
      item.append(copy, remove);
      commentsList.appendChild(item);
    }
  }

  function addComment(workspace, path, anchor, group) {
    const text = requestReviewComment({ path, anchor, group });
    if (typeof text !== "string" || !text.trim()) return;
    const comments = commentsFor(workspace.sessionId);
    if (comments.length >= 200) {
      setStatus("workspace.comment.limit");
      return;
    }
    const comment = normalizedReviewComment({ path, anchor, group, text });
    if (!comment) return;
    comments.push(comment);
    persistComments(workspace.sessionId);
    renderComments();
    setStatus("workspace.comment.added");
  }

  function renderPatch(workspace, group, patch) {
    diffContent.dataset.selectedPath = selectedFile ?? "";
    diffContent.dataset.selectedGroup = group;
    diffContent.replaceChildren();
    const lines = patch.split("\n");
    let hunkIndex = -1;
    let oldLine = 0;
    let newLine = 0;
    for (const line of lines) {
      const row = documentRef.createElement("div");
      row.className = "task-workspace-diff-line";
      if (line.startsWith("@@ ")) {
        hunkIndex += 1;
        const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLine = Number(match[1]);
          newLine = Number(match[2]);
        }
        row.classList.add("is-hunk");
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        row.classList.add("is-addition");
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        row.classList.add("is-deletion");
      }
      const code = documentRef.createElement("code");
      code.textContent = line || " ";
      row.appendChild(code);
      const changedLine = line.startsWith("+") && !line.startsWith("+++") || line.startsWith("-") && !line.startsWith("---");
      if (changedLine && hunkIndex >= 0 && selectedFile) {
        const anchor = line.startsWith("+") ? `+${newLine}` : `−${oldLine}`;
        const comment = documentRef.createElement("button");
        comment.type = "button";
        comment.className = "task-workspace-line-action";
        comment.textContent = translate("workspace.comment.add");
        comment.setAttribute("aria-label", translate("workspace.comment.addAt", { path: selectedFile ?? "", anchor }));
        comment.addEventListener("click", () => addComment(workspace, selectedFile ?? "", anchor, group));
        row.appendChild(comment);
      }
      diffContent.appendChild(row);
      if (line.startsWith("@@ ")) continue;
      if (line.startsWith("+") && !line.startsWith("+++")) newLine += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) oldLine += 1;
      else if (line.startsWith(" ")) { oldLine += 1; newLine += 1; }
    }
  }

  function renderDetails() {
    const workspace = selectedWorkspace();
    detailsNode.hidden = !workspace;
    compareButton.disabled = !workspace || ["cleaned", "missing"].includes(workspace.state) || operationInProgress;
    mergeButton.disabled = !workspace || workspace.dirty || ["running", "cleaned", "missing", "merged"].includes(workspace.state) || operationInProgress;
    cleanupButton.disabled = !workspace || workspace.dirty || ["running", "cleaned", "missing"].includes(workspace.state) || operationInProgress;
    if (!workspace) {
      clearDiff();
      return;
    }
    if (currentDiff && currentDiff.sessionId !== workspace.sessionId) clearDiff();
    branchNode.textContent = workspace.branch;
    directoryNode.textContent = workspace.directory;
    stateNode.textContent = stateLabel(workspace.state);
    stateNode.dataset.state = workspace.state;
    changesNode.textContent = translate("workspace.files", { count: workspace.changedFiles });
  }

  function render() {
    renderList();
    renderDetails();
    renderComments();
  }

  function errorText(payload) {
    const key = workspaceErrorKeys[payload?.code];
    if (key) return translate(key);
    return translate("workspace.error.generic");
  }

  async function refresh() {
    const requestId = ++requestSequence;
    loading = true;
    render();
    try {
      const response = await fetcher("/api/workspaces", { cache: "no-store" });
      const payload = await responsePayload(response);
      if (!response.ok || requestId !== requestSequence) {
        if (requestId === requestSequence) setStatus("workspace.error.generic");
        return;
      }
      available = payload.available === true;
      workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
      setStatus(available ? "workspace.status.ready" : "workspace.status.notGit");
      render();
    } catch {
      if (requestId === requestSequence) setStatus("workspace.error.generic");
    } finally {
      if (requestId === requestSequence) {
        loading = false;
        render();
      }
    }
  }

  async function createTask() {
    if (!available || loading || operationInProgress) return;
    operationInProgress = true;
    setStatus("workspace.status.creating");
    render();
    try {
      const response = await fetcher("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        const key = workspaceErrorKeys[payload?.code];
        if (key) setStatus(key);
        else setStatus("workspace.error.generic");
        return;
      }
      await activateSession(payload.sessionId);
      await refresh();
      setStatus("workspace.status.created");
    } catch {
      setStatus("workspace.error.generic");
    } finally {
      operationInProgress = false;
      render();
    }
  }

  function renderDiff(payload) {
    diffFiles.replaceChildren();
    const allFilesButton = documentRef.createElement("button");
    allFilesButton.type = "button";
    allFilesButton.className = "task-workspace-file-filter";
    allFilesButton.dataset.filePath = "";
    allFilesButton.setAttribute("aria-current", selectedFile === undefined ? "true" : "false");
    allFilesButton.textContent = translate("workspace.diff.allFiles");
    allFilesButton.setAttribute("aria-pressed", String(selectedFile === undefined));
    allFilesButton.addEventListener("click", () => {
      selectedFile = undefined;
      void compare();
    });
    const allFilesItem = documentRef.createElement("li");
    allFilesItem.appendChild(allFilesButton);
    diffFiles.appendChild(allFilesItem);

    for (const file of payload.files ?? []) {
      const item = documentRef.createElement("li");
      const fileButton = documentRef.createElement("button");
      fileButton.type = "button";
      fileButton.className = "task-workspace-file-filter";
      fileButton.dataset.filePath = file.path;
      fileButton.setAttribute("aria-pressed", String(selectedFile === file.path));
      fileButton.setAttribute("aria-current", selectedFile === file.path ? "true" : "false");
      fileButton.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const buttons = [...diffFiles.querySelectorAll("button.task-workspace-file-filter")];
        const index = buttons.indexOf(fileButton);
        buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
      });
      const path = documentRef.createElement("span");
      path.textContent = file.path;
      const state = documentRef.createElement("span");
      state.textContent = `${file.status} · ${(file.groups ?? []).map((group) => translate(`workspace.diff.${group}`)).join(", ")}`;
      fileButton.append(path, state);
      fileButton.addEventListener("click", () => {
        selectedFile = file.path;
        activeDiffGroup = "all";
        void compare(file.path);
      });
      item.appendChild(fileButton);
      diffFiles.appendChild(item);
    }

    diffTabs.replaceChildren();
    const availableSections = (payload.sections ?? []).filter((section) => section.fileCount > 0 && section.diff);
    const choices = [
      { group: "all", label: translate("workspace.diff.all"), diff: payload.diff ?? "" },
      ...availableSections.map((section) => ({
        group: section.group,
        label: `${translate(`workspace.diff.${section.group}`)} (${section.fileCount})`,
        diff: section.diff,
      })),
    ];
    if (!choices.some((choice) => choice.group === activeDiffGroup)) activeDiffGroup = "all";
    for (const choice of choices) {
      const tab = documentRef.createElement("button");
      tab.type = "button";
      tab.className = "task-workspace-diff-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("tabindex", choice.group === activeDiffGroup ? "0" : "-1");
      tab.setAttribute("aria-selected", String(choice.group === activeDiffGroup));
      tab.textContent = choice.label;
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...diffTabs.querySelectorAll('[role="tab"]')];
        const index = tabs.indexOf(tab);
        const targetIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : index + (event.key === "ArrowRight" ? 1 : -1);
        const target = tabs[(targetIndex + tabs.length) % tabs.length];
        target?.focus();
        target?.click();
      });
      tab.addEventListener("click", () => {
        activeDiffGroup = choice.group;
        if (choice.diff) renderPatch(selectedWorkspace(), choice.group, choice.diff);
        else diffContent.textContent = translate("workspace.diff.empty");
        for (const candidate of diffTabs.querySelectorAll('[role="tab"]')) {
          candidate.setAttribute("aria-selected", String(candidate === tab));
          candidate.setAttribute("tabindex", candidate === tab ? "0" : "-1");
        }
      });
      diffTabs.appendChild(tab);
    }
    const activeChoice = choices.find((choice) => choice.group === activeDiffGroup) ?? choices[0];
    if (activeChoice?.diff) renderPatch(selectedWorkspace(), activeChoice.group, activeChoice.diff);
    else diffContent.textContent = translate("workspace.diff.empty");
  }

  async function compare(path = selectedFile) {
    const workspace = selectedWorkspace();
    if (!workspace) return;
    selectedFile = path;
    const requestId = ++diffSequence;
    diffPanel.hidden = false;
    diffContent.textContent = translate("workspace.diff.loading");
    diffFiles.replaceChildren();
    diffTabs.replaceChildren();
    try {
      const query = path === undefined ? "" : `?path=${encodeURIComponent(path)}`;
      const response = await fetcher(`/api/workspaces/${encodeURIComponent(workspace.sessionId)}/diff${query}`, {
        cache: "no-store",
      });
      const payload = await responsePayload(response);
      if (requestId !== diffSequence || getSessionId() !== workspace.sessionId) return;
      if (!response.ok) {
        diffContent.textContent = errorText(payload);
        return;
      }
      currentDiff = payload;
      renderDiff(payload);
      renderComments();
      if (payload.truncated) setStatus("workspace.diff.truncated");
      else if (payload.filesTruncated) setStatus("workspace.diff.filesTruncated");
      else setStatus("workspace.diff.loaded", { count: (payload.files ?? []).length });
    } catch {
      if (requestId === diffSequence) diffContent.textContent = translate("workspace.error.generic");
    }
  }

  async function merge() {
    const workspace = selectedWorkspace();
    if (!workspace || mergeButton.disabled) return;
    if (!confirmAction(translate("workspace.confirm.merge", { branch: workspace.branch, base: workspace.baseBranch }))) return;
    operationInProgress = true;
    setStatus("workspace.status.merging");
    render();
    try {
      const response = await fetcher(`/api/workspaces/${encodeURIComponent(workspace.sessionId)}/merge`, { method: "POST" });
      const payload = await responsePayload(response);
      if (!response.ok) {
        setStatus(workspaceErrorKeys[payload?.code] ?? "workspace.error.generic");
        return;
      }
      setStatus(payload.alreadyMerged ? "workspace.status.alreadyMerged" : "workspace.status.merged");
      await refresh();
    } catch {
      setStatus("workspace.error.generic");
    } finally {
      operationInProgress = false;
      render();
    }
  }

  async function cleanup() {
    const workspace = selectedWorkspace();
    if (!workspace || cleanupButton.disabled) return;
    if (!confirmAction(translate("workspace.confirm.cleanup", { task: workspace.sessionId }))) return;
    operationInProgress = true;
    setStatus("workspace.status.cleaning");
    render();
    try {
      const response = await fetcher(`/api/workspaces/${encodeURIComponent(workspace.sessionId)}`, { method: "DELETE" });
      const payload = await responsePayload(response);
      if (!response.ok) {
        setStatus(workspaceErrorKeys[payload?.code] ?? "workspace.error.generic");
        return;
      }
      clearDiff();
      setStatus(payload.branchRetained ? "workspace.status.cleanedBranchKept" : "workspace.status.cleaned");
      await refresh();
    } catch {
      setStatus("workspace.error.generic");
    } finally {
      operationInProgress = false;
      render();
    }
  }

  newTaskButton.addEventListener("click", createTask);
  refreshButton.addEventListener("click", refresh);
  compareButton.addEventListener("click", () => void compare());
  mergeButton.addEventListener("click", merge);
  cleanupButton.addEventListener("click", cleanup);
  insertCommentsButton.addEventListener("click", () => {
    const workspace = selectedWorkspace();
    if (!workspace) return;
    insertReviewComments(commentsFor(workspace.sessionId).slice());
  });

  render();
  return { refresh, render };
}
