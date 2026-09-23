import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const maxStateBytes = 1024 * 1024;
const maxGitOutputBytes = 1024 * 1024;
const maxDiffBytes = 192 * 1024;
const maxUntrackedFileBytes = 64 * 1024;
const maxTaskWorkspaces = 256;
const gitTimeoutMs = 15_000;

export type TaskWorkspaceState = "ready" | "dirty" | "running" | "merged" | "cleaned" | "missing";

export interface TaskWorkspaceSummary {
  readonly sessionId: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly directory: string;
  readonly state: TaskWorkspaceState;
  readonly changedFiles: number;
  readonly dirty: boolean;
  readonly merged: boolean;
  readonly createdAt: string;
}

export type TaskWorkspaceDiffGroup = "committed" | "staged" | "unstaged" | "untracked";

export interface TaskWorkspaceDiffFile {
  readonly path: string;
  readonly status: string;
  readonly groups: readonly TaskWorkspaceDiffGroup[];
}

export interface TaskWorkspaceDiffSection {
  readonly group: TaskWorkspaceDiffGroup;
  readonly fileCount: number;
  readonly diff: string;
}

export interface TaskWorkspaceDiff {
  readonly sessionId: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly files: readonly TaskWorkspaceDiffFile[];
  readonly sections: readonly TaskWorkspaceDiffSection[];
  readonly diff: string;
  readonly truncated: boolean;
  readonly filesTruncated: boolean;
  readonly selectedPath?: string;
}

export interface TaskWorkspaceManagerOptions {
  readonly workspaceRoot?: string;
  readonly worktreeDirectory?: string;
  readonly stateFile?: string;
}

export class TaskWorkspaceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "TaskWorkspaceError";
  }
}

interface WorkspaceRecord {
  readonly sessionId: string;
  readonly repositoryRoot: string;
  readonly path: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly baseCommit: string;
  readonly createdAt: string;
  readonly cleanedAt?: string;
  readonly mergedAt?: string;
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function execGit(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolveResult, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd,
        encoding: "utf8",
        timeout: gitTimeoutMs,
        maxBuffer: maxGitOutputBytes,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const errorCode = error?.code;
        const result: GitResult = {
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          exitCode: typeof errorCode === "number" ? errorCode : 0,
        };
        if (error && typeof errorCode !== "number") {
          reject(error);
          return;
        }
        resolveResult(result);
      },
    );
  });
}

async function runGit(args: readonly string[], cwd: string): Promise<string> {
  try {
    const result = await execGit(args, cwd);
    if (result.exitCode !== 0) {
      throw new Error("git command failed");
    }
    return result.stdout.trimEnd();
  } catch {
    throw new TaskWorkspaceError("Git operation failed.", 500, "git-failed");
  }
}

function inside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function displayPath(path: string): string {
  const homeRelative = relative(homedir(), path);
  if (homeRelative === "") return "~";
  if (!homeRelative.startsWith(`..${sep}`) && homeRelative !== ".." && !isAbsolute(homeRelative)) {
    return `~/${homeRelative.split(sep).join("/")}`;
  }
  return `…/${basename(path)}`;
}

function canonicalTaskWorktreePath(
  worktreeDirectory: string,
  candidatePath: string,
  sessionId: string,
): string | undefined {
  if (resolve(candidatePath) !== join(worktreeDirectory, sessionId)) return undefined;
  try {
    const info = lstatSync(candidatePath);
    if (!info.isDirectory() || info.isSymbolicLink()) return undefined;
    const canonicalRoot = realpathSync(worktreeDirectory);
    const canonicalPath = realpathSync(candidatePath);
    return canonicalPath === join(canonicalRoot, sessionId) ? canonicalPath : undefined;
  } catch {
    return undefined;
  }
}

function parseStatus(output: string): Map<string, string> {
  const entries = output.split("\0");
  const changed = new Map<string, string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const status = entry.slice(0, 2).trim() || "changed";
    let path = entry.slice(3);
    if (status.includes("R") || status.includes("C")) {
      const destination = entries[index + 1];
      if (destination) {
        path = destination;
        index += 1;
      }
    }
    if (path) changed.set(path, status);
  }
  return changed;
}

function safeRecord(value: unknown): value is WorkspaceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<WorkspaceRecord>;
  return typeof record.sessionId === "string" && /^task-[a-z0-9-]{1,80}$/.test(record.sessionId) &&
    typeof record.repositoryRoot === "string" && typeof record.path === "string" &&
    typeof record.branch === "string" && record.branch === `dev-agent/${record.sessionId}` &&
    typeof record.baseBranch === "string" && typeof record.baseCommit === "string" &&
    /^[0-9a-f]{40,64}$/i.test(record.baseCommit) && typeof record.createdAt === "string" &&
    (record.cleanedAt === undefined || typeof record.cleanedAt === "string") &&
    (record.mergedAt === undefined || typeof record.mergedAt === "string");
}

export class DesktopTaskWorkspaceManager {
  private readonly requestedRoot: string;
  private worktreeDirectory: string;
  private readonly stateFile: string;
  private repositoryRoot?: string;
  private repositoryPromise?: Promise<string>;
  private readonly records = new Map<string, WorkspaceRecord>();
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: TaskWorkspaceManagerOptions = {}) {
    this.requestedRoot = resolve(options.workspaceRoot ?? process.cwd());
    const repositoryKey = createHash("sha256").update(this.requestedRoot).digest("hex").slice(0, 16);
    this.worktreeDirectory = resolve(
      options.worktreeDirectory ?? join(homedir(), ".dev-agent", "worktrees", repositoryKey),
    );
    try {
      const info = lstatSync(this.worktreeDirectory);
      if (info.isDirectory() && !info.isSymbolicLink()) {
        this.worktreeDirectory = realpathSync(this.worktreeDirectory);
      }
    } catch {
      // It is created lazily when the first isolated task is requested.
    }
    this.stateFile = resolve(
      options.stateFile ?? join(homedir(), ".dev-agent", "desktop-workspaces", `${repositoryKey}.json`),
    );
    this.readState();
  }

  /** A previously-created task uses the same linked worktree after server restart. */
  workingDirectoryForSession(sessionId: string): string | undefined {
    const record = this.records.get(sessionId);
    if (!record || record.cleanedAt || canonicalTaskWorktreePath(
      this.worktreeDirectory,
      record.path,
      record.sessionId,
    ) === undefined) {
      return undefined;
    }
    return record.path;
  }

  /** Resolve a verified task worktree for task sessions, or the verified project root otherwise. */
  async terminalWorkingDirectory(sessionId: string): Promise<string> {
    const record = this.records.get(sessionId);
    if (!record) return this.ensureRepository();
    if (record.cleanedAt) throw new TaskWorkspaceError("This task worktree was already cleaned up.", 409, "workspace-cleaned");
    return this.requireWorktree(record);
  }

  isCleanedSession(sessionId: string): boolean {
    return Boolean(this.records.get(sessionId)?.cleanedAt);
  }

  isTaskSession(sessionId: string): boolean {
    return this.records.has(sessionId);
  }

  async list(runningSessionIds: ReadonlySet<string> = new Set()): Promise<{
    readonly available: boolean;
    readonly repository?: string;
    readonly workspaces: readonly TaskWorkspaceSummary[];
  }> {
    let repositoryRoot: string;
    try {
      repositoryRoot = await this.ensureRepository();
    } catch {
      return { available: false, workspaces: [] };
    }
    const records = [...this.records.values()].filter((record) => record.repositoryRoot === repositoryRoot);
    const workspaces = await Promise.all(records.map((record) => this.summary(record, runningSessionIds.has(record.sessionId))));
    workspaces.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { available: true, repository: basename(repositoryRoot), workspaces };
  }

  async create(): Promise<TaskWorkspaceSummary> {
    return this.withMutation(async () => {
      const repositoryRoot = await this.ensureRepository();
      const existing = [...this.records.values()].filter((record) => record.repositoryRoot === repositoryRoot && !record.cleanedAt);
      if (existing.length >= maxTaskWorkspaces) {
        throw new TaskWorkspaceError("The task workspace limit has been reached.", 409, "workspace-limit");
      }

      const sessionId = `task-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
      const branch = `dev-agent/${sessionId}`;
      const baseBranch = await this.currentBranch(repositoryRoot);
      const baseCommit = await runGit(["rev-parse", "HEAD^{commit}"], repositoryRoot);
      await mkdir(this.worktreeDirectory, { recursive: true, mode: 0o700 });
      const worktreeDirectoryInfo = lstatSync(this.worktreeDirectory);
      if (!worktreeDirectoryInfo.isDirectory() || worktreeDirectoryInfo.isSymbolicLink()) {
        throw new TaskWorkspaceError("The managed worktree directory is not a safe directory.", 409, "worktree-directory-invalid");
      }
      this.worktreeDirectory = await realpath(this.worktreeDirectory);
      const path = join(this.worktreeDirectory, sessionId);

      try {
        await runGit(["worktree", "add", "-b", branch, path, baseCommit], repositoryRoot);
      } catch (error) {
        await rm(path, { recursive: true, force: true }).catch(() => undefined);
        if (error instanceof TaskWorkspaceError) throw error;
        throw new TaskWorkspaceError("Git could not create the isolated task worktree.", 409, "worktree-create-failed");
      }

      const record: WorkspaceRecord = {
        sessionId,
        repositoryRoot,
        path,
        branch,
        baseBranch,
        baseCommit,
        createdAt: new Date().toISOString(),
      };
      this.records.set(sessionId, record);
      try {
        await this.writeState();
      } catch {
        await runGit(["worktree", "remove", path], repositoryRoot).catch(() => undefined);
        await runGit(["branch", "-D", branch], repositoryRoot).catch(() => undefined);
        this.records.delete(sessionId);
        throw new TaskWorkspaceError("Task worktree metadata could not be saved; the new worktree was rolled back.", 500, "workspace-state-failed");
      }
      return this.summary(record, false);
    });
  }

  async diff(sessionId: string, selectedPath?: string): Promise<TaskWorkspaceDiff> {
    await this.ensureRepository();
    const record = this.requireRecord(sessionId);
    const worktree = await this.requireWorktree(record);
    const statusOutput = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktree);
    const status = parseStatus(statusOutput);
    const [committedOutput, stagedOutput, unstagedOutput] = await Promise.all([
      runGit(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", record.baseCommit, "HEAD", "--"], worktree),
      runGit(["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", "--"], worktree),
      runGit(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", "--"], worktree),
    ]);
    const committedNames = new Set(committedOutput.split("\0").filter(Boolean));
    const stagedNames = new Set(stagedOutput.split("\0").filter(Boolean));
    const unstagedNames = new Set(unstagedOutput.split("\0").filter(Boolean));
    const untrackedNames = new Set([...status].filter(([, value]) => value === "??").map(([path]) => path));
    const allPaths = new Set([
      ...committedNames,
      ...stagedNames,
      ...unstagedNames,
      ...untrackedNames,
    ]);
    if (selectedPath !== undefined && !allPaths.has(selectedPath)) {
      throw new TaskWorkspaceError("Task file not found.", 404, "workspace-file-not-found");
    }
    const paths = [...allPaths].sort();
    const selectedPaths = selectedPath === undefined ? paths : [selectedPath];
    const selectedSet = new Set(selectedPaths);
    const groupsFor = (path: string): TaskWorkspaceDiffGroup[] => {
      const groups: TaskWorkspaceDiffGroup[] = [];
      if (committedNames.has(path)) groups.push("committed");
      if (stagedNames.has(path)) groups.push("staged");
      if (unstagedNames.has(path)) groups.push("unstaged");
      if (untrackedNames.has(path)) groups.push("untracked");
      return groups;
    };
    const files = selectedPaths.slice(0, 500).map((path) => ({
      path,
      status: status.get(path) ?? "committed",
      groups: groupsFor(path),
    }));
    const filesTruncated = selectedPath === undefined && paths.length > files.length;
    const pathspec = selectedPath === undefined ? [] : [":(literal)" + selectedPath];
    const patchArgs = (kind: "committed" | "staged" | "unstaged") => {
      const common = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=3"];
      if (kind === "committed") return ["diff", ...common, record.baseCommit, "HEAD", "--", ...pathspec];
      if (kind === "staged") return ["diff", "--cached", ...common, "--", ...pathspec];
      return ["diff", ...common, "--", ...pathspec];
    };
    const [committedDiff, stagedDiff, unstagedDiff] = await Promise.all([
      runGit(patchArgs("committed"), worktree),
      runGit(patchArgs("staged"), worktree),
      runGit(patchArgs("unstaged"), worktree),
    ]);
    const untrackedDiffs: string[] = [];
    for (const path of untrackedNames) {
      if (!selectedSet.has(path)) continue;
      const absolute = resolve(worktree, path);
      if (!inside(worktree, absolute)) continue;
      try {
        const info = await lstat(absolute);
        if (!info.isFile() || info.isSymbolicLink() || info.size > maxUntrackedFileBytes) {
          untrackedDiffs.push(`# Untracked file content omitted (size or type limit): ${path}\n`);
          continue;
        }
        const bytes = await readFile(absolute);
        if (bytes.includes(0)) {
          untrackedDiffs.push(`# Binary untracked file omitted: ${path}\n`);
          continue;
        }
        const content = bytes.toString("utf8").replace(/\r\n/g, "\n");
        const lines = content.split("\n");
        if (lines.at(-1) === "") lines.pop();
        const displayName = path.replace(/[\r\n\t]/g, "?");
        untrackedDiffs.push([
          `diff --git a/${displayName} b/${displayName}`,
          "new file mode 100644",
          "--- /dev/null",
          `+++ b/${displayName}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map((line) => `+${line}`),
          "",
        ].join("\n"));
      } catch {
        untrackedDiffs.push(`# Untracked file unavailable: ${path}\n`);
      }
    }
    const rawSections: readonly { group: TaskWorkspaceDiffGroup; names: ReadonlySet<string>; diff: string }[] = [
      { group: "committed", names: committedNames, diff: committedDiff },
      { group: "staged", names: stagedNames, diff: stagedDiff },
      { group: "unstaged", names: unstagedNames, diff: unstagedDiff },
      { group: "untracked", names: untrackedNames, diff: untrackedDiffs.join("\n") },
    ];
    let remainingBytes = maxDiffBytes;
    let truncated = false;
    const sections = rawSections.map(({ group, names, diff }) => {
      if (!diff) return { group, fileCount: [...names].filter((path) => selectedSet.has(path)).length, diff: "" };
      const bytes = Buffer.from(diff, "utf8");
      let bounded = diff;
      if (bytes.byteLength > remainingBytes) {
        let end = remainingBytes;
        while (end > 0 && end < bytes.length && ((bytes.at(end) ?? 0) & 0xc0) === 0x80) end -= 1;
        bounded = bytes.subarray(0, end).toString("utf8");
        truncated = true;
      }
      remainingBytes = Math.max(0, remainingBytes - Buffer.byteLength(bounded, "utf8"));
      return { group, fileCount: [...names].filter((path) => selectedSet.has(path)).length, diff: bounded };
    });
    const combined = sections
      .filter((section) => section.diff)
      .map((section) => `# ${section.group} changes\n${section.diff}`)
      .join("\n\n");
    return {
      sessionId: record.sessionId,
      branch: record.branch,
      baseBranch: record.baseBranch,
      files,
      sections,
      diff: combined,
      truncated,
      filesTruncated,
      ...(selectedPath === undefined ? {} : { selectedPath }),
    };
  }

  async merge(sessionId: string, isRunning: boolean): Promise<{ readonly merged: true; readonly alreadyMerged: boolean; readonly baseBranch: string }> {
    return this.withMutation(async () => {
      await this.ensureRepository();
      const record = this.requireRecord(sessionId);
      if (isRunning) throw new TaskWorkspaceError("Stop the task before merging its worktree.", 409, "workspace-running");
      const worktree = await this.requireWorktree(record);
      const taskStatus = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktree);
      if (taskStatus) throw new TaskWorkspaceError("Commit or discard task changes before merging.", 409, "workspace-dirty");
      const merged = await this.isTaskBranchMerged(record);
      if (merged) return { merged: true, alreadyMerged: true, baseBranch: record.baseBranch };

      const targetBranch = await this.currentBranch(record.repositoryRoot);
      if (targetBranch !== record.baseBranch) {
        throw new TaskWorkspaceError("The base checkout is on a different branch; switch back to the task base branch before merging.", 409, "base-branch-changed");
      }
      const baseStatus = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], record.repositoryRoot);
      if (baseStatus) throw new TaskWorkspaceError("The base checkout has uncommitted changes; commit or stash them before merging.", 409, "base-worktree-dirty");

      try {
        await runGit(["merge", "--no-edit", "--no-ff", record.branch], record.repositoryRoot);
      } catch {
        const mergeHead = await execGit(["rev-parse", "--quiet", "--verify", "MERGE_HEAD"], record.repositoryRoot).catch(() => undefined);
        if (mergeHead?.exitCode === 0) await runGit(["merge", "--abort"], record.repositoryRoot).catch(() => undefined);
        throw new TaskWorkspaceError("Merge could not be completed. Any conflicted merge was aborted and the base checkout was restored.", 409, "merge-failed");
      }
      const updated = { ...record, mergedAt: new Date().toISOString() };
      this.records.set(sessionId, updated);
      await this.writeState();
      return { merged: true, alreadyMerged: false, baseBranch: record.baseBranch };
    });
  }

  async cleanup(sessionId: string, isRunning: boolean): Promise<{ readonly cleaned: true; readonly branchRetained: boolean }> {
    return this.withMutation(async () => {
      await this.ensureRepository();
      const record = this.requireRecord(sessionId);
      if (isRunning) throw new TaskWorkspaceError("Stop the task before removing its worktree.", 409, "workspace-running");
      if (record.cleanedAt) return { cleaned: true, branchRetained: true };
      const worktree = await this.requireWorktree(record);
      const status = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktree);
      if (status) throw new TaskWorkspaceError("The task worktree has uncommitted changes. Commit or discard them before cleanup.", 409, "workspace-dirty");

      await runGit(["worktree", "remove", record.path], record.repositoryRoot);
      const merged = await this.isTaskBranchMerged(record);
      let branchRetained = true;
      if (merged) {
        await runGit(["branch", "-d", record.branch], record.repositoryRoot);
        branchRetained = false;
      }
      this.records.set(sessionId, {
        ...record,
        ...(merged ? { mergedAt: record.mergedAt ?? new Date().toISOString() } : {}),
        cleanedAt: new Date().toISOString(),
      });
      await this.writeState();
      return { cleaned: true, branchRetained };
    });
  }

  private async summary(record: WorkspaceRecord, running: boolean): Promise<TaskWorkspaceSummary> {
    if (record.cleanedAt) {
      return {
        sessionId: record.sessionId,
        branch: record.branch,
        baseBranch: record.baseBranch,
        directory: displayPath(record.path),
        state: "cleaned",
        changedFiles: 0,
        dirty: false,
        merged: await this.isTaskBranchMerged(record),
        createdAt: record.createdAt,
      };
    }
    try {
      const worktree = await this.requireWorktree(record);
      const [status, merged] = await Promise.all([
        runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktree),
        this.isTaskBranchMerged(record),
      ]);
      const changedFiles = parseStatus(status).size;
      const state: TaskWorkspaceState = running ? "running" : changedFiles > 0 ? "dirty" : merged ? "merged" : "ready";
      return {
        sessionId: record.sessionId,
        branch: record.branch,
        baseBranch: record.baseBranch,
        directory: displayPath(record.path),
        state,
        changedFiles,
        dirty: changedFiles > 0,
        merged,
        createdAt: record.createdAt,
      };
    } catch {
      return {
        sessionId: record.sessionId,
        branch: record.branch,
        baseBranch: record.baseBranch,
        directory: displayPath(record.path),
        state: "missing",
        changedFiles: 0,
        dirty: false,
        merged: Boolean(record.mergedAt),
        createdAt: record.createdAt,
      };
    }
  }

  private requireRecord(sessionId: string): WorkspaceRecord {
    const record = this.records.get(sessionId);
    if (!record || record.repositoryRoot !== this.repositoryRoot) {
      throw new TaskWorkspaceError("Task workspace not found.", 404, "workspace-not-found");
    }
    if (record.cleanedAt) throw new TaskWorkspaceError("This task worktree was already cleaned up.", 409, "workspace-cleaned");
    return record;
  }

  private async requireWorktree(record: WorkspaceRecord): Promise<string> {
    if (!inside(this.worktreeDirectory, resolve(record.path)) || !existsSync(record.path)) {
      throw new TaskWorkspaceError("Task worktree is missing.", 404, "workspace-missing");
    }
    const actualPath = canonicalTaskWorktreePath(
      this.worktreeDirectory,
      record.path,
      record.sessionId,
    );
    if (!actualPath) {
      throw new TaskWorkspaceError("Task worktree path is invalid.", 409, "workspace-path-invalid");
    }
    const root = await runGit(["rev-parse", "--show-toplevel"], actualPath);
    if (resolve(root) !== actualPath || await this.ensureRepository() !== record.repositoryRoot) {
      throw new TaskWorkspaceError("Task worktree does not belong to this project.", 409, "workspace-repository-mismatch");
    }
    const branch = await runGit(["branch", "--show-current"], actualPath);
    if (branch !== record.branch) throw new TaskWorkspaceError("Task worktree branch does not match its registry.", 409, "workspace-branch-mismatch");
    return actualPath;
  }

  private async isTaskBranchMerged(record: WorkspaceRecord): Promise<boolean> {
    if (record.mergedAt) return true;
    try {
      const taskCommit = await runGit(["rev-parse", `${record.branch}^{commit}`], record.repositoryRoot);
      if (taskCommit === record.baseCommit) return false;
      return await this.isAncestor(record.branch, record.baseBranch, record.repositoryRoot);
    } catch {
      return false;
    }
  }

  private async ensureRepository(): Promise<string> {
    if (this.repositoryRoot) return this.repositoryRoot;
    this.repositoryPromise ??= (async () => {
      try {
        const actual = await runGit(["rev-parse", "--show-toplevel"], this.requestedRoot);
        const root = resolve(actual);
        this.repositoryRoot = root;
        for (const [sessionId, record] of this.records) {
          if (record.repositoryRoot !== root || !inside(this.worktreeDirectory, resolve(record.path))) {
            this.records.delete(sessionId);
          }
        }
        return root;
      } catch {
        throw new TaskWorkspaceError("The Desktop workspace is not a Git repository.", 409, "not-a-git-repository");
      }
    })();
    return this.repositoryPromise;
  }

  private async currentBranch(repositoryRoot: string): Promise<string> {
    try {
      const branch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], repositoryRoot);
      if (!/^[a-zA-Z0-9._/-]{1,200}$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
        throw new Error("invalid branch name");
      }
      return branch;
    } catch {
      throw new TaskWorkspaceError("Create task worktrees from a named local branch.", 409, "base-branch-unavailable");
    }
  }

  private async isAncestor(ancestor: string, descendant: string, cwd: string): Promise<boolean> {
    try {
      await runGit(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
      return true;
    } catch (error) {
      if (error instanceof TaskWorkspaceError && error.code === "git-failed") {
        const result = await execGit(["merge-base", "--is-ancestor", ancestor, descendant], cwd).catch(() => undefined);
        if (result?.exitCode === 1) return false;
      }
      return false;
    }
  }

  private readState(): void {
    try {
      const info = lstatSync(this.stateFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxStateBytes) return;
      const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as { version?: unknown; workspaces?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) return;
      for (const candidate of parsed.workspaces) {
        if (!safeRecord(candidate)) continue;
        if (!inside(this.worktreeDirectory, resolve(candidate.path))) continue;
        if (!canonicalTaskWorktreePath(this.worktreeDirectory, candidate.path, candidate.sessionId)) continue;
        this.records.set(candidate.sessionId, candidate);
      }
    } catch {
      // Missing or corrupt local workspace metadata does not prevent ordinary chats.
    }
  }

  private async writeState(): Promise<void> {
    const workspaces = [...this.records.values()];
    const serialized = JSON.stringify({ version: 1, workspaces });
    if (Buffer.byteLength(serialized, "utf8") > maxStateBytes) {
      throw new TaskWorkspaceError("Task workspace metadata exceeded its storage limit.", 413, "workspace-state-too-large");
    }
    await mkdir(dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      await rename(temporary, this.stateFile);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
