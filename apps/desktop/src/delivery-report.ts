import type { TaskWorkspaceDiff, TaskWorkspaceSummary } from "./task-workspaces.js";
import type { TaskValidationSnapshot } from "./task-validation.js";

const MAX_REPORT_BYTES = 64 * 1024;
const MAX_FILES = 100;
const MAX_CHECKS = 64;
const TOKEN = /\b(?:sk|pk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/giu;
const SECRET = /\b((?:api[_-]?key|access[_-]?token|authorization|cookie|password|passphrase|secret|token|private[_-]?key)\s*[:=]\s*)[^\s,;]+/giu;
const BEARER = /\bBearer\s+\S+/giu;

function safeText(value: unknown, limit: number): string {
  return String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/gu, " ")
    .replace(BEARER, "Bearer [redacted]")
    .replace(SECRET, "$1[redacted]")
    .replace(TOKEN, "[redacted-token]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit)
    .replace(/([\\`*_{}\[\]()#+!|>])/gu, "\\$1");
}

function state(value: unknown, states: readonly string[], fallback: string): string {
  return typeof value === "string" && states.includes(value) ? value : fallback;
}

function fileStatus(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  if (["added", "modified", "deleted", "renamed", "copied", "committed"].includes(value)) return value;
  if (value === "??") return "added";
  if (!/^[ MADRCU?!]{2}$/u.test(value)) return "unknown";
  if (value.includes("R")) return "renamed";
  if (value.includes("C")) return "copied";
  if (value.includes("D")) return "deleted";
  if (value.includes("A")) return "added";
  return value.includes("M") ? "modified" : "unknown";
}

export interface DeliveryReport {
  readonly sessionId: string;
  readonly readiness: "ready" | "attention" | "blocked" | "running";
  readonly workspace: { readonly state: string; readonly changedFiles: number; readonly merged: boolean; readonly dirty: boolean };
  readonly files: readonly { readonly path: string; readonly status: string; readonly groups: readonly string[] }[];
  readonly filesTruncated: boolean;
  readonly validation: {
    readonly state: string;
    readonly policy: string;
    readonly checks: readonly { readonly label: string; readonly state: string; readonly reason?: string }[];
  };
  readonly caveats: readonly string[];
}

export function buildDeliveryReport(
  sessionId: string,
  workspace: TaskWorkspaceSummary,
  diff?: Pick<TaskWorkspaceDiff, "files" | "truncated" | "filesTruncated">,
  validation?: TaskValidationSnapshot,
  runtime: { readonly active: boolean } = { active: false },
): DeliveryReport {
  const validationState = state(validation?.state, ["running", "passed", "failed", "blocked", "skipped"], "not-run");
  const fileTruncated = Boolean(diff?.truncated || diff?.filesTruncated || (diff?.files.length ?? 0) > MAX_FILES);
  const caveats: string[] = [];
  if (!diff) caveats.push("Change details unavailable; file list could not be verified.");
  if (fileTruncated) caveats.push("Change list or diff truncated; report does not prove all changes were reviewed.");
  if (validationState === "not-run") caveats.push("Validation not run in this task session.");
  if (validationState === "skipped") caveats.push("Validation was skipped; no passing result is claimed.");
  if (workspace.dirty) caveats.push("Worktree has uncommitted changes.");
  if (!workspace.merged) caveats.push("Task branch has not been merged.");
  const readiness = runtime.active || validationState === "running" || workspace.state === "running" ? "running"
    : validationState === "failed" || validationState === "blocked" || workspace.state === "missing" || workspace.state === "cleaned" ? "blocked"
    : validationState !== "passed" || !diff || fileTruncated || workspace.dirty || !workspace.merged ? "attention" : "ready";
  const files = (diff?.files ?? []).slice(0, MAX_FILES).map((file) => ({
    path: safeText(file.path, 512),
    status: fileStatus(file.status),
    groups: file.groups.filter((group) => ["committed", "staged", "unstaged", "untracked"].includes(group)).slice(0, 4),
  }));
  const checks = (validation?.checks ?? []).slice(0, MAX_CHECKS).map((check) => ({
    label: safeText(check.label, 256),
    state: state(check.state, ["pending", "passed", "failed", "blocked", "skipped"], "unknown"),
    ...(check.reason ? { reason: safeText(check.reason, 384) } : {}),
  }));
  return {
    sessionId: safeText(sessionId, 96), readiness,
    workspace: {
      state: state(workspace.state, ["ready", "dirty", "running", "merged", "cleaned", "missing"], "unknown"),
      changedFiles: Math.max(0, Math.min(100_000, Number(workspace.changedFiles) || 0)),
      merged: workspace.merged === true,
      dirty: workspace.dirty === true,
    },
    files, filesTruncated: fileTruncated,
    validation: { state: validationState, policy: state(validation?.policy, ["fast", "default", "strict"], "unknown"), checks },
    caveats,
  };
}

export function renderDeliveryReportMarkdown(report: DeliveryReport): string {
  const lines = [
    "# Task delivery report", "",
    `Session: ${report.sessionId}`,
    `Readiness: ${report.readiness}`,
    "", "## Changes (verified workspace snapshot)",
    `Workspace: ${report.workspace.state}; ${report.workspace.changedFiles} changed file(s); merged: ${report.workspace.merged ? "yes" : "no"}; uncommitted: ${report.workspace.dirty ? "yes" : "no"}`,
    ...(report.files.length ? report.files.map((file) => `- ${file.path} (${file.status}; ${file.groups.join(", ") || "unknown"})`) : ["- No file details available."]),
    "", "## Validation (actual recorded run)",
    `Result: ${report.validation.state}; policy: ${report.validation.policy}`,
    ...(report.validation.checks.length ? report.validation.checks.map((check) => `- ${check.label}: ${check.state}${check.reason ? ` — ${check.reason}` : ""}`) : ["- No recorded checks."]),
    "", "## Outstanding / delivery gate",
    ...(report.caveats.length ? report.caveats.map((caveat) => `- ${caveat}`) : ["- No known local validation blockers. Remote CI was not checked by this report."]),
    "", "This report reflects local workspace and in-process validation state only; it does not attest to remote CI or deployment.", "",
  ];
  const markdown = lines.join("\n");
  if (Buffer.byteLength(markdown, "utf8") > MAX_REPORT_BYTES) throw new Error("delivery report exceeds size limit");
  return markdown;
}
