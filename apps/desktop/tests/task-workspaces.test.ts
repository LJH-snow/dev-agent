import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";

function start(server: any): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as any;
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function close(server: any): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Desktop tests",
      GIT_AUTHOR_EMAIL: "desktop-tests@example.invalid",
      GIT_COMMITTER_NAME: "Desktop tests",
      GIT_COMMITTER_EMAIL: "desktop-tests@example.invalid",
    },
  }).trim();
}

async function createRepository() {
  const container = await mkdtemp(join(tmpdir(), "dev-agent-desktop-workspace-"));
  const root = join(container, "repo");
  const worktreeDirectory = join(container, "worktrees");
  const workspaceStateFile = join(container, "workspace-state.json");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(root));
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Desktop tests");
  git(root, "config", "user.email", "desktop-tests@example.invalid");
  git(root, "branch", "-M", "main");
  await writeFile(join(root, "README.md"), "base\n", "utf8");
  git(root, "add", "README.md");
  git(root, "commit", "--quiet", "-m", "initial");
  return { container, root, worktreeDirectory, workspaceStateFile };
}

function fakeSession(sessionId: string, workingDirectory?: string) {
  return {
    id: sessionId,
    workingDirectory,
    async run() {},
  };
}

function createServer(
  repo: Awaited<ReturnType<typeof createRepository>>,
  createdDirectories: Map<string, string>,
) {
  return createDesktopServer({
    session: fakeSession("desktop-default"),
    workspaceRoot: repo.root,
    worktreeDirectory: repo.worktreeDirectory,
    workspaceStateFile: repo.workspaceStateFile,
    createSession: (sessionId, workingDirectory) => {
      if (workingDirectory) createdDirectories.set(sessionId, workingDirectory);
      return fakeSession(sessionId, workingDirectory);
    },
  });
}

async function createWorkspace(base: string) {
  const response = await fetch(`${base}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return { response, payload: await response.json() as any };
}

test("Desktop creates an isolated task worktree and assigns its session to that directory", async () => {
  const repo = await createRepository();
  const createdDirectories = new Map<string, string>();
  const server = createServer(repo, createdDirectories);
  const base = await start(server);
  try {
    const { response, payload } = await createWorkspace(base);
    assert.equal(response.status, 201);
    assert.match(payload.sessionId, /^task-[a-z0-9-]+$/);
    assert.equal(payload.branch, `dev-agent/${payload.sessionId}`);
    assert.equal(payload.baseBranch, "main");
    assert.equal(payload.state, "ready");
    assert.equal(payload.changedFiles, 0);
    const expectedWorktree = realpathSync(join(repo.worktreeDirectory, payload.sessionId));
    assert.equal(createdDirectories.get(payload.sessionId), expectedWorktree);
    assert.equal(git(expectedWorktree, "branch", "--show-current"), payload.branch);
    assert.match(payload.directory, new RegExp(payload.sessionId));
    assert.equal(payload.directory.includes(repo.container), false, "the API uses a display path, not the absolute host path");

    const listResponse = await fetch(`${base}/api/workspaces`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json() as any;
    assert.equal(list.available, true);
    assert.equal(list.workspaces.length, 1);
    assert.equal(list.workspaces[0].sessionId, payload.sessionId);

    const renameResponse = await fetch(`${base}/api/sessions/${payload.sessionId}/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "renamed-task" }),
    });
    assert.equal(renameResponse.status, 409, "a task session cannot be detached from its worktree branch");
  } finally {
    await close(server);
    await rm(repo.container, { recursive: true, force: true });
  }
});

test("Desktop exposes bounded task status and a full working-tree diff for comparison", async () => {
  const repo = await createRepository();
  const server = createServer(repo, new Map());
  const base = await start(server);
  try {
    const { payload } = await createWorkspace(base);
    const worktreePath = join(repo.worktreeDirectory, payload.sessionId);
    await writeFile(join(worktreePath, "README.md"), "base\nchanged in isolated task\n", "utf8");

    const listResponse = await fetch(`${base}/api/workspaces`);
    const list = await listResponse.json() as any;
    assert.equal(list.workspaces[0].state, "dirty");
    assert.equal(list.workspaces[0].changedFiles, 1);

    const diffResponse = await fetch(`${base}/api/workspaces/${payload.sessionId}/diff`);
    assert.equal(diffResponse.status, 200);
    const diff = await diffResponse.json() as any;
    assert.equal(diff.sessionId, payload.sessionId);
    assert.equal(diff.files[0].path, "README.md");
    assert.match(diff.diff, /changed in isolated task/);
    assert.equal(diff.truncated, false);
  } finally {
    await close(server);
    await rm(repo.container, { recursive: true, force: true });
  }
});

test("Desktop separates committed, staged, unstaged, and untracked task diffs with literal file filtering", async () => {
  const repo = await createRepository();
  const server = createServer(repo, new Map());
  const base = await start(server);
  try {
    const { payload } = await createWorkspace(base);
    const worktreePath = join(repo.worktreeDirectory, payload.sessionId);

    await writeFile(join(worktreePath, "committed.txt"), "committed line\n", "utf8");
    git(worktreePath, "add", "committed.txt");
    git(worktreePath, "commit", "--quiet", "-m", "committed task change");

    await writeFile(join(worktreePath, "both.txt"), "staged line\n", "utf8");
    git(worktreePath, "add", "both.txt");
    await writeFile(join(worktreePath, "both.txt"), "staged line\nunstaged line\n", "utf8");

    await writeFile(join(worktreePath, "literal[1].txt"), "untracked line\n", "utf8");

    const response = await fetch(`${base}/api/workspaces/${payload.sessionId}/diff`);
    assert.equal(response.status, 200);
    const diff = await response.json() as any;
    const byPath = new Map<string, any>(diff.files.map((file: any) => [file.path, file]));
    assert.deepEqual(byPath.get("both.txt").groups, ["staged", "unstaged"]);
    assert.deepEqual(byPath.get("committed.txt").groups, ["committed"]);
    assert.deepEqual(byPath.get("literal[1].txt").groups, ["untracked"]);
    assert.match(diff.sections.find((section: any) => section.group === "staged").diff, /staged line/);
    assert.match(diff.sections.find((section: any) => section.group === "unstaged").diff, /unstaged line/);
    assert.match(diff.sections.find((section: any) => section.group === "committed").diff, /committed line/);
    assert.match(diff.sections.find((section: any) => section.group === "untracked").diff, /untracked line/);

    const selected = await fetch(`${base}/api/workspaces/${payload.sessionId}/diff?path=${encodeURIComponent("literal[1].txt")}`);
    assert.equal(selected.status, 200);
    const selectedDiff = await selected.json() as any;
    assert.equal(selectedDiff.selectedPath, "literal[1].txt");
    assert.deepEqual(selectedDiff.files.map((file: any) => file.path), ["literal[1].txt"]);
    assert.match(selectedDiff.sections.find((section: any) => section.group === "untracked").diff, /untracked line/);

    const missing = await fetch(`${base}/api/workspaces/${payload.sessionId}/diff?path=${encodeURIComponent("missing.txt")}`);
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
    await rm(repo.container, { recursive: true, force: true });
  }
});

test("Desktop merges only committed task changes into a clean base worktree", async () => {
  const repo = await createRepository();
  const server = createServer(repo, new Map());
  const base = await start(server);
  try {
    const { payload } = await createWorkspace(base);
    const worktreePath = join(repo.worktreeDirectory, payload.sessionId);
    await writeFile(join(worktreePath, "task.txt"), "isolated result\n", "utf8");
    git(worktreePath, "add", "task.txt");
    git(worktreePath, "commit", "--quiet", "-m", "task result");

    const mergeResponse = await fetch(`${base}/api/workspaces/${payload.sessionId}/merge`, { method: "POST" });
    assert.equal(mergeResponse.status, 200);
    assert.equal((await readFile(join(repo.root, "task.txt"), "utf8")), "isolated result\n");
    assert.equal(git(repo.root, "status", "--porcelain"), "");
  } finally {
    await close(server);
    await rm(repo.container, { recursive: true, force: true });
  }
});

test("Desktop refuses destructive cleanup for dirty task worktrees and cleans after they are clean", async () => {
  const repo = await createRepository();
  const server = createServer(repo, new Map());
  const base = await start(server);
  try {
    const { payload } = await createWorkspace(base);
    const worktreePath = join(repo.worktreeDirectory, payload.sessionId);
    await writeFile(join(worktreePath, "README.md"), "uncommitted change\n", "utf8");

    const refused = await fetch(`${base}/api/workspaces/${payload.sessionId}`, { method: "DELETE" });
    assert.equal(refused.status, 409);
    assert.equal(git(worktreePath, "rev-parse", "--show-toplevel"), await realpath(worktreePath));

    git(worktreePath, "checkout", "--", "README.md");
    const cleaned = await fetch(`${base}/api/workspaces/${payload.sessionId}`, { method: "DELETE" });
    assert.equal(cleaned.status, 200);
    const result = await cleaned.json() as any;
    assert.equal(result.cleaned, true);
    assert.equal(result.branchRetained, true, "unmerged branch history is preserved during cleanup");

    const listResponse = await fetch(`${base}/api/workspaces`);
    const list = await listResponse.json() as any;
    assert.equal(list.workspaces[0].state, "cleaned");
  } finally {
    await close(server);
    await rm(repo.container, { recursive: true, force: true });
  }
});

test("Desktop restores the isolated working directory when a task session is reloaded", async () => {
  const repo = await createRepository();
  const firstSessions = new Map<string, string>();
  const firstServer = createServer(repo, firstSessions);
  const firstBase = await start(firstServer);
  let sessionId = "";
  let workspacePath = "";
  try {
    const { payload } = await createWorkspace(firstBase);
    sessionId = payload.sessionId;
    workspacePath = join(repo.worktreeDirectory, sessionId);
  } finally {
    await close(firstServer);
  }

  const restoredSessions = new Map<string, string>();
  const restoredServer = createServer(repo, restoredSessions);
  const restoredBase = await start(restoredServer);
  try {
    const status = await fetch(`${restoredBase}/api/status?sessionId=${encodeURIComponent(sessionId)}`);
    assert.equal(status.status, 200);
    assert.equal(restoredSessions.get(sessionId), realpathSync(workspacePath));
  } finally {
    await close(restoredServer);
    await rm(repo.container, { recursive: true, force: true });
  }
});
