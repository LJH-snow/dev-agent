import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 15_000;
const MAX_OWNER_REPO_CHARS = 100;
const MAX_PR_NUMBER = 2_147_483_647;
const MAX_TARGET_URL_CHARS = 512;
const MAX_TITLE_CHARS = 256;
const MAX_BODY_CHARS = 12_000;
const MAX_ACTOR_CHARS = 96;
const MAX_REF_CHARS = 128;
const MAX_PATH_CHARS = 512;
const MAX_REVIEW_BODY_CHARS = 4_096;
const MAX_COMMENT_BODY_CHARS = 4_096;
const MAX_TIMESTAMP_CHARS = 64;
const MAX_FILES = 100;
const MAX_REVIEWS = 64;
const MAX_COMMENTS = 64;
const MAX_DIFF_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 768 * 1024;
const GH_VIEW_FIELDS = [
  "number",
  "title",
  "body",
  "author",
  "state",
  "isDraft",
  "mergedAt",
  "baseRefName",
  "headRefName",
  "additions",
  "deletions",
  "changedFiles",
  "url",
  "updatedAt",
  "files",
  "reviews",
  "latestReviews",
  "comments",
] as const;

export type GitHubPrReviewState =
  | "ready"
  | "disabled"
  | "cli-unavailable"
  | "unauthenticated"
  | "not-found"
  | "malformed"
  | "oversized"
  | "unavailable";

export type GitHubPrReviewFailureCode =
  | "opt-in-required"
  | "cli-unavailable"
  | "not-authenticated"
  | "not-found"
  | "malformed-response"
  | "response-too-large"
  | "request-failed"
  | "invalid-target";

export interface GitHubPrTarget {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
}

export interface GitHubPrReviewInput {
  readonly url?: unknown;
  readonly owner?: unknown;
  readonly repo?: unknown;
  readonly number?: unknown;
}

export interface GitHubPrReviewFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";
  readonly additions: number;
  readonly deletions: number;
}

export interface GitHubPrReviewEntry {
  readonly author: string;
  readonly state: string;
  readonly body: string;
  readonly submittedAt?: string;
}

export interface GitHubPrCommentEntry {
  readonly author: string;
  readonly body: string;
  readonly path?: string;
  readonly line?: number;
  readonly side?: "LEFT" | "RIGHT";
  readonly createdAt?: string;
  readonly url?: string;
}

export interface GitHubPrReviewSnapshot {
  readonly state: "ready";
  readonly readOnly: true;
  readonly target: GitHubPrTarget;
  readonly pr: {
    readonly number: number;
    readonly title: string;
    readonly body: string;
    readonly author: string;
    readonly state: "open" | "closed" | "merged" | "unknown";
    readonly isDraft: boolean;
    readonly merged: boolean;
    readonly baseRefName: string;
    readonly headRefName: string;
    readonly additions: number;
    readonly deletions: number;
    readonly changedFiles: number;
    readonly url: string;
    readonly updatedAt?: string;
  };
  readonly files: readonly GitHubPrReviewFile[];
  readonly diff: string;
  readonly reviews: readonly GitHubPrReviewEntry[];
  readonly comments: readonly GitHubPrCommentEntry[];
  readonly truncated: boolean;
  readonly limits: {
    readonly maxFiles: number;
    readonly maxDiffBytes: number;
    readonly maxComments: number;
  };
}

export type GitHubPrReviewResult =
  | { readonly ok: true; readonly snapshot: GitHubPrReviewSnapshot }
  | { readonly ok: false; readonly state: Exclude<GitHubPrReviewState, "ready">; readonly code: GitHubPrReviewFailureCode };

export type GitHubPrCommandResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly code?: string | number; readonly stderr?: string };

export type GitHubPrCommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
  maxBuffer: number,
) => Promise<GitHubPrCommandResult>;

export interface LoadGitHubPrReviewOptions {
  readonly enabled?: boolean;
  readonly workingDirectory?: string;
  readonly runCommand?: GitHubPrCommandRunner;
}

export function normalizeGitHubPrTarget(input: unknown): GitHubPrTarget | undefined {
  let owner = "";
  let repo = "";
  let numberValue: unknown;

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
      if (parsed.protocol !== "https:" || !["github.com", "www.github.com"].includes(parsed.hostname.toLowerCase())) {
        return undefined;
      }
      if (parsed.username || parsed.password || parsed.port) return undefined;
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length !== 4 || segments[2]?.toLowerCase() !== "pull" || parsed.search || parsed.hash) return undefined;
      owner = segments[0] ?? "";
      repo = segments[1] ?? "";
      numberValue = segments[3];
    } else {
      const match = value.match(/^([^/\s]+)\/([^/#\s]+)(?:\/|#)(\d+)\/?$/u);
      if (!match) return undefined;
      owner = match[1] ?? "";
      repo = match[2] ?? "";
      numberValue = match[3];
    }
  } else if (isRecord(input)) {
    if (input.url !== undefined) {
      if (typeof input.url !== "string") return undefined;
      const urlTarget = normalizeGitHubPrTarget(input.url);
      if (!urlTarget) return undefined;
      if (input.owner === undefined && input.repo === undefined && input.number === undefined) return urlTarget;
      const objectOwner = typeof input.owner === "string" ? input.owner.trim() : "";
      const objectRepo = typeof input.repo === "string" ? input.repo.trim().replace(/\.git$/iu, "") : "";
      const objectNumber = normalizePrNumber(input.number);
      if (!isValidRepositoryPart(objectOwner) || !isValidRepositoryPart(objectRepo) || objectNumber === undefined) return undefined;
      if (objectOwner !== urlTarget.owner || objectRepo !== urlTarget.repo || objectNumber !== urlTarget.number) return undefined;
      return urlTarget;
    }
    owner = typeof input.owner === "string" ? input.owner.trim() : "";
    repo = typeof input.repo === "string" ? input.repo.trim().replace(/\.git$/iu, "") : "";
    numberValue = input.number;
  } else {
    return undefined;
  }

  if (!isValidRepositoryPart(owner) || !isValidRepositoryPart(repo)) return undefined;
  const number = normalizePrNumber(numberValue);
  if (number === undefined) return undefined;
  return {
    owner,
    repo,
    number,
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
  };
}

export function normalizeGitHubPrReviewSnapshot(value: unknown): GitHubPrReviewSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const target = normalizeGitHubPrTarget(value.target);
  const prRaw = isRecord(value.pr) ? value.pr : undefined;
  if (!target || !prRaw || typeof value.diff !== "string") return undefined;
  const diff = normalizeDiff(value.diff);
  if (diff === undefined) return undefined;

  const title = boundedText(prRaw.title, MAX_TITLE_CHARS);
  const body = boundedText(prRaw.body, MAX_BODY_CHARS);
  const author = normalizeActor(prRaw.author);
  if (title === undefined || body === undefined || author === undefined) return undefined;

  const number = prRaw.number === undefined ? target.number : normalizePrNumber(prRaw.number);
  if (number === undefined || number !== target.number) return undefined;
  const prTarget = prRaw.url === undefined ? target : normalizeGitHubPrTarget(prRaw.url);
  if (!prTarget || prTarget.owner !== target.owner || prTarget.repo !== target.repo || prTarget.number !== target.number) return undefined;
  const url = prTarget.url;
  const files = normalizeFiles(value.files);
  const reviews = normalizeReviews(value.reviews ?? value.latestReviews);
  const comments = normalizeComments(value.comments);
  const updatedAt = normalizeTimestamp(prRaw.updatedAt);
  const merged = prRaw.merged === true
    || Boolean(prRaw.mergedAt)
    || (typeof prRaw.state === "string" && prRaw.state.trim().toLowerCase() === "merged");
  const snapshot: GitHubPrReviewSnapshot = {
    state: "ready",
    readOnly: true,
    target,
    pr: {
      number,
      title,
      body,
      author,
      state: normalizePrState(prRaw.state, merged),
      isDraft: prRaw.isDraft === true,
      merged,
      baseRefName: boundedText(prRaw.baseRefName, MAX_REF_CHARS) ?? "unknown",
      headRefName: boundedText(prRaw.headRefName, MAX_REF_CHARS) ?? "unknown",
      additions: normalizeCount(prRaw.additions),
      deletions: normalizeCount(prRaw.deletions),
      changedFiles: normalizeCount(prRaw.changedFiles, MAX_FILES * 10),
      url,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    },
    files,
    diff,
    reviews,
    comments,
    truncated: value.truncated === true
      || (Array.isArray(value.files) && value.files.length > MAX_FILES)
      || (Array.isArray(value.reviews) && value.reviews.length > MAX_REVIEWS)
      || (Array.isArray(value.latestReviews) && value.latestReviews.length > MAX_REVIEWS)
      || (Array.isArray(value.comments) && value.comments.length > MAX_COMMENTS),
    limits: {
      maxFiles: MAX_FILES,
      maxDiffBytes: MAX_DIFF_BYTES,
      maxComments: MAX_COMMENTS,
    },
  };
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= MAX_RESPONSE_BYTES ? snapshot : undefined;
}

export async function loadGitHubPrReview(
  input: unknown,
  options: LoadGitHubPrReviewOptions = {},
): Promise<GitHubPrReviewResult> {
  const target = normalizeGitHubPrTarget(input);
  if (!target) return { ok: false, state: "malformed", code: "invalid-target" };
  const enabled = options.enabled ?? process.env.DEV_AGENT_DESKTOP_GITHUB === "1";
  if (!enabled) return { ok: false, state: "disabled", code: "opt-in-required" };

  const runCommand = options.runCommand ?? runGhCommand;
  const cwd = options.workingDirectory ?? process.cwd();
  const repo = `${target.owner}/${target.repo}`;
  const viewResult = await runCommand(
    "gh",
    ["pr", "view", String(target.number), "--repo", repo, "--json", GH_VIEW_FIELDS.join(",")],
    cwd,
    256 * 1024,
  );
  if (!viewResult.ok) {
    if (isCommandBufferOverflow(viewResult)) return { ok: false, state: "oversized", code: "response-too-large" };
    return classifyCommandFailure(viewResult);
  }

  let view: unknown;
  try {
    view = JSON.parse(viewResult.stdout);
  } catch {
    return { ok: false, state: "malformed", code: "malformed-response" };
  }
  if (!isRecord(view)) return { ok: false, state: "malformed", code: "malformed-response" };

  const diffResult = await runCommand(
    "gh",
    ["pr", "diff", String(target.number), "--repo", repo, "--patch", "--color", "never"],
    cwd,
    MAX_DIFF_BYTES + 16 * 1024,
  );
  if (!diffResult.ok) {
    if (isCommandBufferOverflow(diffResult)) {
      return { ok: false, state: "oversized", code: "response-too-large" };
    }
    return classifyCommandFailure(diffResult);
  }
  if (Buffer.byteLength(diffResult.stdout, "utf8") > MAX_DIFF_BYTES) {
    return { ok: false, state: "oversized", code: "response-too-large" };
  }

  const snapshot = normalizeGitHubPrReviewSnapshot({
    state: "ready",
    readOnly: true,
    target,
    pr: view,
    files: view.files,
    reviews: view.reviews,
    latestReviews: view.latestReviews,
    comments: view.comments,
    diff: diffResult.stdout,
    truncated: false,
  });
  return snapshot === undefined
    ? { ok: false, state: "malformed", code: "malformed-response" }
    : { ok: true, snapshot };
}

async function runGhCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  maxBuffer: number,
): Promise<GitHubPrCommandResult> {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd,
      timeout: GH_TIMEOUT_MS,
      maxBuffer,
      windowsHide: true,
      encoding: "utf8",
    });
    return { ok: true, stdout: typeof result.stdout === "string" ? result.stdout : "" };
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown };
    const code = typeof candidate.code === "string" || typeof candidate.code === "number" ? candidate.code : undefined;
    return {
      ok: false,
      ...(code === undefined ? {} : { code }),
      ...(typeof candidate.stderr === "string" ? { stderr: candidate.stderr.slice(0, 2048) } : {}),
    };
  }
}

function isCommandBufferOverflow(result: Extract<GitHubPrCommandResult, { ok: false }>): boolean {
  const code = String(result.code ?? "").toLowerCase();
  return code.includes("maxbuffer") || code === "max-buffer";
}

function classifyCommandFailure(result: Extract<GitHubPrCommandResult, { ok: false }>): GitHubPrReviewResult {
  const code = String(result.code ?? "").toLowerCase();
  const stderr = String(result.stderr ?? "").toLowerCase();
  if (code === "enoent") return { ok: false, state: "cli-unavailable", code: "cli-unavailable" };
  if (stderr.includes("not logged in") || stderr.includes("authentication") || stderr.includes("auth login")) {
    return { ok: false, state: "unauthenticated", code: "not-authenticated" };
  }
  if (stderr.includes("could not resolve") || stderr.includes("not found") || stderr.includes("no pull request")) {
    return { ok: false, state: "not-found", code: "not-found" };
  }
  return { ok: false, state: "unavailable", code: "request-failed" };
}

function normalizeFiles(value: unknown): GitHubPrReviewFile[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FILES).flatMap((item) => {
    if (!isRecord(item) || typeof item.path !== "string") return [];
    if (/[\u0000\r\n]/u.test(item.path)) return [];
    const path = boundedText(item.path, MAX_PATH_CHARS);
    if (!path || path.startsWith("/") || path.includes("..")) return [];
    return [{
      path,
      status: normalizeFileStatus(item.status),
      additions: normalizeCount(item.additions),
      deletions: normalizeCount(item.deletions),
    }];
  });
}

function normalizeReviews(value: unknown): GitHubPrReviewEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_REVIEWS).flatMap((item) => {
    if (!isRecord(item)) return [];
    const author = normalizeActor(item.author);
    const body = boundedText(item.body, MAX_REVIEW_BODY_CHARS);
    if (author === undefined || body === undefined) return [];
    const submittedAt = normalizeTimestamp(item.submittedAt ?? item.createdAt);
    return [{
      author,
      state: boundedText(item.state, 48)?.toUpperCase() ?? "UNKNOWN",
      body,
      ...(submittedAt === undefined ? {} : { submittedAt }),
    }];
  });
}

function normalizeComments(value: unknown): GitHubPrCommentEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_COMMENTS).flatMap((item) => {
    if (!isRecord(item)) return [];
    const author = normalizeActor(item.author);
    const body = boundedText(item.body, MAX_COMMENT_BODY_CHARS);
    if (author === undefined || body === undefined) return [];
    const path = boundedText(item.path, MAX_PATH_CHARS);
    const line = normalizeLine(item.line);
    const side = item.side === "LEFT" || item.side === "RIGHT" ? item.side : undefined;
    const createdAt = normalizeTimestamp(item.createdAt);
    const url = normalizeGitHubUrl(item.url);
    return [{
      author,
      body,
      ...(path && !/[\u0000\r\n]/u.test(path) && !path.startsWith("/") && !path.includes("..") ? { path } : {}),
      ...(line === undefined ? {} : { line }),
      ...(side === undefined ? {} : { side }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(url === undefined ? {} : { url }),
    }];
  });
}

function normalizeFileStatus(value: unknown): GitHubPrReviewFile["status"] {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (normalized === "added" || normalized === "modified" || normalized === "deleted" || normalized === "renamed" || normalized === "copied") {
    return normalized;
  }
  return "unknown";
}

function normalizePrState(value: unknown, merged: boolean): GitHubPrReviewSnapshot["pr"]["state"] {
  if (merged) return "merged";
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (normalized === "merged") return "merged";
  return normalized === "open" || normalized === "closed" ? normalized : "unknown";
}

function normalizeDiff(value: string): string | undefined {
  if (/\u0000/u.test(value)) return undefined;
  return Buffer.byteLength(value, "utf8") <= MAX_DIFF_BYTES ? value : undefined;
}

function normalizeGitHubUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_TARGET_URL_CHARS) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !["github.com", "www.github.com"].includes(parsed.hostname.toLowerCase())) return undefined;
    if (parsed.username || parsed.password || parsed.port) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeActor(value: unknown): string | undefined {
  if (typeof value === "string") return boundedText(value, MAX_ACTOR_CHARS);
  if (isRecord(value)) return boundedText(value.login ?? value.name, MAX_ACTOR_CHARS);
  return undefined;
}

function boundedText(value: unknown, maxChars: number): string | undefined {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return undefined;
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .slice(0, maxChars);
}

function normalizeTimestamp(value: unknown): string | undefined {
  const timestamp = boundedText(value, MAX_TIMESTAMP_CHARS);
  if (!timestamp) return undefined;
  return /^\d{4}-\d{2}-\d{2}T[^\r\n]{1,48}Z$/u.test(timestamp) ? timestamp : undefined;
}

function normalizeCount(value: unknown, maximum = 1_000_000_000): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

function normalizeLine(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 10_000_000) return undefined;
  return value;
}

function normalizePrNumber(value: unknown): number | undefined {
  const candidate = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number(value.trim())
      : NaN;
  return Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= MAX_PR_NUMBER ? candidate : undefined;
}

function isValidRepositoryPart(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_OWNER_REPO_CHARS
    && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value)
    && value !== "."
    && value !== ".."
    && !/[\u0000\r\n]/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
