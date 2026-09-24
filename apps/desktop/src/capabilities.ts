import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { opendir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { SkillRegistry } from "@dev-agent/agent-core";

const execFileAsync = promisify(execFile);
const maxSkills = 64;
const maxJobs = 100;
const maxJobRecordBytes = 32 * 1024;
const jobIdPattern = /^job-[a-f0-9]{16}$/u;
const githubProbeTimeoutMs = 1_500;
const maxGitOutputBytes = 16 * 1024;
const maxBranchChars = 128;
const maxRemoteChars = 4 * 1024;
const maxWorkflowEntries = 128;
const maxCiResponseBytes = 32 * 1024;
const maxChangedFiles = 10_000;

export type CapabilityState = "ready" | "disabled" | "unsupported" | "unauthenticated" | "unavailable";

export type RepositoryCapabilityState = "ready" | "not-a-repository" | "invalid" | "unavailable";

export interface RepositoryCapabilitySnapshot {
  readonly provider: "git";
  readonly state: RepositoryCapabilityState;
  readonly branch?: string;
  readonly dirty?: boolean;
  readonly changedFiles?: number;
  readonly remoteHost?: string;
  readonly remoteProvider?: "github" | "other";
  readonly reason?: "not-a-repository" | "git-unavailable" | "malformed-output" | "remote-unparseable";
}

export type CiRunStatus = "queued" | "in_progress" | "completed" | "unknown";
export type CiRunConclusion = "success" | "failure" | "cancelled" | "skipped" | "neutral" | "unknown";

export interface CiCapabilitySnapshot {
  readonly provider: "github-actions";
  readonly state: CapabilityState;
  readonly enabled: boolean;
  readonly workflowDetected: boolean;
  readonly mutationAllowed: false;
  readonly latestRun?: {
    readonly status: CiRunStatus;
    readonly conclusion: CiRunConclusion;
    readonly workflow?: string;
  };
  readonly reason?:
    | "opt-in-required"
    | "not-a-repository"
    | "not-github-repository"
    | "no-workflows"
    | "cli-unavailable"
    | "not-authenticated"
    | "status-unavailable"
    | "status-malformed"
    | "no-runs";
}

export interface GitHubCapabilitySnapshot {
  readonly provider: "github";
  readonly state: Exclude<CapabilityState, "unsupported">;
  readonly enabled: boolean;
  readonly cliAvailable: boolean;
  readonly authenticated: boolean;
  readonly mutationAllowed: false;
  readonly reason?: "opt-in-required" | "cli-unavailable" | "not-authenticated";
  readonly ci: CiCapabilitySnapshot;
}

export interface SkillMetadataSnapshot {
  readonly name: string;
  readonly description: string;
  readonly scope: "project" | "user";
}

export interface ScheduledJobMetadataSnapshot {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runCount: number;
}

export interface WorkbenchMetadataSnapshot {
  readonly repository: RepositoryCapabilitySnapshot;
  readonly skills: readonly SkillMetadataSnapshot[];
  readonly jobs: readonly ScheduledJobMetadataSnapshot[];
  readonly limits: {
    readonly maxSkills: number;
    readonly maxJobs: number;
  };
}

/**
 * Probe GitHub without reading or returning credentials and without enabling
 * any mutation. The optional environment flag is an explicit user opt-in;
 * normal Desktop loads never invoke an external command.
 */
export async function probeGitHubCapability(
  enabled = process.env.DEV_AGENT_DESKTOP_GITHUB === "1",
  workingDirectory = process.cwd(),
): Promise<GitHubCapabilitySnapshot> {
  if (!enabled) {
    return {
      provider: "github",
      state: "disabled",
      enabled: false,
      cliAvailable: false,
      authenticated: false,
      mutationAllowed: false,
      reason: "opt-in-required",
      ci: createCiSnapshot("disabled", false, false, "opt-in-required"),
    };
  }

  const repository = await inspectRepository(workingDirectory);
  const workflowState = await detectGitHubWorkflow(workingDirectory);
  const authenticated = await ghAuthStatus();
  const state: GitHubCapabilitySnapshot["state"] =
    authenticated === undefined ? "unavailable" : authenticated ? "ready" : "unauthenticated";
  const reason = authenticated === undefined
    ? "cli-unavailable" as const
    : authenticated
      ? undefined
      : "not-authenticated" as const;
  const ci = await probeCiCapability(repository, workflowState, authenticated, enabled, workingDirectory);

  return {
    provider: "github",
    state,
    enabled: true,
    cliAvailable: authenticated !== undefined,
    authenticated: authenticated === true,
    mutationAllowed: false,
    ...(reason === undefined ? {} : { reason }),
    ci,
  };
}

/** Read only bounded skill/job/repository metadata; instructions and paths never leave this module. */
export async function loadWorkbenchMetadata(workingDirectory: string): Promise<WorkbenchMetadataSnapshot> {
  const registry = await SkillRegistry.load({ workingDirectory });
  const skills = registry.list().slice(0, maxSkills).map((skill) => ({
    name: safeMetadataLabel(skill.name, 96) ?? "unknown",
    description: safeMetadataLabel(skill.description, 240) ?? "metadata unavailable",
    scope: skill.scope,
  }));
  const jobs = await readScheduledJobMetadata();
  return {
    repository: await inspectRepository(workingDirectory),
    skills,
    jobs,
    limits: { maxSkills, maxJobs },
  };
}

/** Returns the same bounded repository projection used by the workbench route. */
export async function loadProjectCapabilityMetadata(workingDirectory: string): Promise<RepositoryCapabilitySnapshot> {
  return inspectRepository(workingDirectory);
}

/**
 * Collects only repository identity metadata. No file contents, commit
 * messages, remotes, credentials, or command arguments are returned.
 */
export async function inspectRepository(workingDirectory: string): Promise<RepositoryCapabilitySnapshot> {
  const inside = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], workingDirectory, maxGitOutputBytes);
  if (!inside.ok) {
    return inside.code === 128
      ? { provider: "git", state: "not-a-repository", reason: "not-a-repository" }
      : { provider: "git", state: "unavailable", reason: "git-unavailable" };
  }
  if (inside.stdout.trim() !== "true") {
    return { provider: "git", state: "invalid", reason: "malformed-output" };
  }

  const branch = await runCommand("git", ["branch", "--show-current"], workingDirectory, maxGitOutputBytes);
  const status = await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], workingDirectory, maxGitOutputBytes);
  const remote = await runCommand("git", ["config", "--get", "remote.origin.url"], workingDirectory, maxRemoteChars);
  if (!branch.ok || !status.ok) {
    return { provider: "git", state: "invalid", reason: "malformed-output" };
  }

  const safeBranch = normalizeBranch(branch.stdout);
  if (safeBranch === undefined) {
    return { provider: "git", state: "invalid", reason: "malformed-output" };
  }
  const remoteRaw = remote.ok ? remote.stdout.trim() : "";
  const remoteHost = remoteRaw ? parseGitRemoteHost(remoteRaw) : undefined;
  if (remoteRaw && remoteHost === undefined) {
    return {
      provider: "git",
      state: "ready",
      branch: safeBranch,
      dirty: status.stdout.length > 0,
      changedFiles: countStatusEntries(status.stdout),
      reason: "remote-unparseable",
    };
  }

  return {
    provider: "git",
    state: "ready",
    branch: safeBranch,
    dirty: status.stdout.length > 0,
    changedFiles: countStatusEntries(status.stdout),
    ...(remoteHost === undefined ? {} : {
      remoteHost,
      remoteProvider: remoteHost === "github.com" || remoteHost.endsWith(".github.com") ? "github" as const : "other" as const,
    }),
  };
}

/** Parses only a remote host; credentials, paths, and query strings are discarded. */
export function parseGitRemoteHost(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxRemoteChars || /[\u0000\r\n]/u.test(normalized)) return undefined;
  if (/^git@[^:]+:/u.test(normalized)) {
    const host = normalized.slice(4, normalized.indexOf(":", 4)).toLowerCase();
    return normalizeRemoteHost(host);
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    return normalizeRemoteHost(host);
  } catch {
    return undefined;
  }
}

/** Sanitizes an injected metadata snapshot before it reaches the HTTP response. */
export function normalizeGitHubCapabilitySnapshot(value: unknown): GitHubCapabilitySnapshot {
  if (!isRecord(value)) return unavailableGitHubSnapshot();
  const enabled = value.enabled === true;
  const cliAvailable = value.cliAvailable === true;
  const authenticated = enabled && value.authenticated === true && cliAvailable;
  const state = normalizeCapabilityState(value.state, enabled, cliAvailable, authenticated);
  const ci = enabled
    ? normalizeCiSnapshot(value.ci)
    : createCiSnapshot("disabled", false, false, "opt-in-required");
  return {
    provider: "github",
    state: state === "unsupported" ? "unavailable" : state,
    enabled,
    cliAvailable,
    authenticated,
    mutationAllowed: false,
    ...(stateReason(state) === undefined ? {} : { reason: stateReason(state) }),
    ci,
  };
}

/** Sanitizes repository metadata from custom Desktop hosts. */
export function normalizeRepositoryCapabilitySnapshot(value: unknown): RepositoryCapabilitySnapshot {
  if (!isRecord(value)) return { provider: "git", state: "unavailable", reason: "git-unavailable" };
  const state = value.state;
  if (state === "not-a-repository") return { provider: "git", state, reason: "not-a-repository" };
  if (state === "unavailable") return { provider: "git", state, reason: "git-unavailable" };
  if (state === "invalid") return { provider: "git", state, reason: "malformed-output" };
  if (state !== "ready") return { provider: "git", state: "unavailable", reason: "git-unavailable" };
  const branch = typeof value.branch === "string" ? normalizeBranch(value.branch) : undefined;
  const remoteHost = typeof value.remoteHost === "string" ? normalizeRemoteHost(value.remoteHost) : undefined;
  const dirty = typeof value.dirty === "boolean" ? value.dirty : undefined;
  const changedFiles = typeof value.changedFiles === "number" && Number.isSafeInteger(value.changedFiles) && value.changedFiles >= 0
    ? Math.min(value.changedFiles, maxChangedFiles)
    : undefined;
  if (branch === undefined || dirty === undefined) return { provider: "git", state: "invalid", reason: "malformed-output" };
  return {
    provider: "git",
    state,
    branch,
    dirty,
    ...(changedFiles === undefined ? {} : { changedFiles }),
    ...(remoteHost === undefined ? {} : {
      remoteHost,
      remoteProvider: remoteHost === "github.com" || remoteHost.endsWith(".github.com") ? "github" as const : "other" as const,
    }),
  };
}

/** Sanitizes custom-host workbench metadata before the HTTP response boundary. */
export function normalizeWorkbenchMetadataSnapshot(value: unknown): WorkbenchMetadataSnapshot {
  if (!isRecord(value)) {
    return {
      repository: { provider: "git", state: "unavailable", reason: "git-unavailable" },
      skills: [],
      jobs: [],
      limits: { maxSkills, maxJobs },
    };
  }
  const rawSkills = Array.isArray(value.skills) ? value.skills : [];
  const skills: SkillMetadataSnapshot[] = [];
  for (const item of rawSkills.slice(0, maxSkills)) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? safeMetadataLabel(item.name, 96) ?? "" : "";
    const description = typeof item.description === "string" ? safeMetadataLabel(item.description, 240) ?? "" : "";
    const scope = item.scope === "project" || item.scope === "user" ? item.scope : undefined;
    if (name && scope) skills.push({ name, description, scope });
  }
  const rawJobs = Array.isArray(value.jobs) ? value.jobs : [];
  const jobs: ScheduledJobMetadataSnapshot[] = [];
  for (const item of rawJobs.slice(0, maxJobs)) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" && jobIdPattern.test(item.id) ? item.id : undefined;
    const status = typeof item.status === "string" ? safeMetadataLabel(item.status, 32) : undefined;
    const createdAt = typeof item.createdAt === "string" ? safeMetadataLabel(item.createdAt, 64) : undefined;
    const updatedAt = typeof item.updatedAt === "string" ? safeMetadataLabel(item.updatedAt, 64) : undefined;
    const runCount = typeof item.runCount === "number" && Number.isSafeInteger(item.runCount) && item.runCount >= 0
      ? Math.min(item.runCount, Number.MAX_SAFE_INTEGER)
      : undefined;
    if (id && status && createdAt && updatedAt && runCount !== undefined) {
      jobs.push({ id, status, createdAt, updatedAt, runCount });
    }
  }
  return {
    repository: normalizeRepositoryCapabilitySnapshot(value.repository),
    skills,
    jobs,
    limits: {
      maxSkills: maxSkills,
      maxJobs: maxJobs,
    },
  };
}

/**
 * Background job records are private files owned by the CLI. This reader is
 * deliberately a separate metadata projection: it never returns prompts,
 * paths, provider/model values, request bytes, or worker output.
 */
async function readScheduledJobMetadata(): Promise<readonly ScheduledJobMetadataSnapshot[]> {
  const root = join(homedir(), ".dev-agent", "jobs");
  let directory;
  try {
    directory = await opendir(root);
  } catch {
    return [];
  }
  const jobs: ScheduledJobMetadataSnapshot[] = [];
  for await (const entry of directory) {
    if (!entry.isDirectory() || !jobIdPattern.test(entry.name) || jobs.length >= maxJobs) continue;
    try {
      const raw = await readFile(join(root, entry.name, "job.json"), "utf8");
      if (Buffer.byteLength(raw, "utf8") > maxJobRecordBytes) continue;
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value)) continue;
      const id = typeof value.id === "string" && jobIdPattern.test(value.id) ? value.id : undefined;
      const status = typeof value.status === "string" ? value.status : undefined;
      const createdAt = typeof value.createdAt === "string" ? value.createdAt : undefined;
      const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : undefined;
      const runCount = typeof value.runCount === "number" && Number.isSafeInteger(value.runCount) && value.runCount >= 0
        ? value.runCount
        : undefined;
      if (!id || !status || !createdAt || !updatedAt || runCount === undefined) continue;
      jobs.push({ id, status: safeLabel(status, 32), createdAt, updatedAt, runCount });
    } catch {
      // Optional metadata is fail-closed: malformed records stay hidden.
    }
  }
  return jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function countStatusEntries(value: string): number {
  if (!value) return 0;
  return Math.min(
    maxChangedFiles,
    value.split(/\r?\n/u).filter((entry) => entry.length > 0).length,
  );
}

async function probeCiCapability(
  repository: RepositoryCapabilitySnapshot,
  workflowState: "detected" | "none" | "unavailable",
  authenticated: boolean | undefined,
  enabled: boolean,
  workingDirectory: string,
): Promise<CiCapabilitySnapshot> {
  if (!enabled) {
    return createCiSnapshot("disabled", false, false, "opt-in-required");
  }
  if (repository.state === "not-a-repository") {
    return createCiSnapshot("unsupported", true, false, "not-a-repository");
  }
  if (repository.state !== "ready" || repository.remoteProvider !== "github") {
    return createCiSnapshot("unsupported", true, false, "not-github-repository");
  }
  if (workflowState === "none") {
    return createCiSnapshot("unsupported", true, false, "no-workflows");
  }
  if (workflowState === "unavailable") {
    return createCiSnapshot("unavailable", true, false, "status-unavailable");
  }
  if (authenticated === undefined) {
    return createCiSnapshot("unavailable", true, false, "cli-unavailable");
  }
  if (!authenticated) {
    return createCiSnapshot("unauthenticated", true, true, "not-authenticated");
  }

  const latest = await runCommand(
    "gh",
    ["run", "list", "--limit", "1", "--json", "status,conclusion,workflowName"],
    workingDirectory,
    maxCiResponseBytes,
  );
  if (!latest.ok) return createCiSnapshot("unavailable", true, true, "status-unavailable");
  try {
    const parsed: unknown = JSON.parse(latest.stdout);
    if (!Array.isArray(parsed)) return createCiSnapshot("unavailable", true, true, "status-malformed");
    const item = parsed[0];
    if (item === undefined) return createCiSnapshot("ready", true, true, "no-runs");
    if (!isRecord(item)) return createCiSnapshot("unavailable", true, true, "status-malformed");
    const status = normalizeCiStatus(item.status);
    const conclusion = normalizeCiConclusion(item.conclusion);
    const workflow = typeof item.workflowName === "string" ? safeLabel(item.workflowName, 96) : undefined;
    if (status === "unknown") return createCiSnapshot("unavailable", true, true, "status-malformed");
    return {
      provider: "github-actions",
      state: "ready",
      enabled: true,
      workflowDetected: true,
      mutationAllowed: false,
      latestRun: { status, conclusion, ...(workflow ? { workflow } : {}) },
    };
  } catch {
    return createCiSnapshot("unavailable", true, true, "status-malformed");
  }
}

async function detectGitHubWorkflow(workingDirectory: string): Promise<"detected" | "none" | "unavailable"> {
  let directory;
  try {
    directory = await opendir(join(workingDirectory, ".github", "workflows"));
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "none" : "unavailable";
  }
  let entries = 0;
  try {
    for await (const entry of directory) {
      entries += 1;
      if (entries > maxWorkflowEntries) return "unavailable";
      if (entry.isFile() && /\.ya?ml$/iu.test(entry.name)) return "detected";
    }
    return "none";
  } catch {
    return "unavailable";
  } finally {
    await directory.close().catch(() => undefined);
  }
}

function ghAuthStatus(): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      execFile(
        "gh",
        ["auth", "status", "--hostname", "github.com"],
        {
          timeout: githubProbeTimeoutMs,
          maxBuffer: 1024,
          windowsHide: true,
          encoding: "utf8",
        },
        (error) => {
          const code = typeof error?.code === "string" ? error.code : undefined;
          finish(error === null ? true : code === "ENOENT" ? undefined : false);
        },
      );
    } catch {
      finish(undefined);
    }
  });
}

async function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  maxBuffer: number,
): Promise<{ readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly code?: number | string }> {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd,
      timeout: githubProbeTimeoutMs,
      maxBuffer,
      windowsHide: true,
      encoding: "utf8",
    });
    return { ok: true, stdout: typeof result.stdout === "string" ? result.stdout : "" };
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    return { ok: false, ...(candidate.code === undefined ? {} : { code: candidate.code }) };
  }
}

function createCiSnapshot(
  state: CapabilityState,
  enabled: boolean,
  workflowDetected: boolean,
  reason: CiCapabilitySnapshot["reason"],
): CiCapabilitySnapshot {
  return {
    provider: "github-actions",
    state,
    enabled,
    workflowDetected,
    mutationAllowed: false,
    ...(reason === undefined ? {} : { reason }),
  };
}

function normalizeCapabilityState(
  _value: unknown,
  enabled: boolean,
  cliAvailable: boolean,
  authenticated: boolean,
): CapabilityState {
  if (!enabled) return "disabled";
  if (!cliAvailable) return "unavailable";
  if (!authenticated) return "unauthenticated";
  return "ready";
}

function stateReason(state: CapabilityState): GitHubCapabilitySnapshot["reason"] | undefined {
  if (state === "disabled") return "opt-in-required";
  if (state === "unavailable") return "cli-unavailable";
  if (state === "unauthenticated") return "not-authenticated";
  return undefined;
}

function normalizeCiSnapshot(value: unknown): CiCapabilitySnapshot {
  if (!isRecord(value)) return createCiSnapshot("unavailable", false, false, "status-unavailable");
  const state = value.state;
  const allowed: readonly CapabilityState[] = ["ready", "disabled", "unsupported", "unauthenticated", "unavailable"];
  const normalizedState = allowed.includes(state as CapabilityState) ? state as CapabilityState : "unavailable";
  const enabled = value.enabled === true;
  const workflowDetected = value.workflowDetected === true;
  const reason = normalizeCiReason(value.reason);
  const rawRun = value.latestRun;
  let latestRun: CiCapabilitySnapshot["latestRun"];
  if (isRecord(rawRun)) {
    const status = normalizeCiStatus(rawRun.status);
    const conclusion = normalizeCiConclusion(rawRun.conclusion);
    const workflow = typeof rawRun.workflow === "string" ? safeMetadataLabel(rawRun.workflow, 96) : undefined;
    if (status !== "unknown") {
      latestRun = { status, conclusion, ...(workflow ? { workflow } : {}) };
    }
  }
  return {
    provider: "github-actions",
    state: normalizedState,
    enabled,
    workflowDetected,
    mutationAllowed: false,
    ...(latestRun === undefined ? {} : { latestRun }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function normalizeCiReason(value: unknown): CiCapabilitySnapshot["reason"] | undefined {
  const reasons: readonly CiCapabilitySnapshot["reason"][] = [
    "opt-in-required",
    "not-a-repository",
    "not-github-repository",
    "no-workflows",
    "cli-unavailable",
    "not-authenticated",
    "status-unavailable",
    "status-malformed",
    "no-runs",
  ];
  return reasons.includes(value as CiCapabilitySnapshot["reason"]) ? value as CiCapabilitySnapshot["reason"] : undefined;
}

function normalizeCiStatus(value: unknown): CiRunStatus {
  return value === "queued" || value === "in_progress" || value === "completed" ? value : "unknown";
}

function normalizeCiConclusion(value: unknown): CiRunConclusion {
  return value === "success" || value === "failure" || value === "cancelled" || value === "skipped" || value === "neutral"
    ? value
    : "unknown";
}

function unavailableGitHubSnapshot(): GitHubCapabilitySnapshot {
  return {
    provider: "github",
    state: "unavailable",
    enabled: false,
    cliAvailable: false,
    authenticated: false,
    mutationAllowed: false,
    reason: "cli-unavailable",
    ci: createCiSnapshot("unavailable", false, false, "cli-unavailable"),
  };
}

function normalizeBranch(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return "detached";
  if (
    normalized.length > maxBranchChars ||
    /[\u0000\r\n]/u.test(normalized) ||
    /[\\]/u.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    /(?:api[-_ ]?key|access[-_ ]?token|password|secret|bearer|sk-[a-z0-9])/iu.test(normalized)
  ) return undefined;
  if (normalized === "detached" || /^[A-Za-z0-9._/@+-]+$/u.test(normalized)) return normalized;
  return undefined;
}

function isSafeHost(value: string): boolean {
  return value.length <= 255 && /^[a-z0-9.-]+$/u.test(value) && !value.startsWith(".") && !value.endsWith(".");
}

function normalizeRemoteHost(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return isSafeHost(normalized) ? normalized : undefined;
}

function safeMetadataLabel(value: string, maxChars: number): string | undefined {
  const normalized = safeLabel(value, maxChars);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/u.test(normalized) ||
    normalized.startsWith("\\\\") ||
    /(?:api[-_ ]?key|access[-_ ]?token|password|secret|bearer|sk-[a-z0-9])/iu.test(normalized)
  ) return undefined;
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeLabel(value: string, maxChars: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, maxChars);
}
