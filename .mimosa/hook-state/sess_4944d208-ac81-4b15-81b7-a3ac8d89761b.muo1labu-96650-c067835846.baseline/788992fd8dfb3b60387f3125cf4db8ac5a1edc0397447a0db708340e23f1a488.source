import assert from "node:assert/strict";
import test from "node:test";

import {
  executeGitWorkflowCommand,
  parseGitWorkflowCommand,
  type GitWorkflowExecResult,
  type GitWorkflowRunner,
} from "../dist/github-workflow-command.js";

function runnerFor(
  responses: Record<string, Partial<GitWorkflowExecResult> & { stdout?: string }>,
): { runner: GitWorkflowRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitWorkflowRunner = async (command, args) => {
    calls.push([command, ...args]);
    const key = [command, ...args].join(" ");
    const response = responses[key] ?? { exitCode: 0, stdout: "", stderr: "" };
    return {
      exitCode: response.exitCode ?? 0,
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      ...(response.timedOut === undefined ? {} : { timedOut: response.timedOut }),
    };
  };
  return { runner, calls };
}

const baseOptions = {
  cwd: "/workspace/project",
};

test("parses GitHub workflow commands with bounded arguments", () => {
  assert.deepEqual(parseGitWorkflowCommand(":branch"), { kind: "status" });
  assert.deepEqual(parseGitWorkflowCommand("/branch create feature/fix"), {
    kind: "create-branch",
    name: "feature/fix",
  });
  assert.deepEqual(parseGitWorkflowCommand(':commit --all "fix parser"'), {
    kind: "commit",
    message: "fix parser",
    stageAll: true,
  });
  assert.deepEqual(parseGitWorkflowCommand(":push origin feature/fix"), {
    kind: "push",
    remote: "origin",
    branch: "feature/fix",
  });
  assert.deepEqual(parseGitWorkflowCommand(':pr --base main "Fix parser"'), {
    kind: "pr",
    title: "Fix parser",
    base: "main",
  });
  assert.equal(parseGitWorkflowCommand(":commit"), undefined);
  assert.equal(parseGitWorkflowCommand(":branch create -bad"), undefined);
});

test("branch status is read-only and returns bounded repository metadata", async () => {
  const { runner, calls } = runnerFor({
    "git symbolic-ref --quiet --short HEAD": { stdout: "feature/fix\n" },
    "git status --porcelain=v1 --untracked-files=all": { stdout: " M src/app.ts\n?? notes.md\n" },
    "git remote get-url origin": { stdout: "https://github.com/example/project.git\n" },
  });

  const result = await executeGitWorkflowCommand(":branch", {
    ...baseOptions,
    runner,
    confirm: async () => {
      throw new Error("status must not ask for confirmation");
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /feature\/fix/);
  assert.match(result.message, /2 changed file/);
  assert.match(result.message, /github\.com/);
  assert.deepEqual(calls, [
    ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
    ["git", "status", "--porcelain=v1", "--untracked-files=all"],
    ["git", "remote", "get-url", "origin"],
  ]);
});

test("branch creation requires confirmation and uses argument-safe git invocation", async () => {
  const { runner, calls } = runnerFor({
    "git switch --create feature/fix": { stdout: "" },
  });
  let prompted = "";
  const result = await executeGitWorkflowCommand(":branch create feature/fix", {
    ...baseOptions,
    runner,
    confirm: async (prompt) => {
      prompted = prompt;
      return true;
    },
  });

  assert.equal(result.ok, true);
  assert.match(prompted, /feature\/fix/);
  assert.match(result.message, /created/i);
  assert.deepEqual(calls, [["git", "switch", "--create", "feature/fix"]]);
});

test("commit runs diff-check before staging, refuses secret paths, and asks once", async () => {
  const { runner, calls } = runnerFor({
    "git symbolic-ref --quiet --short HEAD": { stdout: "feature/fix\n" },
    "git status --porcelain=v1 --untracked-files=all": { stdout: " M src/app.ts\n" },
    "git diff --check HEAD --": { stdout: "" },
    "git add --all -- .": { stdout: "" },
    "git commit --message fix parser": { stdout: "[feature/fix abc1234] fix parser\n" },
    "git rev-parse --short HEAD": { stdout: "abc1234\n" },
  });
  const result = await executeGitWorkflowCommand(':commit --all "fix parser"', {
    ...baseOptions,
    runner,
    confirm: async () => true,
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /abc1234/);
  assert.deepEqual(calls, [
    ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
    ["git", "status", "--porcelain=v1", "--untracked-files=all"],
    ["git", "diff", "--check", "HEAD", "--"],
    ["git", "add", "--all", "--", "."],
    ["git", "commit", "--message", "fix parser"],
    ["git", "rev-parse", "--short", "HEAD"],
  ]);

  const secret = await executeGitWorkflowCommand(':commit --all "oops"', {
    ...baseOptions,
    runner: runnerFor({
      "git symbolic-ref --quiet --short HEAD": { stdout: "feature/fix\n" },
      "git status --porcelain=v1 --untracked-files=all": { stdout: "?? .env\n" },
    }).runner,
    confirm: async () => {
      throw new Error("secret paths must fail before confirmation");
    },
  });
  assert.equal(secret.ok, false);
  assert.match(secret.message, /sensitive|secret|\.env/i);
});

test("push requires a clean worktree and explicit confirmation without force flags", async () => {
  const { runner, calls } = runnerFor({
    "git symbolic-ref --quiet --short HEAD": { stdout: "feature/fix\n" },
    "git status --porcelain=v1 --untracked-files=all": { stdout: "" },
    "git remote get-url origin": { stdout: "https://github.com/example/project.git\n" },
    "git push --set-upstream origin feature/fix": { stdout: "branch 'feature/fix' set up\n" },
  });
  let prompt = "";
  const result = await executeGitWorkflowCommand(":push", {
    ...baseOptions,
    runner,
    confirm: async (value) => {
      prompt = value;
      return true;
    },
  });
  assert.equal(result.ok, true);
  assert.match(prompt, /origin/);
  assert.match(result.message, /pushed/i);
  assert.equal(calls.some((call) => call.includes("--force")), false);
});

test("PR creation requires gh auth, an upstream branch, and explicit confirmation", async () => {
  const { runner, calls } = runnerFor({
    "git symbolic-ref --quiet --short HEAD": { stdout: "feature/fix\n" },
    "git status --porcelain=v1 --untracked-files=all": { stdout: "" },
    "git rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/feature/fix\n" },
    "gh auth status --hostname github.com": { stdout: "Logged in\nToken: gho_secret\n" },
    "gh pr create --title Fix parser --body Created by dev-agent --head feature/fix --base main": {
      stdout: "https://github.com/example/project/pull/42\n",
    },
  });
  let prompt = "";
  const result = await executeGitWorkflowCommand(':pr --base main "Fix parser"', {
    ...baseOptions,
    runner,
    confirm: async (value) => {
      prompt = value;
      return true;
    },
  });
  assert.equal(result.ok, true);
  assert.match(prompt, /remote pull request/i);
  assert.equal(result.message, "Pull request created: https://github.com/example/project/pull/42");
  assert.equal(result.message.includes("gh_secret"), false);
  assert.equal(calls.some((call) => call.includes("--force")), false);
});
