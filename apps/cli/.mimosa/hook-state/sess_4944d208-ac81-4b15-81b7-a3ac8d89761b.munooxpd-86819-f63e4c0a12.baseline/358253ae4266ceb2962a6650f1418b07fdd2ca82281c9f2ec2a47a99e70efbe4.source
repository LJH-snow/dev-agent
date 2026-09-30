import { copyFile, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import {
  type CollaborationDiff,
  type CollaborationMergeResult,
  type CollaborationReview,
  type CollaborationTask,
  type CollaborationValidation,
  type CollaborationWorkspace,
  type CollaborationWorkspaceProvider,
} from "@dev-agent/agent-core";
import { LocalExecutor, type Executor, type ExecutorResult } from "@dev-agent/executor";

const MAX_CHANGED_FILES = 256;
const MAX_UNTRACKED_FILES = 256;
const MAX_UNTRACKED_BYTES = 32 * 1024 * 1024;
const MAX_PATCH_BYTES = 16 * 1024 * 1024;

export interface GitCollaborationWorkspaceProviderOptions {
  readonly rootDirectory: string;
  readonly executor?: Executor;
  readonly collaborationRoot?: string;
}

interface OverlaySnapshot {
  readonly path: string;
  readonly bytes?: Buffer;
  readonly linkTarget?: string;
}

interface RepositorySnapshot {
  readonly baselineRevision: string;
  readonly overlay: readonly OverlaySnapshot[];
}

interface WorkspaceRecord {
  readonly workspace: CollaborationWorkspace;
  readonly baseline: RepositorySnapshot;
  readonly rootDirectory: string;
  readonly worktreePath: string;
  readonly createdAt: number;
  inspected?: InspectedWorkspace;
}

interface InspectedWorkspace extends CollaborationDiff {
  readonly patch: string;
  readonly changedUntracked: readonly string[];
}

/**
 * Git-backed isolation for collaborative agent tasks.
 *
 * The baseline is created with `git stash create`, which records tracked
 * staged and unstaged changes without modifying the caller's working tree.
 * Standard untracked files are copied into each worktree. The caller's tree
 * is not touched until `merge()` is explicitly called.
 */
export class GitCollaborationWorkspaceProvider implements CollaborationWorkspaceProvider {
  private readonly rootDirectory: string;
  private readonly executor: Executor;
  private readonly configuredCollaborationRoot?: string;
  private collaborationRoot?: string;
  private snapshotPromise?: Promise<RepositorySnapshot>;
  private readonly records = new Map<string, WorkspaceRecord>();

  constructor(options: GitCollaborationWorkspaceProviderOptions) {
    const rootDirectory = resolve(options.rootDirectory);
    if (rootDirectory.trim() === "") {
      throw new Error("collaboration root directory must not be empty");
    }
    this.rootDirectory = rootDirectory;
    this.executor = options.executor ?? new LocalExecutor();
    this.configuredCollaborationRoot = options.collaborationRoot;
  }

  async create(
    task: CollaborationTask,
    options: { readonly signal: AbortSignal },
  ): Promise<CollaborationWorkspace> {
    const baseline = await this.snapshot(options.signal);
    const root = await this.ensureCollaborationRoot();
    const worktreePath = join(root, `${safeName(task.id)}-${Date.now().toString(36)}`);
    await mkdir(dirname(worktreePath), { recursive: true });
    const added = await runGit(
      this.executor,
      this.rootDirectory,
      ["worktree", "add", "--detach", worktreePath, baseline.baselineRevision],
      undefined,
      options.signal,
    );
    if (added.exitCode !== 0) {
      throw new Error(`git worktree add failed: ${compactError(added)}`);
    }

    const canonicalWorktreePath = await realpath(worktreePath);
    const workspace: CollaborationWorkspace = {
      id: `worktree-${safeName(task.id)}-${Date.now().toString(36)}`,
      path: canonicalWorktreePath,
      mode: "worktree",
      baseRevision: baseline.baselineRevision,
    };
    const record: WorkspaceRecord = {
      workspace,
      baseline,
      rootDirectory: this.rootDirectory,
      worktreePath: canonicalWorktreePath,
      createdAt: Date.now(),
    };
    this.records.set(workspace.id, record);
    try {
      await copyOverlay(this.rootDirectory, worktreePath, baseline.overlay);
      return workspace;
    } catch (error) {
      await this.dispose(workspace);
      throw error;
    }
  }

  async inspect(
    workspace: CollaborationWorkspace,
    options: { readonly signal: AbortSignal },
  ): Promise<CollaborationDiff> {
    const record = this.requireRecord(workspace);
    return this.inspectRecord(record, options);
  }

  private async inspectRecord(
    record: WorkspaceRecord,
    options: { readonly signal: AbortSignal },
  ): Promise<InspectedWorkspace> {
    const patchResult = await runGit(
      this.executor,
      record.worktreePath,
      ["diff", "--binary", record.baseline.baselineRevision],
      undefined,
      options.signal,
    );
    if (patchResult.exitCode !== 0) {
      throw new Error(`git diff failed: ${compactError(patchResult)}`);
    }
    if (Buffer.byteLength(patchResult.stdout, "utf8") > MAX_PATCH_BYTES) {
      throw new Error(`collaboration diff exceeds ${MAX_PATCH_BYTES} bytes`);
    }

    const statusResult = await runGit(
      this.executor,
      record.worktreePath,
      ["status", "--short", "--untracked-files=all"],
      undefined,
      options.signal,
    );
    if (statusResult.exitCode !== 0) {
      throw new Error(`git status failed: ${compactError(statusResult)}`);
    }
    const statusPaths = parseStatusPaths(statusResult.stdout);
    const changedUntracked = statusPaths.filter((path) =>
      statusResult.stdout.split(/\r?\n/).some((line) => line.startsWith("?? ") && line.slice(3).trim() === path)
    );
    const numstatResult = await runGit(
      this.executor,
      record.worktreePath,
      ["diff", "--numstat", record.baseline.baselineRevision],
      undefined,
      options.signal,
    );
    if (numstatResult.exitCode !== 0) {
      throw new Error(`git numstat failed: ${compactError(numstatResult)}`);
    }
    const counts = parseNumstat(numstatResult.stdout);
    const changedFiles = [...new Set([...statusPaths, ...counts.paths])].slice(0, MAX_CHANGED_FILES);
    const untrackedPaths = [...new Set([
      ...record.baseline.overlay.map((item) => item.path),
      ...changedUntracked,
    ])].slice(0, MAX_UNTRACKED_FILES);
    const diff: InspectedWorkspace = {
      changedFiles,
      additions: counts.additions,
      deletions: counts.deletions,
      summary: `${changedFiles.length} file(s) changed`,
      patch: patchResult.stdout,
      changedUntracked: untrackedPaths,
    };
    record.inspected = diff;
    return diff;
  }

  async validate(
    workspace: CollaborationWorkspace,
    _task: CollaborationTask,
    options: { readonly signal: AbortSignal },
  ): Promise<CollaborationValidation> {
    const result = await runGit(
      this.executor,
      workspace.path,
      ["diff", "--check", workspace.baseRevision ?? "HEAD"],
      undefined,
      options.signal,
    );
    if (result.exitCode === 0) {
      return { status: "passed", summary: "git diff --check passed" };
    }
    return {
      status: "failed",
      summary: `git diff --check failed: ${compactError(result)}`,
    };
  }

  async merge(
    review: CollaborationReview,
    options: { readonly signal: AbortSignal },
  ): Promise<CollaborationMergeResult> {
    if (!review.mergeable || review.status !== "ready") {
      return {
        status: "failed",
        summary: "team result is not mergeable",
        conflicts: review.conflicts,
      };
    }

    const records = review.tasks
      .map((task) => task.workspace?.id)
      .filter((id): id is string => id !== undefined)
      .map((id) => this.records.get(id))
      .filter((record): record is WorkspaceRecord => record !== undefined);
    if (records.length !== review.tasks.length) {
      return {
        status: "failed",
        summary: "one or more task workspaces are no longer available",
      };
    }
    const baselineRevision = records[0]?.baseline.baselineRevision;
    if (!baselineRevision || records.some((record) => record.baseline.baselineRevision !== baselineRevision)) {
      return {
        status: "conflict",
        summary: "task workspaces were created from different baselines",
        conflicts: ["baseline"],
      };
    }

    const currentTracked = await runGit(
      this.executor,
      this.rootDirectory,
      ["diff", "--quiet", baselineRevision],
      undefined,
      options.signal,
    );
    if (currentTracked.exitCode !== 0) {
      return {
        status: "conflict",
        summary: "current tracked files changed after the team run started",
        conflicts: ["current working tree"],
      };
    }

    const inspected = await Promise.all(
      records.map(async (record) =>
        record.inspected ?? await this.inspectRecord(record, options)
      ),
    );
    const combinedPatch = inspected.map((item) => item.patch).filter(Boolean).join("\n");
    if (Buffer.byteLength(combinedPatch, "utf8") > MAX_PATCH_BYTES) {
      return {
        status: "failed",
        summary: `combined team diff exceeds ${MAX_PATCH_BYTES} bytes`,
      };
    }
    if (combinedPatch) {
      const check = await runGit(
        this.executor,
        this.rootDirectory,
        ["apply", "--binary", "--check", "-"],
        combinedPatch,
        options.signal,
      );
      if (check.exitCode !== 0) {
        return {
          status: "conflict",
          summary: "git apply --check rejected the team diff",
          conflicts: [compactError(check)],
        };
      }
    }

    const untrackedConflicts = await findUntrackedConflicts(
      this.rootDirectory,
      records,
      inspected,
    );
    if (untrackedConflicts.length > 0) {
      return {
        status: "conflict",
        summary: "untracked files changed while the team was running",
        conflicts: untrackedConflicts,
      };
    }

    if (combinedPatch) {
      const applied = await runGit(
        this.executor,
        this.rootDirectory,
        ["apply", "--binary", "-"],
        combinedPatch,
        options.signal,
      );
      if (applied.exitCode !== 0) {
        return {
          status: "conflict",
          summary: "team diff could not be applied",
          conflicts: [compactError(applied)],
        };
      }
    }
    await applyUntrackedChanges(this.rootDirectory, records, inspected);
    await Promise.all(records.map((record) => this.dispose(record.workspace)));
    return {
      status: "merged",
      summary: `merged ${review.changedFiles.length} file(s)`,
    };
  }

  async dispose(workspace: CollaborationWorkspace): Promise<void> {
    const record = this.records.get(workspace.id);
    if (!record) return;
    this.records.delete(workspace.id);
    const result = await runGit(
      this.executor,
      this.rootDirectory,
      ["worktree", "remove", "--force", record.worktreePath],
    );
    if (result.exitCode !== 0) {
      await rm(record.worktreePath, { recursive: true, force: true });
    }
    if (this.records.size === 0 && this.collaborationRoot && !this.configuredCollaborationRoot) {
      await rm(this.collaborationRoot, { recursive: true, force: true });
      this.collaborationRoot = undefined;
    }
  }

  async disposeAll(): Promise<void> {
    const workspaces = [...this.records.values()].map((record) => record.workspace);
    await Promise.all(workspaces.map((workspace) => this.dispose(workspace)));
  }

  private requireRecord(workspace: CollaborationWorkspace): WorkspaceRecord {
    const record = this.records.get(workspace.id);
    if (!record) {
      throw new Error(`unknown collaboration workspace: ${workspace.id}`);
    }
    return record;
  }

  private async snapshot(signal: AbortSignal): Promise<RepositorySnapshot> {
    if (!this.snapshotPromise) {
      this.snapshotPromise = this.createSnapshot(signal);
    }
    return this.snapshotPromise;
  }

  private async createSnapshot(signal: AbortSignal): Promise<RepositorySnapshot> {
    const root = await runGit(
      this.executor,
      this.rootDirectory,
      ["rev-parse", "--show-toplevel"],
      undefined,
      signal,
    );
    if (root.exitCode !== 0) {
      throw new Error(`not a Git repository: ${compactError(root)}`);
    }
    const repositoryRoot = resolve(root.stdout.trim());
    const canonicalConfiguredRoot = await realpath(this.rootDirectory);
    if (repositoryRoot !== canonicalConfiguredRoot) {
      throw new Error(
        `collaboration root must be the Git repository root: ${repositoryRoot}`,
      );
    }
    const head = await runGit(this.executor, this.rootDirectory, ["rev-parse", "HEAD"], undefined, signal);
    if (head.exitCode !== 0) {
      throw new Error(`cannot resolve Git HEAD: ${compactError(head)}`);
    }
    const stash = await runGit(this.executor, this.rootDirectory, ["stash", "create"], undefined, signal);
    const baselineRevision = stash.exitCode === 0 && /^[0-9a-f]{40}$/u.test(stash.stdout.trim())
      ? stash.stdout.trim()
      : head.stdout.trim();
    const untracked = await runGit(
      this.executor,
      this.rootDirectory,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      undefined,
      signal,
    );
    if (untracked.exitCode !== 0) {
      throw new Error(`cannot list untracked files: ${compactError(untracked)}`);
    }
    const overlay = await captureOverlay(this.rootDirectory, parseNullList(untracked.stdout));
    return { baselineRevision, overlay };
  }

  private async ensureCollaborationRoot(): Promise<string> {
    if (this.collaborationRoot) return this.collaborationRoot;
    if (this.configuredCollaborationRoot) {
      this.collaborationRoot = resolve(this.configuredCollaborationRoot);
      await mkdir(this.collaborationRoot, { recursive: true });
    } else {
      this.collaborationRoot = await mkdtemp(join(tmpdir(), "dev-agent-team-"));
    }
    return this.collaborationRoot;
  }
}

async function runGit(
  executor: Executor,
  cwd: string,
  args: readonly string[],
  input?: string,
  signal?: AbortSignal,
): Promise<ExecutorResult> {
  return executor.run("git", args, {
    cwd,
    ...(input === undefined ? {} : { input }),
    ...(signal === undefined ? {} : { signal }),
    maxOutputBytes: MAX_PATCH_BYTES,
  });
}

async function captureOverlay(
  rootDirectory: string,
  paths: readonly string[],
): Promise<readonly OverlaySnapshot[]> {
  const overlay: OverlaySnapshot[] = [];
  let totalBytes = 0;
  for (const path of paths.slice(0, MAX_UNTRACKED_FILES)) {
    const relativePath = safeRelativePath(path);
    const source = resolve(rootDirectory, relativePath);
    const info = await lstat(source);
    if (info.isSymbolicLink()) {
      const linkTarget = await readlink(source);
      assertSafeSymlink(rootDirectory, source, linkTarget);
      overlay.push({ path: relativePath, linkTarget });
      continue;
    }
    if (!info.isFile()) continue;
    totalBytes += info.size;
    if (totalBytes > MAX_UNTRACKED_BYTES) {
      throw new Error(`untracked overlay exceeds ${MAX_UNTRACKED_BYTES} bytes`);
    }
    overlay.push({ path: relativePath, bytes: await readFile(source) });
  }
  return overlay;
}

async function copyOverlay(
  rootDirectory: string,
  worktreePath: string,
  overlay: readonly OverlaySnapshot[],
): Promise<void> {
  for (const item of overlay) {
    const destination = resolve(worktreePath, item.path);
    await mkdir(dirname(destination), { recursive: true });
    if (item.linkTarget !== undefined) {
      await symlink(item.linkTarget, destination);
    } else {
      await copyFile(resolve(rootDirectory, item.path), destination);
    }
  }
}

async function findUntrackedConflicts(
  rootDirectory: string,
  records: readonly WorkspaceRecord[],
  inspected: readonly InspectedWorkspace[],
): Promise<readonly string[]> {
  const conflicts: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const diff = inspected[index]!;
    const baseline = new Map(record.baseline.overlay.map((item) => [item.path, item]));
    for (const path of diff.changedUntracked) {
      const current = await readOverlayValue(resolve(rootDirectory, path));
      const original = baseline.get(path);
      if (!sameOverlayValue(current, original)) {
        conflicts.push(path);
      }
    }
  }
  return [...new Set(conflicts)].slice(0, MAX_CHANGED_FILES);
}

async function applyUntrackedChanges(
  rootDirectory: string,
  records: readonly WorkspaceRecord[],
  inspected: readonly InspectedWorkspace[],
): Promise<void> {
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const diff = inspected[index]!;
    const baseline = new Map(record.baseline.overlay.map((item) => [item.path, item]));
    for (const path of diff.changedUntracked) {
      const source = resolve(record.worktreePath, path);
      const destination = resolve(rootDirectory, path);
      const current = await readOverlayValue(source);
      const original = baseline.get(path);
      if (sameOverlayValue(current, original)) continue;
      await mkdir(dirname(destination), { recursive: true });
      if (current === undefined) {
        await unlink(destination).catch(() => undefined);
      } else if (current.linkTarget !== undefined) {
        await unlink(destination).catch(() => undefined);
        await symlink(current.linkTarget, destination);
      } else if (current.bytes !== undefined) {
        await copyFile(source, destination);
      }
    }
  }
}

async function readOverlayValue(path: string): Promise<OverlaySnapshot | undefined> {
  try {
    const info = await lstat(path);
    const relativePath = path;
    if (info.isSymbolicLink()) {
      return { path: relativePath, linkTarget: await readlink(path) };
    }
    if (info.isFile()) {
      return { path: relativePath, bytes: await readFile(path) };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function parseStatusPaths(output: string): readonly string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 4)
    .map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
    .filter(Boolean)
    .slice(0, MAX_CHANGED_FILES);
}

function parseNumstat(output: string): {
  readonly additions: number;
  readonly deletions: number;
  readonly paths: readonly string[];
} {
  let additions = 0;
  let deletions = 0;
  const paths: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/u);
    if (!match) continue;
    additions += match[1] === "-" ? 0 : Number(match[1]);
    deletions += match[2] === "-" ? 0 : Number(match[2]);
    paths.push(match[3]!);
  }
  return { additions, deletions, paths };
}

function parseNullList(output: string): readonly string[] {
  return output.split("\u0000").filter(Boolean);
}

function safeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized === "" ||
    isAbsolute(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`unsafe collaboration path: ${path}`);
  }
  return normalized;
}

function assertSafeSymlink(rootDirectory: string, source: string, target: string): void {
  const resolvedTarget = resolve(dirname(source), target);
  const root = resolve(rootDirectory);
  if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${sep}`)) {
    throw new Error(`untracked symlink escapes the workspace: ${source}`);
  }
}

function sameOverlayValue(
  left: OverlaySnapshot | undefined,
  right: OverlaySnapshot | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.linkTarget !== undefined || right.linkTarget !== undefined) {
    return left.linkTarget === right.linkTarget;
  }
  return left.bytes?.equals(right.bytes ?? Buffer.alloc(0)) ?? right.bytes === undefined;
}

function compactError(result: ExecutorResult): string {
  return (result.stderr || result.stdout || `exit ${result.exitCode}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "task";
}
