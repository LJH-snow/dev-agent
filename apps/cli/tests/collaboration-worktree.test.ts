import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { LocalExecutor } from "@dev-agent/executor";
import type {
  CollaborationReview,
  CollaborationTask,
  CollaborationWorkspace,
} from "@dev-agent/agent-core";
import {
  GitCollaborationWorkspaceProvider,
} from "../dist/collaboration-worktree.js";

const task: CollaborationTask = {
  id: "worker",
  title: "Worker",
  instructions: "make the change",
};

async function git(cwd: string, args: readonly string[], input?: string): Promise<string> {
  const result = await new LocalExecutor().run("git", args, {
    cwd,
    input,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-team-repo-"));
  await git(directory, ["init", "-q"]);
  await git(directory, ["config", "user.email", "dev-agent@example.invalid"]);
  await git(directory, ["config", "user.name", "Dev Agent Tests"]);
  await writeFile(join(directory, "README.md"), "base\n", "utf8");
  await git(directory, ["add", "README.md"]);
  await git(directory, ["commit", "-m", "initial", "-q"]);
  return directory;
}

function reviewFor(
  workspace: CollaborationWorkspace,
  diff: {
    readonly changedFiles: readonly string[];
    readonly additions: number;
    readonly deletions: number;
  },
): CollaborationReview {
  return {
    status: "ready",
    mergeable: true,
    changedFiles: [...diff.changedFiles],
    additions: diff.additions,
    deletions: diff.deletions,
    conflicts: [],
    tasks: [{
      id: task.id,
      title: task.title,
      dependsOn: [],
      status: "completed",
      attempts: 1,
      durationMs: 1,
      text: "done",
      workspace,
      diff,
    }],
  };
}

test("creates and removes a detached task worktree", async () => {
  const repository = await createRepository();
  const provider = new GitCollaborationWorkspaceProvider({
    rootDirectory: repository,
  });
  try {
    const workspace = await provider.create(task, { signal: new AbortController().signal });
    assert.notEqual(workspace.path, repository);
    assert.equal(await git(workspace.path, ["rev-parse", "--show-toplevel"]), workspace.path);
    assert.equal(await readFile(join(workspace.path, "README.md"), "utf8"), "base\n");
    await provider.dispose(workspace);
    await assert.rejects(readFile(join(workspace.path, "README.md"), "utf8"));
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("starts each task from the caller's tracked and untracked workspace state", async () => {
  const repository = await createRepository();
  await writeFile(join(repository, "README.md"), "dirty tracked\n", "utf8");
  await writeFile(join(repository, "notes.md"), "dirty untracked\n", "utf8");
  const provider = new GitCollaborationWorkspaceProvider({
    rootDirectory: repository,
  });
  try {
    const workspace = await provider.create(task, { signal: new AbortController().signal });
    assert.equal(await readFile(join(workspace.path, "README.md"), "utf8"), "dirty tracked\n");
    assert.equal(await readFile(join(workspace.path, "notes.md"), "utf8"), "dirty untracked\n");
    await provider.dispose(workspace);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("merges a reviewed task patch and rejects a current-worktree conflict", async () => {
  const repository = await createRepository();
  const provider = new GitCollaborationWorkspaceProvider({
    rootDirectory: repository,
  });
  try {
    const workspace = await provider.create(task, { signal: new AbortController().signal });
    await writeFile(join(workspace.path, "README.md"), "merged\n", "utf8");
    const diff = await provider.inspect(workspace, { signal: new AbortController().signal });
    const review = reviewFor(workspace, diff);
    const merged = await provider.merge!(review, { signal: new AbortController().signal });
    assert.equal(merged.status, "merged");
    assert.equal(await readFile(join(repository, "README.md"), "utf8"), "merged\n");

    const conflictingWorkspace = await provider.create(task, {
      signal: new AbortController().signal,
    });
    await writeFile(join(conflictingWorkspace.path, "README.md"), "agent change\n", "utf8");
    await writeFile(join(repository, "README.md"), "user change\n", "utf8");
    const conflictingDiff = await provider.inspect(conflictingWorkspace, {
      signal: new AbortController().signal,
    });
    const conflict = await provider.merge!(
      reviewFor(conflictingWorkspace, conflictingDiff),
      { signal: new AbortController().signal },
    );
    assert.equal(conflict.status, "conflict");
    assert.deepEqual(conflict.conflicts?.length, 1);
    assert.equal(await readFile(join(repository, "README.md"), "utf8"), "user change\n");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
