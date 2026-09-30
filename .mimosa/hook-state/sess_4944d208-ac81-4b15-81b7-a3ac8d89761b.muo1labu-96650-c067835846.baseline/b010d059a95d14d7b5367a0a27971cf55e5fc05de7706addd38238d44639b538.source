import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { ChatSession } from "../dist/chat-session.js";
import { createDesktopServer } from "../dist/server.js";

const capability = "test-capability-token";

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
      GIT_AUTHOR_NAME: "Desktop validation tests",
      GIT_AUTHOR_EMAIL: "desktop-validation@example.invalid",
      GIT_COMMITTER_NAME: "Desktop validation tests",
      GIT_COMMITTER_EMAIL: "desktop-validation@example.invalid",
    },
  }).trim();
}

function preserveEnvironment(keys: readonly string[]): () => void {
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  return () => {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function createRepository() {
  const container = await mkdtemp(join(tmpdir(), "dev-agent-desktop-validation-"));
  const root = join(container, "repo");
  const worktreeDirectory = join(container, "worktrees");
  const workspaceStateFile = join(container, "workspace-state.json");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(root));
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Desktop validation tests");
  git(root, "config", "user.email", "desktop-validation@example.invalid");
  git(root, "branch", "-M", "main");
  await writeFile(join(root, "README.md"), "base\n", "utf8");
  git(root, "add", "README.md");
  git(root, "commit", "--quiet", "-m", "initial");
  return { container, root, worktreeDirectory, workspaceStateFile };
}

function makeSession(sessionId: string, mode: "pass" | "cancel" | "fail-once", workingDirectory?: string) {
  let validationRuns = 0;
  return {
    id: sessionId,
    workingDirectory,
    async run() {},
    prepareTaskValidation(changedPaths: readonly string[], options: { validationId?: string } = {}) {
      return {
        validationId: options.validationId ?? "task-validation:test",
        changeSetId: `task:${sessionId}`,
        status: "ready" as const,
        checks: [{
          id: "task:check",
          label: changedPaths.length > 0 ? "Task check" : "No-change check",
          command: {
            executable: "node",
            args: ["-e", "process.exit(0)"],
            cwd: workingDirectory ?? process.cwd(),
            timeoutMs: 5_000,
          },
        }],
        summary: `${changedPaths.length} changed path(s) planned`,
      };
    },
    async runTaskValidation(plan: any, options: { signal?: AbortSignal } = {}) {
      if (mode === "cancel") {
        await new Promise<void>((resolve) => {
          if (options.signal?.aborted) {
            resolve();
            return;
          }
          options.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          validationId: plan.validationId,
          changeSetId: plan.changeSetId,
          status: "blocked" as const,
          checks: [{
            ...plan.checks[0],
            status: "blocked" as const,
            durationMs: 1,
            reason: "validation aborted while the check was running",
            output: "secret output must stay out of the snapshot",
          }],
          durationMs: 1,
          summary: "validation blocked: cancelled",
          reason: "validation was aborted",
        };
      }
      validationRuns += 1;
      const failed = mode === "fail-once" && validationRuns === 1;
      return {
        validationId: plan.validationId,
        changeSetId: plan.changeSetId,
        status: failed ? "failed" as const : "passed" as const,
        checks: [{
          ...plan.checks[0],
          status: failed ? "failed" as const : "passed" as const,
          durationMs: 3,
          ...(failed ? { exitCode: 1, reason: "check failed once for rerun coverage" } : { exitCode: 0 }),
          output: "secret output must stay out of the snapshot",
        }],
        durationMs: 3,
        summary: failed ? "validation failed: 1 failed" : "validation passed: 1 passed",
      };
    },
  };
}

function createServer(
  repo: Awaited<ReturnType<typeof createRepository>>,
  mode: "pass" | "cancel" | "fail-once" = "pass",
) {
  return createDesktopServer({
    session: makeSession("desktop-default", mode),
    workspaceRoot: repo.root,
    worktreeDirectory: repo.worktreeDirectory,
    workspaceStateFile: repo.workspaceStateFile,
    createSession: (sessionId, workingDirectory) => makeSession(sessionId, mode, workingDirectory),
    capabilityToken: capability,
  });
}

async function createWorkspace(base: string) {
  const response = await fetch(`${base}/api/workspaces`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dev-agent-capability": capability,
    },
    body: JSON.stringify({}),
  });
  return { response, payload: await response.json() as any };
}

test("real ChatSession binds task validation plans to its worktree and runs safe checks", async () => {
  const repo = await createRepository();
  const restoreEnv = preserveEnvironment([
    "DEV_AGENT_MODEL_PROVIDER",
    "DEV_AGENT_MEMORY_FILE",
    "DEV_AGENT_MCP_SERVERS",
  ]);
  let session: ChatSession | undefined;
  try {
    process.env.DEV_AGENT_MODEL_PROVIDER = "ollama";
    process.env.DEV_AGENT_MEMORY_FILE = join(repo.container, "real-session.json");
    process.env.DEV_AGENT_MCP_SERVERS = "[]";
    await writeFile(join(repo.root, "README.md"), "changed\n", "utf8");

    session = new ChatSession({
      sessionId: "real-task-session",
      workingDirectory: repo.root,
      validationPolicy: "fast",
    });
    const plan = await session.prepareTaskValidation(["README.md"], {
      validationId: "task-validation:real",
    });

    assert.equal(plan.changeSetId, "task:real-task-session");
    assert.equal(plan.validationId, "task-validation:real");
    assert.equal(plan.status, "ready");
    assert.ok(plan.checks.length > 0);
    assert.ok(plan.checks.every((check) => check.command.cwd === repo.root));
    assert.deepEqual(plan.checks.at(-1)?.command.args, ["diff", "--check", "--", "README.md"]);

    const result = await session.runTaskValidation(plan);
    assert.equal(result.status, "passed");
    assert.equal(result.checks.length, plan.checks.length);

    const escaped = await session.prepareTaskValidation(["../outside.txt"]);
    assert.equal(escaped.status, "blocked");
    assert.equal(escaped.checks.length, 0);
  } finally {
    await session?.close();
    restoreEnv();
    await rm(repo.container, { recursive: true, force: true });
  }
});

async function waitForState(base: string, sessionId: string, expected: string): Promise<any> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${base}/api/task-validation?sessionId=${encodeURIComponent(sessionId)}`);
    const payload = await response.json() as any;
    if (payload.state === expected) return payload;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`task validation did not reach ${expected}`);
}

test("task validation derives paths from the task worktree and exposes bounded metadata", async () => {
  const repo = await createRepository();
  const server = createServer(repo, "pass");
  const base = await start(server);
  try {
    const { payload: workspace } = await createWorkspace(base);
    await writeFile(join(repo.worktreeDirectory, workspace.sessionId, "task.txt"), "change\n", "utf8");

    const idle = await fetch(`${base}/api/task-validation?sessionId=${workspace.sessionId}`);
    assert.equal(idle.status, 200);
    assert.equal((await idle.json() as any).state, "idle");

    const missingCapability = await fetch(`${base}/api/task-validation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: workspace.sessionId }),
    });
    assert.equal(missingCapability.status, 403);

    const started = await fetch(`${base}/api/task-validation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dev-agent-capability": capability,
      },
      body: JSON.stringify({ sessionId: workspace.sessionId }),
    });
    assert.equal(started.status, 202);
    const initial = await started.json() as any;
    assert.equal(initial.state, "running");
    assert.equal(initial.changedFiles, 1);
    assert.equal(initial.checks[0].label, "Task check");
    assert.equal("command" in initial.checks[0], false);
    assert.equal("output" in initial, false);

    const result = await waitForState(base, workspace.sessionId, "passed");
    assert.equal(result.summary, "validation passed: 1 passed");
    assert.equal(result.checks[0].state, "passed");
    assert.equal("output" in result.checks[0], false);
    assert.equal("command" in result.checks[0], false);
  } finally {
    await close(server);
    await rm(repo.container, { recursive: true, force: true });
  }
});

test("task validation is exclusive with terminal/merge and cancellation is fail-closed", async () => {
  const repo = await createRepository();
  const server = createServer(repo, "cancel");
  const base = await start(server);
  try {
    const { payload: workspace } = await createWorkspace(base);
    await writeFile(join(repo.worktreeDirectory, workspace.sessionId, "task.txt"), "change\n", "utf8");

    const started = await fetch(`${base}/api/task-validation`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-agent-capability": capability },
      body: JSON.stringify({ sessionId: workspace.sessionId }),
    });
    assert.equal(started.status, 202);

    const terminal = await fetch(`${base}/api/terminal`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-agent-capability": capability },
      body: JSON.stringify({ sessionId: workspace.sessionId, command: "printf blocked\\n" }),
    });
    assert.equal(terminal.status, 409);
    assert.equal((await terminal.json() as any).code, "task-validation-running");

    const merge = await fetch(`${base}/api/workspaces/${workspace.sessionId}/merge`, {
      method: "POST",
      headers: { "x-dev-agent-capability": capability },
    });
    assert.equal(merge.status, 409);
    assert.equal((await merge.json() as any).code, "workspace-running");

    const cancelled = await fetch(`${base}/api/task-validation/${workspace.sessionId}`, {
      method: "DELETE",
      headers: { "x-dev-agent-capability": capability },
    });
    assert.equal(cancelled.status, 202);
    assert.equal((await cancelled.json() as any).cancelRequested, true);

    const result = await waitForState(base, workspace.sessionId, "blocked");
    assert.equal(result.cancelRequested, true);
    assert.match(result.failureSummary, /cancelled|aborted/i);
    assert.doesNotMatch(JSON.stringify(result), /secret output/);
  } finally {
    await close(server);
    await rm(repo.container, { recursive: true, force: true });
  }
});

test("task validation can rerun only the previous failed checks", async () => {
  const repo = await createRepository();
  const server = createServer(repo, "fail-once");
  const base = await start(server);
  try {
    const { payload: workspace } = await createWorkspace(base);
    await writeFile(join(repo.worktreeDirectory, workspace.sessionId, "task.txt"), "change\n", "utf8");

    const first = await fetch(`${base}/api/task-validation`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-agent-capability": capability },
      body: JSON.stringify({ sessionId: workspace.sessionId }),
    });
    assert.equal(first.status, 202);
    const failed = await waitForState(base, workspace.sessionId, "failed");
    assert.equal(failed.mode, "all");
    assert.equal(failed.checks[0].state, "failed");

    const rerun = await fetch(`${base}/api/task-validation`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-agent-capability": capability },
      body: JSON.stringify({ sessionId: workspace.sessionId, mode: "failed" }),
    });
    assert.equal(rerun.status, 202);
    const pending = await rerun.json() as any;
    assert.equal(pending.mode, "failed");
    assert.equal(pending.checks.length, 1);

    const passed = await waitForState(base, workspace.sessionId, "passed");
    assert.equal(passed.mode, "failed");
    assert.equal(passed.summary, "validation passed: 1 passed");

    const noFailedChecks = await fetch(`${base}/api/task-validation`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-agent-capability": capability },
      body: JSON.stringify({ sessionId: workspace.sessionId, mode: "failed" }),
    });
    assert.equal(noFailedChecks.status, 409);
    assert.equal((await noFailedChecks.json() as any).code, "task-validation-no-failed-checks");

    const invalidMode = await fetch(`${base}/api/task-validation`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-agent-capability": capability },
      body: JSON.stringify({ sessionId: workspace.sessionId, mode: "arbitrary-command" }),
    });
    assert.equal(invalidMode.status, 400);

    const arbitraryField = await fetch(`${base}/api/task-validation`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-agent-capability": capability },
      body: JSON.stringify({ sessionId: workspace.sessionId, command: "node evil.js" }),
    });
    assert.equal(arbitraryField.status, 400);
  } finally {
    await close(server);
    await rm(repo.container, { recursive: true, force: true });
  }
});
