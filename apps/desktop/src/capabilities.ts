import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { opendir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { SkillRegistry } from "@dev-agent/agent-core";

const maxSkills = 64;
const maxJobs = 100;
const maxJobRecordBytes = 32 * 1024;
const jobIdPattern = /^job-[a-f0-9]{16}$/u;
const githubProbeTimeoutMs = 1_500;

export interface GitHubCapabilitySnapshot {
  readonly provider: "github";
  readonly enabled: boolean;
  readonly cliAvailable: boolean;
  readonly authenticated: boolean;
  readonly mutationAllowed: false;
  readonly reason?: "opt-in-required" | "cli-unavailable" | "not-authenticated";
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
): Promise<GitHubCapabilitySnapshot> {
  if (!enabled) {
    return {
      provider: "github",
      enabled: false,
      cliAvailable: false,
      authenticated: false,
      mutationAllowed: false,
      reason: "opt-in-required",
    };
  }

  const authenticated = await ghAuthStatus();
  return {
    provider: "github",
    enabled: true,
    cliAvailable: authenticated !== undefined,
    authenticated: authenticated === true,
    mutationAllowed: false,
    ...(authenticated === undefined
      ? { reason: "cli-unavailable" as const }
      : authenticated
        ? {}
        : { reason: "not-authenticated" as const }),
  };
}

/** Read only bounded skill metadata; instructions and paths never leave this module. */
export async function loadWorkbenchMetadata(workingDirectory: string): Promise<WorkbenchMetadataSnapshot> {
  const registry = await SkillRegistry.load({ workingDirectory });
  const skills = registry.list().slice(0, maxSkills).map((skill) => ({
    name: safeLabel(skill.name, 96),
    description: safeLabel(skill.description, 240),
    scope: skill.scope,
  }));
  const jobs = await readScheduledJobMetadata();
  return {
    skills,
    jobs,
    limits: { maxSkills, maxJobs },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeLabel(value: string, maxChars: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxChars);
}
