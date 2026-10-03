const MAX_ROWS = 25;
const MAX_PROMPT_SAFE = 1024;
const TOKEN = /\b(?:gh[pousr]|sk|pk|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gi;
const SECRET = /\b((?:api[_-]?key|access[_-]?token|authorization|cookie|password|passphrase|secret|token)\s*[:=]\s*)[^\s,;]+/gi;
function clean(value, limit = MAX_PROMPT_SAFE) {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").replace(SECRET, "$1[redacted]").replace(TOKEN, "[redacted-token]").slice(0, limit) : "";
}
function repoFromUrl(value) {
  const text = clean(value, 512).trim();
  if (!text) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (parsed.protocol !== "https:" || !["github.com", "www.github.com"].includes(parsed.hostname.toLowerCase())
      || parsed.username || parsed.password || parsed.port) return "";
    const segments = parsed.pathname.split("/").filter(Boolean);
    const owner = segments[0], repo = (segments[1] ?? "").replace(/\.git$/i, "");
    return owner && repo && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(owner) && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo)
      ? `${owner}/${repo}` : "";
  } catch { return ""; }
}
export function createGitHubDeliveryLoopUI({
  documentRef = globalThis.document,
  fetcher = globalThis.fetch?.bind(globalThis),
  translate = (key) => key,
  getSessionId = () => "desktop-default",
  getFallbackRepo = () => "",
  onPrSelected = () => {},
} = {}) {
  const panel = documentRef?.getElementById("github-delivery-loop-panel");
  const repoInput = documentRef?.getElementById("github-delivery-loop-repo");
  const form = documentRef?.getElementById("github-delivery-loop-form");
  const loadButton = documentRef?.getElementById("github-delivery-loop-load");
  const verifyButton = documentRef?.getElementById("github-delivery-loop-verify");
  const statusNode = documentRef?.getElementById("github-delivery-loop-status");
  const listNode = documentRef?.getElementById("github-delivery-loop-prs");
  const lineageNode = documentRef?.getElementById("github-delivery-loop-lineage");
  const verificationNode = documentRef?.getElementById("github-delivery-loop-verification");
  let snapshot;
  let requestSequence = 0;
  let verifySequence = 0;
  let lineageSequence = 0;
  let busy = false;
  let verifying = false;
  let lineage;
  let verification;
  let activeSessionId = sessionId();
  let status = "githubDeliveryLoop.ready";
  let selectedNumber = 0;
  const t = (key) => { try { return translate(key); } catch { return key; } };
  function sessionId() { try { return clean(getSessionId(), 512) || "desktop-default"; } catch { return "desktop-default"; } }
  const requestedRepo = () => clean(repoInput?.value, 512).trim() || clean(getFallbackRepo(), 512).trim();
  function checksLabel(checks) {
    const parts = [];
    if (checks.passed) parts.push(`✓${checks.passed}`);
    if (checks.failed) parts.push(`✗${checks.failed}`);
    if (checks.pending) parts.push(`•${checks.pending}`);
    if (checks.unknown) parts.push(`?${checks.unknown}`);
    return parts.length ? parts.join(" ") : t("githubDeliveryLoop.noChecks");
  }
  function rowLabel(entry) {
    const bits = [`#${entry.number} ${clean(entry.title, 256) || t("githubDeliveryLoop.untitled")}`];
    if (entry.isDraft) bits.push(t("githubDeliveryLoop.draft"));
    if (entry.headRefName) bits.push(clean(entry.headRefName, 128));
    if (entry.author) bits.push(clean(entry.author, 96));
    bits.push(checksLabel(entry.checks || {}), t(`githubDeliveryLoop.verdict.${entry.checks?.verdict || "none"}`));
    if (entry.updatedAt) bits.push(clean(entry.updatedAt, 64));
    return bits.join(" · ");
  }
  function list(entries) {
    if (!listNode) return;
    listNode.replaceChildren();
    if (!entries.length) {
      const item = documentRef.createElement("li");
      item.textContent = t(status === "githubDeliveryLoop.loaded" ? "githubDeliveryLoop.noPulls" : "githubDeliveryLoop.empty");
      listNode.append(item);
      return;
    }
    for (const entry of entries) {
      const item = documentRef.createElement("li");
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "github-delivery-loop-item";
      button.textContent = rowLabel(entry);
      button.dataset.prNumber = String(entry.number);
      if (entry.number === selectedNumber) button.dataset.selected = "true";
      button.addEventListener("click", () => { selectPr(entry); });
      item.append(button);
      listNode.append(item);
    }
  }
  function renderVerification() {
    if (!verificationNode) return;
    verificationNode.replaceChildren();
    if (!verification) return;
    const verdict = documentRef.createElement("div");
    verdict.className = "github-delivery-loop-verification-verdict";
    verdict.textContent = `${t(`githubDeliveryLoop.verification.${verification.verdict || "inconclusive"}`)}${verification.stale ? ` · ${t("githubDeliveryLoop.stale")}` : ""}`;
    verificationNode.append(verdict);
    for (const row of (Array.isArray(verification.rows) ? verification.rows : []).slice(0, 16)) {
      const item = documentRef.createElement("div");
      item.className = "github-delivery-loop-verification-row";
      item.textContent = `${clean(row.workflow, 160) || "?"}/${clean(row.name, 160) || "?"}: `
        + `${t(`githubDeliveryLoop.state.${row.before || "unknown"}`)} → ${t(`githubDeliveryLoop.state.${row.after || "unknown"}`)}`;
      verificationNode.append(item);
    }
    if (verification.verifiedAt) {
      const stamp = documentRef.createElement("div");
      stamp.className = "github-delivery-loop-verification-stamp";
      stamp.textContent = `${t("githubDeliveryLoop.verifiedAt")} ${clean(verification.verifiedAt, 64)}`;
      verificationNode.append(stamp);
    }
  }
  function render() {
    if (!panel) return;
    const entries = Array.isArray(snapshot?.prs) ? snapshot.prs.slice(0, MAX_ROWS) : [];
    panel.dataset.state = snapshot ? (snapshot.truncated ? "truncated" : "loaded") : "idle";
    if (statusNode) statusNode.textContent = t(status);
    list(entries);
    if (loadButton) loadButton.disabled = busy;
    if (verifyButton) verifyButton.disabled = busy || verifying || !lineage;
    if (lineageNode) {
      lineageNode.textContent = lineage
        ? `${t("githubDeliveryLoop.repairFor")} ${clean(lineage.prUrl, 512)} · ${t("githubDeliveryLoop.head")}: ${clean(lineage.failedSha, 40)}`
        : t("githubDeliveryLoop.noLineage");
    }
    renderVerification();
  }
  async function load() {
    const repo = requestedRepo();
    if (!repo) { status = "githubDeliveryLoop.invalidTarget"; render(); return false; }
    if (typeof fetcher !== "function" || busy) { status = "githubDeliveryLoop.error"; render(); return false; }
    const normalized = repoUrl(repo);
    if (!snapshot || typeof normalized !== "object" || snapshot.repo?.url !== normalized.url) snapshot = undefined;
    const current = sessionId(); activeSessionId = current;
    const requestId = ++requestSequence;
    busy = true; status = "githubDeliveryLoop.loading"; render();
    try {
      const response = await fetcher("/api/github/pr-list", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: repo }) });
      const payload = await response.json().catch(() => ({}));
      if (requestId !== requestSequence || current !== sessionId() || requestedRepo() !== repo) return false;
      if (!response.ok || payload?.snapshot?.readOnly !== true || !Array.isArray(payload.snapshot.prs)
        || typeof normalized !== "object" || payload.snapshot.repo?.owner !== normalized.owner) {
        snapshot = undefined;
        status = ({ "opt-in-required": "githubDeliveryLoop.optIn", "cli-unavailable": "githubDeliveryLoop.cliUnavailable",
          "invalid-target": "githubDeliveryLoop.invalidTarget", "response-too-large": "githubDeliveryLoop.tooLarge" })[payload?.code]
          || "githubDeliveryLoop.error";
        render(); return false;
      }
      snapshot = payload.snapshot;
      selectedNumber = 0;
      status = "githubDeliveryLoop.loaded";
      render(); return true;
    } catch {
      if (requestId !== requestSequence) return false;
      snapshot = undefined; status = "githubDeliveryLoop.error"; render(); return false;
    } finally {
      if (requestId === requestSequence) { busy = false; render(); }
    }
  }
  async function refreshLineage() {
    if (typeof fetcher !== "function") return false;
    const current = sessionId();
    const id = ++lineageSequence;
    try {
      const response = await fetcher(`/api/github/repair-lineage?sessionId=${encodeURIComponent(current)}`);
      const payload = await response.json().catch(() => ({}));
      if (id !== lineageSequence || current !== sessionId()) return false;
      if (!response.ok) {
        if (lineage || verification) { lineage = undefined; verification = undefined; render(); }
        return false;
      }
      if (payload?.sessionId !== current || typeof payload?.prUrl !== "string" || typeof payload?.failedSha !== "string") return false;
      lineage = payload;
      verification = payload.lastVerification && typeof payload.lastVerification.verdict === "string"
        ? { ...payload.lastVerification, verifiedAt: payload.lastVerifiedAt } : undefined;
      render(); return true;
    } catch { return false; }
  }
  async function verify() {
    if (verifying || busy || !lineage) { render(); return false; }
    const current = sessionId();
    const id = ++verifySequence;
    verifying = true; status = "githubDeliveryLoop.verifyBusy"; render();
    try {
      const response = await fetcher("/api/github/repair-verify", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: current }) });
      const payload = await response.json().catch(() => ({}));
      if (id !== verifySequence || current !== sessionId()) return false;
      if (!response.ok || typeof payload?.verification?.verdict !== "string") {
        status = ({ "no-lineage": "githubDeliveryLoop.noLineage", "opt-in-required": "githubDeliveryLoop.optIn" })[payload?.code]
          || "githubDeliveryLoop.verifyError";
        render(); return false;
      }
      verification = { ...payload.verification, verifiedAt: payload.verifiedAt };
      lineage = { ...lineage, lastVerification: payload.verification };
      status = "githubDeliveryLoop.verified";
      render(); return true;
    } catch {
      if (id !== verifySequence) return false;
      status = "githubDeliveryLoop.verifyError"; render(); return false;
    } finally { if (id === verifySequence) { verifying = false; render(); } }
  }
  function selectPr(entry) {
    if (!entry || typeof entry.number !== "number" || typeof entry.url !== "string" || !entry.url) return false;
    selectedNumber = entry.number;
    render();
    onPrSelected(entry);
    return true;
  }
  function sessionChanged() {
    if (activeSessionId === sessionId()) { render(); return; }
    requestSequence++; verifySequence++; lineageSequence++; busy = false; verifying = false;
    activeSessionId = sessionId(); snapshot = undefined; selectedNumber = 0;
    lineage = undefined; verification = undefined;
    status = "githubDeliveryLoop.ready"; render();
    void refreshLineage();
  }
  verifyButton?.addEventListener("click", () => { void verify(); });
  form?.addEventListener("submit", (event) => { event.preventDefault(); void load(); });
  repoInput?.addEventListener("input", () => {
    const normalized = repoUrl(requestedRepo());
    if (typeof normalized !== "object" || normalized.url !== snapshot?.repo?.url) {
      requestSequence++; busy = false; snapshot = undefined; selectedNumber = 0; status = "githubDeliveryLoop.ready";
    }
    render();
  });
  render();
  return { load, render, sessionChanged, selectPr, refreshLineage, verify, getSnapshot: () => snapshot, getVerification: () => verification };
}
function repoUrl(repo) {
  if (repo && typeof repo === "object") return { owner: repo.owner, repo: repo.repo, url: repo.url };
  const text = typeof repo === "string" ? repo.trim() : "";
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const owner = segments[0], name = (segments[1] ?? "").replace(/\.git$/i, "");
      return owner && name ? { owner, repo: name, url: `https://github.com/${owner}/${name}` } : "";
    } catch { return ""; }
  }
  const match = text.match(/^([^/\s#]+)\/([^/#\s]+?)(?:#\d+)?\/?$/);
  return match ? { owner: match[1], repo: match[2], url: `https://github.com/${match[1]}/${match[2]}` } : "";
}
