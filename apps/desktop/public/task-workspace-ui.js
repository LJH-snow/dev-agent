const REVIEW_COMMENT_STORAGE_VERSION = 1;
const MAX_REVIEW_COMMENTS = 64;
const MAX_REVIEW_COMMENT_TEXT = 2000;
const MAX_REVIEW_COMMENT_PATH = 512;
const MAX_REVIEW_COMMENT_ANCHOR = 128;
const MAX_REVIEW_COMMENT_BYTES = 32 * 1024;

const REVIEW_COMMENT_GROUPS = new Set(["committed", "staged", "unstaged", "untracked", "all"]);
const DIFF_FILE_LIMIT = 500;
const DIFF_SEARCH_LIMIT = 256;

function normalizedDiffText(value) {
  return String(value ?? "").slice(0, 192 * 1024);
}

function diffLineKind(line) {
  if (line.startsWith("@@ ")) return "hunk";
  if (line.startsWith("diff --git ")) return "file";
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "header";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "delete";
  if (line.startsWith("\\")) return "meta";
  if (
    line.startsWith("# ") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("old mode ") ||
    line.startsWith("new mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("Binary files ")
  ) return "meta";
  return "context";
}

/** Parses only the bounded unified patch projection returned by the Desktop API. */
export function parseUnifiedDiff(patch) {
  const lines = normalizedDiffText(patch).split("\n");
  const entries = [];
  let hunkIndex = -1;
  let oldLine = 0;
  let newLine = 0;
  for (const rawLine of lines) {
    const line = String(rawLine);
    const kind = diffLineKind(line);
    if (kind === "hunk") {
      hunkIndex += 1;
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      entries.push({ kind, raw: line, text: line, hunkIndex, oldLine, newLine });
      continue;
    }
    if (kind === "add") {
      entries.push({
        kind,
        raw: line,
        text: line.slice(1),
        hunkIndex,
        newLine,
        anchor: hunkIndex >= 0 ? `+${newLine}` : undefined,
      });
      newLine += 1;
      continue;
    }
    if (kind === "delete") {
      entries.push({
        kind,
        raw: line,
        text: line.slice(1),
        hunkIndex,
        oldLine,
        anchor: hunkIndex >= 0 ? `−${oldLine}` : undefined,
      });
      oldLine += 1;
      continue;
    }
    if (kind === "context") {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      entries.push({ kind, raw: line, text, hunkIndex, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
      continue;
    }
    entries.push({ kind, raw: line, text: line, hunkIndex });
  }
  return entries;
}

function normalizedDiffSearch(value) {
  return String(value ?? "").slice(0, DIFF_SEARCH_LIMIT).trim().toLocaleLowerCase();
}

export function filterDiffFiles(files, query = "") {
  const normalized = normalizedDiffSearch(query);
  const source = Array.isArray(files) ? files.slice(0, DIFF_FILE_LIMIT) : [];
  if (!normalized) return source;
  return source.filter((file) => typeof file?.path === "string" && file.path.toLocaleLowerCase().includes(normalized));
}

function normalizedDiffStatus(value) {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!raw || raw === "CHANGED" || raw === "COMMITTED") return "M";
  return raw;
}

function diffStatusTone(status) {
  if (status === "??" || status.startsWith("A") || status.startsWith("+")) return "A";
  if (status.startsWith("D") || status.startsWith("-")) return "D";
  if (status.startsWith("M") || status.startsWith("R") || status.startsWith("C") || status.startsWith("~")) return "M";
  return "M";
}

/** Pair bounded adjacent additions/deletions into side-by-side rows. */
export function pairSplitDiffEntries(entries) {
  const source = Array.isArray(entries) ? entries : [];
  const rows = [];
  for (let index = 0; index < source.length;) {
    const entry = source[index];
    if (entry?.kind !== "add" && entry?.kind !== "delete") {
      rows.push({ kind: entry?.kind ?? "context", entry });
      index += 1;
      continue;
    }

    const deletions = [];
    const additions = [];
    while (index < source.length && (source[index]?.kind === "add" || source[index]?.kind === "delete")) {
      const change = source[index];
      if (change.kind === "delete") deletions.push(change);
      else additions.push(change);
      index += 1;
    }
    const rowCount = Math.max(deletions.length, additions.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      rows.push({
        kind: "change",
        deletion: deletions[rowIndex],
        addition: additions[rowIndex],
      });
    }
  }
  return rows;
}

export function summarizeDiffPayload(payload) {
  const files = Array.isArray(payload?.files) ? payload.files.slice(0, DIFF_FILE_LIMIT) : [];
  const patch = normalizedDiffText(payload?.diff);
  const additions = patch.split("\n").reduce((count, line) => count + (diffLineKind(line) === "add" ? 1 : 0), 0);
  const deletions = patch.split("\n").reduce((count, line) => count + (diffLineKind(line) === "delete" ? 1 : 0), 0);
  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const file of files) {
    const status = normalizedDiffStatus(file?.status);
    if (status === "??" || status.startsWith("A") || status.startsWith("+")) counts.added += 1;
    else if (status.startsWith("D") || status.startsWith("-")) counts.deleted += 1;
    else counts.modified += 1;
  }
  return { files: files.length, additions, deletions, ...counts };
}

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
  const diffSummary = documentRef.getElementById("task-workspace-diff-summary");
  const diffViewUnified = documentRef.getElementById("task-workspace-diff-view-unified");
  const diffViewSplit = documentRef.getElementById("task-workspace-diff-view-split");
  const diffSearch = documentRef.getElementById("task-workspace-diff-search");
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
  let diffViewMode = "unified";
  let diffSearchValue = "";
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

  function updateDiffViewControls() {
    for (const [button, mode] of [[diffViewUnified, "unified"], [diffViewSplit, "split"]]) {
      if (!button) continue;
      const selected = diffViewMode === mode;
      button.setAttribute("aria-selected", String(selected));
      button.setAttribute("tabindex", selected ? "0" : "-1");
    }
  }

  function renderDiffSummary(payload) {
    if (!diffSummary) return;
    const workspace = selectedWorkspace();
    const metrics = summarizeDiffPayload(payload);
    if (metrics.files === 0) {
      diffSummary.textContent = translate("workspace.diff.summary.empty");
      return;
    }
    const comments = workspace ? commentsFor(workspace.sessionId).length : 0;
    diffSummary.textContent = [
      translate("workspace.diff.summary.files", { count: metrics.files }),
      translate("workspace.diff.summary.additions", { count: metrics.additions }),
      translate("workspace.diff.summary.deletions", { count: metrics.deletions }),
      translate("workspace.diff.summary.comments", { count: comments }),
      translate("workspace.diff.summary.status", metrics),
    ].join(" · ");
  }

  function clearDiff() {
    diffSequence += 1;
    diffPanel.hidden = true;
    diffTabs.replaceChildren();
    diffFiles.replaceChildren();
    diffContent.textContent = "";
    if (diffSummary) diffSummary.textContent = translate("workspace.diff.summary.empty");
    selectedFile = undefined;
    activeDiffGroup = "all";
    diffViewMode = "unified";
    diffSearchValue = "";
    if (diffSearch) diffSearch.value = "";
    currentDiff = undefined;
    updateDiffViewControls();
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
    if (currentDiff) renderDiffSummary(currentDiff);
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

  function appendCommentAction(cell, workspace, group, anchor) {
    if (!selectedFile || !anchor) return;
    const comment = documentRef.createElement("button");
    comment.type = "button";
    comment.className = "task-workspace-line-action";
    comment.textContent = translate("workspace.comment.add");
    comment.setAttribute("aria-label", translate("workspace.comment.addAt", { path: selectedFile, anchor }));
    comment.addEventListener("click", () => addComment(workspace, selectedFile, anchor, group));
    cell.appendChild(comment);
  }

  function renderUnifiedPatch(workspace, group, patch) {
    for (const entry of parseUnifiedDiff(patch)) {
      const row = documentRef.createElement("div");
      row.className = "task-workspace-diff-line";
      if (entry.kind === "hunk") row.classList.add("is-hunk");
      if (entry.kind === "add") row.classList.add("is-addition");
      if (entry.kind === "delete") row.classList.add("is-deletion");
      const code = documentRef.createElement("code");
      code.textContent = entry.raw || " ";
      row.appendChild(code);
      if ((entry.kind === "add" || entry.kind === "delete") && entry.anchor) {
        appendCommentAction(row, workspace, group, entry.anchor);
      }
      diffContent.appendChild(row);
    }
  }

  function renderSplitPatch(workspace, group, patch) {
    const split = documentRef.createElement("div");
    split.className = "task-workspace-split";
    const appendCode = (cell, text) => {
      const code = documentRef.createElement("code");
      code.textContent = text || " ";
      cell.appendChild(code);
    };
    const appendCell = (row, entry, emptyKind) => {
      const cell = documentRef.createElement("div");
      cell.className = "task-workspace-split-cell";
      cell.dataset.changeKind = entry?.kind ?? emptyKind ?? "context";
      appendCode(cell, entry?.text ?? "");
      if (entry?.anchor) appendCommentAction(cell, workspace, group, entry.anchor);
      row.appendChild(cell);
    };

    const entries = parseUnifiedDiff(patch);
    for (const splitEntry of pairSplitDiffEntries(entries)) {
      const row = documentRef.createElement("div");
      row.className = "task-workspace-split-row";
      row.dataset.kind = splitEntry.kind;
      if (splitEntry.kind === "change") {
        appendCell(row, splitEntry.deletion, "empty");
        appendCell(row, splitEntry.addition, "empty");
      } else if (["hunk", "file", "header", "meta"].includes(splitEntry.kind)) {
        const cell = documentRef.createElement("div");
        cell.className = "task-workspace-split-cell";
        cell.dataset.changeKind = splitEntry.kind;
        appendCode(cell, splitEntry.entry?.raw ?? "");
        row.appendChild(cell);
      } else {
        appendCell(row, splitEntry.entry);
        appendCell(row, splitEntry.entry);
      }
      split.appendChild(row);
    }
    diffContent.appendChild(split);
  }

  function renderPatch(workspace, group, patch) {
    diffContent.dataset.selectedPath = selectedFile ?? "";
    diffContent.dataset.selectedGroup = group;
    diffContent.dataset.viewMode = diffViewMode;
    diffContent.replaceChildren();
    if (diffViewMode === "split") renderSplitPatch(workspace, group, patch);
    else renderUnifiedPatch(workspace, group, patch);
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

  function renderDiffFiles(payload) {
    diffFiles.replaceChildren();
    const files = Array.isArray(payload?.files) ? payload.files.slice(0, DIFF_FILE_LIMIT) : [];
    const allFilesButton = documentRef.createElement("button");
    allFilesButton.type = "button";
    allFilesButton.className = "task-workspace-file-filter";
    allFilesButton.dataset.filePath = "";
    allFilesButton.setAttribute("aria-current", selectedFile === undefined ? "true" : "false");
    allFilesButton.setAttribute("aria-pressed", String(selectedFile === undefined));
    allFilesButton.textContent = translate("workspace.diff.allFiles");
    allFilesButton.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const buttons = [...diffFiles.querySelectorAll("button.task-workspace-file-filter")];
      const index = buttons.indexOf(allFilesButton);
      buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
    });
    allFilesButton.addEventListener("click", () => {
      selectedFile = undefined;
      void compare();
    });
    const allFilesItem = documentRef.createElement("li");
    allFilesItem.appendChild(allFilesButton);
    diffFiles.appendChild(allFilesItem);

    const visibleFiles = filterDiffFiles(payload.files, diffSearchValue);
    if (normalizedDiffSearch(diffSearchValue) && visibleFiles.length === 0 && files.length > 0) {
      const empty = documentRef.createElement("li");
      empty.className = "task-workspace-diff-empty";
      empty.textContent = translate("workspace.diff.noMatches");
      diffFiles.appendChild(empty);
    }
    for (const file of visibleFiles) {
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
      path.className = "task-workspace-file-path";
      path.textContent = file.path;
      const meta = documentRef.createElement("span");
      meta.className = "task-workspace-file-meta";
      const rawStatus = typeof file.status === "string" ? file.status.trim() : "";
      const status = normalizedDiffStatus(rawStatus);
      const statusBadge = documentRef.createElement("span");
      statusBadge.className = "task-workspace-file-status";
      statusBadge.dataset.status = diffStatusTone(rawStatus || status);
      statusBadge.textContent = status;
      statusBadge.setAttribute("aria-label", status);
      meta.appendChild(statusBadge);
      const groups = Array.isArray(file.groups)
        ? file.groups.map((group) => translate(`workspace.diff.${group}`)).filter(Boolean)
        : [];
      if (groups.length > 0) meta.appendChild(documentRef.createTextNode(` · ${groups.join(", ")}`));
      fileButton.append(path, meta);
      fileButton.setAttribute("aria-label", `${file.path} · ${status}${groups.length > 0 ? ` · ${groups.join(", ")}` : ""}`);
      fileButton.addEventListener("click", () => {
        selectedFile = file.path;
        activeDiffGroup = "all";
        void compare(file.path);
      });
      item.appendChild(fileButton);
      diffFiles.appendChild(item);
    }
  }

  function renderDiff(payload) {
    renderDiffSummary(payload);
    renderDiffFiles(payload);
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
    updateDiffViewControls();
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
  diffSearch?.addEventListener("input", () => {
    diffSearchValue = diffSearch.value.slice(0, 256);
    if (currentDiff) renderDiff(currentDiff);
  });
  const setDiffViewMode = (mode) => {
    diffViewMode = mode === "split" ? "split" : "unified";
    updateDiffViewControls();
    if (currentDiff) renderDiff(currentDiff);
  };
  diffViewUnified?.addEventListener("click", () => setDiffViewMode("unified"));
  diffViewSplit?.addEventListener("click", () => setDiffViewMode("split"));
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
