import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SHA = /^[a-f0-9]{40}$/iu;
const MAX_OWNER_REPO_CHARS = 100;
const MAX_TARGET_URL_CHARS = 512;
const MAX_PRS = 25;
const MAX_CHECKS_PER_PR = 64;
const MAX_PR_NUMBER = 2_147_483_647;
const MAX_TITLE_CHARS = 256;
const MAX_ACTOR_CHARS = 96;
const MAX_REF_CHARS = 128;
const MAX_TIMESTAMP_CHARS = 64;
const MAX_RESPONSE_BYTES = 256 * 1024;
const PR_LIST_FIELDS = [
  "number",
  "title",
  "isDraft",
  "author",
  "state",
  "headRefName",
  "headRefOid",
  "statusCheckRollup",
  "updatedAt",
  "url",
] as const;

export type GitHubCheckState = "passed" | "failed" | "pending" | "unknown";

export interface GitHubCheckRollup {
  readonly passed: number;
  readonly failed: number;
  readonly pending: number;
  readonly unknown: number;
  readonly total: number;
  readonly verdict: "passing" | "failing" | "pending" | "unknown" | "none";
}

export interface GitHubRepoTarget {
  readonly owner: string;
  readonly repo: string;
  readonly url: string;
}

export interface GitHubPrListEntry {
  readonly number: number;
  readonly title: string;
  readonly isDraft: boolean;
  readonly state: "open" | "unknown";
  readonly author: string;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly url: string;
  readonly updatedAt?: string;
  readonly checks: GitHubCheckRollup;
}

export interface GitHubPrListSnapshot {
  readonly readOnly: true;
  readonly repo: GitHubRepoTarget;
  readonly prs: readonly GitHubPrListEntry[];
  readonly truncated: boolean;
}

export interface GitHubPrListInput {
  readonly url?: unknown;
  readonly owner?: unknown;
  readonly repo?: unknown;
}

export type GitHubPrListCommandResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly code?: string | number };

export type GitHubPrListCommandRunner = (
  command: string,
  args: readonly string[],
  cwd?: string,
) => Promise<GitHubPrListCommandResult>;

export type GitHubPrListResult =
  | { readonly ok: true; readonly snapshot: GitHubPrListSnapshot }
  | { readonly ok: false; readonly code: "opt-in-required" | "invalid-target" | "cli-unavailable" | "request-failed" | "response-too-large" | "malformed-response" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").slice(0, maxChars) : "";
}

function isValidRepositoryPart(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_OWNER_REPO_CHARS
    && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value)
    && value !== "."
    && value !== ".."
    && !/[\u0000\r\n]/u.test(value);
}

function normalizePrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_PR_NUMBER ? value : undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  const timestamp = boundedText(value, MAX_TIMESTAMP_CHARS);
  return /^\d{4}-\d{2}-\d{2}T[^\r\n]{1,48}Z$/u.test(timestamp) ? timestamp : undefined;
}

export function normalizeGitHubRepoTarget(input: unknown): GitHubRepoTarget | undefined {
  let owner = "";
  let repo = "";
  if (typeof input === "string") {
    const value = input.trim();
    if (!value || value.length > MAX_TARGET_URL_CHARS) return undefined;
    if (/^https?:\/\//iu.test(value)) {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return undefined;
      }
      if (parsed.protocol !== "https:" || !["github.com", "www.github.com"].includes(parsed.hostname.toLowerCase())
        || parsed.username || parsed.password || parsed.port) return undefined;
      const segments = parsed.pathname.split("/").filter(Boolean);
      owner = segments[0] ?? "";
      repo = (segments[1] ?? "").replace(/\.git$/iu, "");
    } else {
      const match = value.match(/^([^/\s#]+)\/([^/#\s]+?)(?:#\d+)?\/?$/u);
      if (!match) return undefined;
      owner = match[1] ?? "";
      repo = (match[2] ?? "").replace(/\.git$/iu, "");
    }
  } else if (isRecord(input)) {
    owner = typeof input.owner === "string" ? input.owner.trim() : "";
    repo = typeof input.repo === "string" ? input.repo.trim().replace(/\.git$/iu, "") : "";
    if ((!owner || !repo) && typeof input.url === "string") {
      const fromUrl = normalizeGitHubRepoTarget(input.url);
      if (fromUrl) {
        owner = fromUrl.owner;
        repo = fromUrl.repo;
      }
    }
  } else {
    return undefined;
  }
  if (!isValidRepositoryPart(owner) || !isValidRepositoryPart(repo)) return undefined;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

/**
 * Collapse one statusCheckRollup item into a single check state. gh emits
 * several item shapes depending on version: `gh pr checks` buckets, CheckRun
 * conclusion/status pairs, and StatusContext states. Unknown shapes must not
 * silently count as failures or successes.
 */
export function classifyCheckItem(item: unknown): GitHubCheckState {
  if (!isRecord(item)) return "unknown";
  const bucket = typeof item.bucket === "string" ? item.bucket.toLowerCase() : "";
  if (bucket === "pass" || bucket === "skipping") return "passed";
  if (bucket === "fail") return "failed";
  if (bucket === "pending") return "pending";
  const conclusion = typeof item.conclusion === "string" ? item.conclusion.toLowerCase() : "";
  if (["success", "neutral", "skipped"].includes(conclusion)) return "passed";
  if (["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(conclusion)) return "failed";
  const state = typeof item.state === "string" ? item.state.toLowerCase() : "";
  if (state === "success") return "passed";
  if (state === "failure" || state === "error") return "failed";
  if (["error"].includes(conclusion)) return "failed";
  const status = typeof item.status === "string" ? item.status.toLowerCase() : "";
  if (["in_progress", "queued", "pending", "waiting", "expected"].includes(state)
    || ["in_progress", "queued", "pending", "waiting"].includes(status)) return "pending";
  return "unknown";
}

/**
 * Pure rollup used by the delivery loop panel and (later) repair verification.
 * Severity order: failing > pending > unknown > passing; empty rolls up to none.
 */
export function summarizeCheckRollup(items: readonly unknown[]): GitHubCheckRollup {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let unknown = 0;
  for (const item of items.slice(0, MAX_CHECKS_PER_PR)) {
    const state = classifyCheckItem(item);
    if (state === "passed") passed += 1;
    else if (state === "failed") failed += 1;
    else if (state === "pending") pending += 1;
    else unknown += 1;
  }
  const total = passed + failed + pending + unknown;
  const verdict: GitHubCheckRollup["verdict"] = failed > 0 ? "failing"
    : pending > 0 ? "pending"
    : unknown > 0 ? "unknown"
    : passed > 0 ? "passing"
    : "none";
  return { passed, failed, pending, unknown, total, verdict };
}

function normalizePrListUrl(value: unknown, target: GitHubRepoTarget, number: number): string {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password || parsed.port
      || parsed.search || parsed.hash
      || parsed.pathname !== `/${target.owner}/${target.repo}/pull/${number}`) return "";
    return parsed.href.slice(0, MAX_TARGET_URL_CHARS);
  } catch {
    return "";
  }
}

export function normalizeGitHubPrListSnapshot(value: unknown): GitHubPrListSnapshot | undefined {
  if (!isRecord(value) || value.readOnly !== true || !Array.isArray(value.prs)) return undefined;
  const repo = normalizeGitHubRepoTarget(value.repo);
  if (!repo) return undefined;
  const prs = value.prs.slice(0, MAX_PRS).flatMap((item) => {
    if (!isRecord(item)) return [];
    const number = normalizePrNumber(item.number);
    if (number === undefined) return [];
    const rollup = summarizeCheckRollup(Array.isArray(item.statusCheckRollup) ? item.statusCheckRollup : []);
    const url = normalizePrListUrl(item.url, repo, number);
    if (!url) return [];
    const entry: GitHubPrListEntry = {
      number,
      title: boundedText(item.title, MAX_TITLE_CHARS),
      isDraft: item.isDraft === true,
      state: item.state === "open" || item.state === "OPEN" ? "open" : "unknown",
      author: isRecord(item.author) ? boundedText(item.author.login ?? item.author.name, MAX_ACTOR_CHARS) : boundedText(item.author, MAX_ACTOR_CHARS),
      headRefName: boundedText(item.headRefName, MAX_REF_CHARS),
      headRefOid: typeof item.headRefOid === "string" && SHA.test(item.headRefOid) ? item.headRefOid.toLowerCase() : "",
      url,
      ...(normalizeTimestamp(item.updatedAt) === undefined ? {} : { updatedAt: normalizeTimestamp(item.updatedAt) }),
      checks: rollup,
    };
    return [entry];
  });
  const snapshot: GitHubPrListSnapshot = {
    readOnly: true,
    repo,
    prs,
    truncated: value.truncated === true || value.prs.length > MAX_PRS,
  };
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= MAX_RESPONSE_BYTES ? snapshot : undefined;
}

async function runGh(command: string, args: readonly string[], cwd?: string): Promise<GitHubPrListCommandResult> {
  try {
    const response = await execFileAsync(command, [...args], {
      cwd, timeout: 15_000, maxBuffer: MAX_RESPONSE_BYTES, encoding: "utf8", windowsHide: true,
    });
    return { ok: true, stdout: response.stdout };
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    return { ok: false, ...(candidate.code === undefined ? {} : { code: candidate.code }) };
  }
}

export async function loadGitHubPrList(input: unknown, options: {
  readonly enabled?: boolean;
  readonly workingDirectory?: string;
  readonly runCommand?: GitHubPrListCommandRunner;
} = {}): Promise<GitHubPrListResult> {
  const repo = normalizeGitHubRepoTarget(input);
  if (!repo) return { ok: false, code: "invalid-target" };
  if (!(options.enabled ?? process.env.DEV_AGENT_DESKTOP_GITHUB === "1")) return { ok: false, code: "opt-in-required" };
  const runCommand = options.runCommand ?? runGh;
  const result = await runCommand(
    "gh",
    ["pr", "list", "--repo", `${repo.owner}/${repo.repo}`, "--state", "open",
      "--json", PR_LIST_FIELDS.join(","), "--limit", String(MAX_PRS)],
    options.workingDirectory,
  );
  if (!result.ok) return { ok: false, code: result.code === "ENOENT" ? "cli-unavailable" : "request-failed" };
  if (Buffer.byteLength(result.stdout) > MAX_RESPONSE_BYTES) return { ok: false, code: "response-too-large" };
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return { ok: false, code: "malformed-response" };
  }
  if (!Array.isArray(raw)) return { ok: false, code: "malformed-response" };
  const snapshot = normalizeGitHubPrListSnapshot({ readOnly: true, repo, prs: raw, truncated: raw.length > MAX_PRS });
  return snapshot ? { ok: true, snapshot } : { ok: false, code: "response-too-large" };
}
