import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeGitHubPrTarget, type GitHubPrTarget } from "./github-pr-review.js";

const executeFile = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/iu;
const MAX_CHECKS = 64;
const MAX_RUNS = 3;
const MAX_LOG_BYTES = 24 * 1024;
const MAX_RESPONSE_BYTES = 96 * 1024;
const TOKEN = /\b(?:gh[pousr]|sk|pk|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/giu;
const SECRET = /\b((?:api[_-]?key|access[_-]?token|authorization|cookie|password|passphrase|secret|token)\s*[:=]\s*)[^\s,;]+/giu;
const BEARER = /\bBearer\s+\S+/giu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function safe(value: unknown, max: number): string {
  return typeof value !== "string" ? "" : value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, " ")
    .replace(BEARER, "Bearer [redacted]").replace(SECRET, "$1[redacted]").replace(TOKEN, "[redacted-token]").slice(0, max);
}
function safeUrl(value: unknown, repo: GitHubPrTarget): string {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password || parsed.port
      || !parsed.pathname.startsWith(`/${repo.owner}/${repo.repo}/actions/runs/`)) return "";
    return parsed.href.slice(0, 512);
  } catch { return ""; }
}
export type CiCommandResult = { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly code?: string | number; readonly stdout?: string };
export type CiCommandRunner = (command: string, args: readonly string[], cwd?: string) => Promise<CiCommandResult>;
export interface CiDiagnosisSnapshot {
  readonly readOnly: true;
  readonly target: GitHubPrTarget;
  readonly headSha: string;
  readonly stale: boolean;
  readonly evidence: "stale" | "failure-log" | "checks-only" | "none";
  readonly checks: readonly { readonly name: string; readonly state: "passed" | "failed" | "pending" | "unknown"; readonly workflow: string; readonly url: string }[];
  readonly runs: readonly { readonly id: number; readonly name: string; readonly url: string; readonly failedLog: string; readonly logTruncated: boolean }[];
  readonly truncated: boolean;
}
export type CiDiagnosisResult = { readonly ok: true; readonly snapshot: CiDiagnosisSnapshot } | { readonly ok: false; readonly code: "opt-in-required" | "invalid-target" | "cli-unavailable" | "request-failed" | "response-too-large" | "malformed-response" };

export function normalizeCiDiagnosisSnapshot(value: unknown): CiDiagnosisSnapshot | undefined {
  if (!isRecord(value) || value.readOnly !== true || typeof value.headSha !== "string" || !SHA.test(value.headSha)
    || typeof value.stale !== "boolean" || !Array.isArray(value.checks) || !Array.isArray(value.runs)) return undefined;
  const target = normalizeGitHubPrTarget(value.target);
  if (!target) return undefined;
  const checks = value.checks.slice(0, MAX_CHECKS).flatMap((item) => {
    if (!isRecord(item)) return [];
    const state: "passed" | "failed" | "pending" | "unknown" = item.state === "passed" || item.state === "failed" || item.state === "pending" ? item.state : "unknown";
    return [{ name: safe(item.name, 160), state, workflow: safe(item.workflow, 160), url: safeUrl(item.url, target) }];
  });
  const runs = value.runs.slice(0, MAX_RUNS).flatMap((item) => {
    if (!isRecord(item) || !Number.isSafeInteger(item.id) || Number(item.id) <= 0) return [];
    return [{ id: Number(item.id), name: safe(item.name, 160), url: safeUrl(item.url, target),
      failedLog: safe(item.failedLog, MAX_LOG_BYTES), logTruncated: item.logTruncated === true || Buffer.byteLength(String(item.failedLog ?? "")) > MAX_LOG_BYTES }];
  });
  const stale = value.stale;
  const snapshot: CiDiagnosisSnapshot = {
    readOnly: true, target, headSha: value.headSha.toLowerCase(), stale,
    evidence: stale ? "stale" : runs.some((run) => run.failedLog.trim()) ? "failure-log"
      : checks.some((check) => check.state === "failed") ? "checks-only" : "none",
    checks, runs: stale ? [] : runs,
    truncated: value.truncated === true || value.checks.length > MAX_CHECKS || value.runs.length > MAX_RUNS || runs.some((run) => run.logTruncated),
  };
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= MAX_RESPONSE_BYTES ? snapshot : undefined;
}

async function runGh(command: string, args: readonly string[], cwd?: string): Promise<CiCommandResult> {
  try {
    const response = await executeFile(command, [...args], { cwd, timeout: 15_000, maxBuffer: MAX_RESPONSE_BYTES, encoding: "utf8", windowsHide: true });
    return { ok: true, stdout: response.stdout };
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    return { ok: false, ...(candidate.code === undefined ? {} : { code: candidate.code }),
      ...(typeof (candidate as NodeJS.ErrnoException & { stdout?: unknown }).stdout === "string"
        ? { stdout: (candidate as NodeJS.ErrnoException & { stdout: string }).stdout.slice(0, MAX_RESPONSE_BYTES) } : {}) };
  }
}

export async function loadGitHubCiDiagnosis(input: unknown, options: {
  readonly enabled?: boolean;
  readonly expectedSha?: string;
  readonly workingDirectory?: string;
  readonly runCommand?: CiCommandRunner;
} = {}): Promise<CiDiagnosisResult> {
  const target = normalizeGitHubPrTarget(input);
  if (!target) return { ok: false, code: "invalid-target" };
  if (!(options.enabled ?? process.env.DEV_AGENT_DESKTOP_GITHUB === "1")) return { ok: false, code: "opt-in-required" };
  if (options.expectedSha !== undefined && !SHA.test(options.expectedSha)) return { ok: false, code: "invalid-target" };
  const runCommand = options.runCommand ?? runGh;
  const repo = `${target.owner}/${target.repo}`;
  const invoke = (args: readonly string[]) => runCommand("gh", args, options.workingDirectory);
  try {
    const view = await invoke(["pr", "view", String(target.number), "--repo", repo, "--json", "headRefOid,title,url"]);
    if (!view.ok) return { ok: false, code: view.code === "ENOENT" ? "cli-unavailable" : "request-failed" };
    if (Buffer.byteLength(view.stdout) > MAX_RESPONSE_BYTES) return { ok: false, code: "response-too-large" };
    const pr = JSON.parse(view.stdout);
    if (!isRecord(pr) || typeof pr.headRefOid !== "string" || !SHA.test(pr.headRefOid) || pr.url !== target.url) return { ok: false, code: "malformed-response" };
    const headSha = pr.headRefOid.toLowerCase();
    if (options.expectedSha && headSha !== options.expectedSha.toLowerCase()) {
      return { ok: true, snapshot: { readOnly: true, target, headSha, stale: true, evidence: "stale", checks: [], runs: [], truncated: false } };
    }
    const checked = await invoke(["pr", "checks", String(target.number), "--repo", repo, "--json", "name,state,bucket,link,workflow"]);
    if (!checked.ok && !((checked.code === 1 || checked.code === 8) && typeof checked.stdout === "string")) return { ok: false, code: checked.code === "ENOENT" ? "cli-unavailable" : "request-failed" };
    if (typeof checked.stdout !== "string") return { ok: false, code: "malformed-response" };
    if (Buffer.byteLength(checked.stdout) > MAX_RESPONSE_BYTES) return { ok: false, code: "response-too-large" };
    const rawChecks = JSON.parse(checked.stdout);
    if (!Array.isArray(rawChecks)) return { ok: false, code: "malformed-response" };
    const checks: CiDiagnosisSnapshot["checks"] = rawChecks.slice(0, MAX_CHECKS).map((item) => ({
      name: item?.name, state: item?.bucket === "fail" ? "failed" : item?.bucket === "pass" ? "passed" : item?.bucket === "pending" ? "pending" : "unknown",
      workflow: item?.workflow, url: item?.link,
    }));
    const listed = await invoke(["run", "list", "--repo", repo, "--commit", headSha, "--json", "databaseId,headSha,conclusion,status,name,url", "--limit", "20"]);
    if (!listed.ok) return { ok: false, code: listed.code === "ENOENT" ? "cli-unavailable" : "request-failed" };
    if (Buffer.byteLength(listed.stdout) > MAX_RESPONSE_BYTES) return { ok: false, code: "response-too-large" };
    const rawRuns = JSON.parse(listed.stdout);
    if (!Array.isArray(rawRuns)) return { ok: false, code: "malformed-response" };
    const failed = rawRuns.filter((item) => isRecord(item) && item.headSha === headSha && item.conclusion === "failure"
      && Number.isSafeInteger(item.databaseId) && Number(item.databaseId) > 0).slice(0, MAX_RUNS);
    const runs = [];
    for (const run of failed) {
      const log = await invoke(["run", "view", String(run.databaseId), "--repo", repo, "--log-failed"]);
      if (!log.ok && log.code === "ENOENT") return { ok: false, code: "cli-unavailable" };
      const overflow = !log.ok && log.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      const logText = log.ok || overflow ? log.stdout ?? "" : "";
      runs.push({ id: run.databaseId, name: run.name, url: run.url,
        failedLog: logText, logTruncated: overflow || Buffer.byteLength(logText) > MAX_LOG_BYTES });
    }
    // A PR can receive a new commit while checks and logs are being fetched.
    // Do not present evidence from the old commit as if it describes the current head.
    const latest = await invoke(["pr", "view", String(target.number), "--repo", repo, "--json", "headRefOid,title,url"]);
    if (!latest.ok) return { ok: false, code: latest.code === "ENOENT" ? "cli-unavailable" : "request-failed" };
    if (Buffer.byteLength(latest.stdout) > MAX_RESPONSE_BYTES) return { ok: false, code: "response-too-large" };
    const latestPr = JSON.parse(latest.stdout);
    if (!isRecord(latestPr) || latestPr.url !== target.url || typeof latestPr.headRefOid !== "string" || !SHA.test(latestPr.headRefOid))
      return { ok: false, code: "malformed-response" };
    if (latestPr.headRefOid.toLowerCase() !== headSha) {
      return { ok: true, snapshot: { readOnly: true, target, headSha: latestPr.headRefOid.toLowerCase(), stale: true,
        evidence: "stale", checks: [], runs: [], truncated: false } };
    }
    const snapshot = normalizeCiDiagnosisSnapshot({ readOnly: true, target, headSha, stale: false,
      checks, runs, truncated: rawChecks.length > MAX_CHECKS || rawRuns.filter((item) => item?.conclusion === "failure" && item?.headSha === headSha).length > MAX_RUNS });
    return snapshot ? { ok: true, snapshot } : { ok: false, code: "response-too-large" };
  } catch { return { ok: false, code: "malformed-response" }; }
}
