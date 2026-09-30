import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  executeReviewCommand,
  formatReviewResult,
  type GitRunner,
  type ReviewResult,
} from "../dist/review-command.js";

function runnerFor(stdout: string, code = 0, stderr = ""): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = async (args) => {
    calls.push([...args]);
    return { code, stdout, stderr };
  };
  return { runner, calls };
}

const sampleDiff = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,3 @@",
  " const ready = true;",
  "+const answer = 42;",
  "-const oldAnswer = 41;",
  "diff --git a/README.md b/README.md",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/README.md",
  "@@ -0,0 +1,2 @@",
  "+# Project",
  "+",
  "",
].join("\n");

function assertStableMetadata(result: ReviewResult): void {
  assert.deepEqual(Object.keys(result), ["command", "mode", "status", "changedFiles", "summary", "warnings"]);
  assert.equal(result.command, "review");
  assert.doesNotMatch(JSON.stringify(result), /\/Users\/|\/private\/|secret|token|password/i);
}

test("review uses a read-only working-tree diff and returns file metadata", async () => {
  const { runner, calls } = runnerFor(sampleDiff);
  const result = await executeReviewCommand({ cwd: "/workspace/project", gitRunner: runner });

  assert.deepEqual(calls, [["diff", "--no-ext-diff", "--unified=3"]]);
  assert.equal(result.mode, "working-tree");
  assert.equal(result.status, "ok");
  assert.deepEqual(result.changedFiles, [
    { path: "src/app.ts", status: "modified", additions: 1, deletions: 1 },
    { path: "README.md", status: "added", additions: 2, deletions: 0 },
  ]);
  assert.deepEqual(result.summary, { changedFiles: 2, additions: 3, deletions: 1 });
  assert.deepEqual(result.warnings, []);
  assertStableMetadata(result);
  assert.doesNotMatch(JSON.stringify(result), /const answer|Project|diff --git/);
});

test("review passes explicit base and head refs as separate git argv values", async () => {
  const { runner, calls } = runnerFor(sampleDiff);
  const result = await executeReviewCommand({
    cwd: "/workspace/project",
    base: "origin/main",
    head: "feature/with spaces",
    gitRunner: runner,
  });

  assert.equal(result.mode, "base-head");
  assert.deepEqual(calls, [["diff", "--no-ext-diff", "--unified=3", "origin/main", "feature/with spaces"]]);
});

test("review rejects option-like refs before invoking git", async () => {
  let called = false;
  const result = await executeReviewCommand({
    cwd: "/workspace/project",
    base: "--output=/tmp/should-not-be-created",
    head: "HEAD",
    gitRunner: async () => {
      called = true;
      return { code: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "error");
  assert.deepEqual(result.warnings, ["invalid_git_ref"]);
  assert.doesNotMatch(JSON.stringify(result), /should-not-be-created/);
});

test("review rejects an incomplete base/head range without running git", async () => {
  let called = false;
  const result = await executeReviewCommand({
    cwd: "/workspace/project",
    base: "origin/main",
    gitRunner: async () => {
      called = true;
      return { code: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "error");
  assert.deepEqual(result.changedFiles, []);
  assert.deepEqual(result.summary, { changedFiles: 0, additions: 0, deletions: 0, reason: "base_head_required" });
  assert.deepEqual(result.warnings, ["base_head_required"]);
});

test("review marks non-git directories as skipped without exposing git output", async () => {
  const { runner } = runnerFor("", 128, "fatal: not a git repository: /Users/secret/project");
  const result = await executeReviewCommand({ cwd: "/Users/secret/project", gitRunner: runner });

  assert.equal(result.status, "skipped");
  assert.equal(result.mode, "working-tree");
  assert.deepEqual(result.changedFiles, []);
  assert.deepEqual(result.summary, { changedFiles: 0, additions: 0, deletions: 0, reason: "not_git_repository" });
  assert.deepEqual(result.warnings, ["not_git_repository"]);
  assert.doesNotMatch(JSON.stringify(result), /not a git repository|\/Users\/secret/);
});

test("review returns structured failure metadata for git errors", async () => {
  const { runner } = runnerFor("", 2, "fatal: ambiguous argument 'secret-token'");
  const result = await executeReviewCommand({ cwd: "/workspace/project", gitRunner: runner });

  assert.equal(result.status, "error");
  assert.deepEqual(result.summary, { changedFiles: 0, additions: 0, deletions: 0, reason: "git_failed" });
  assert.deepEqual(result.warnings, ["git_failed"]);
  assert.doesNotMatch(JSON.stringify(result), /secret-token|fatal|ambiguous/);
});

test("review does not write the workspace or initialize external services", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-agent-review-readonly-"));
  const marker = join(cwd, "marker.txt");
  try {
    await writeFile(marker, "keep me", "utf8");
    const { runner } = runnerFor(sampleDiff);
    const result = await executeReviewCommand({ cwd, gitRunner: runner });

    assert.equal(result.status, "ok");
    assert.equal(await readFile(marker, "utf8"), "keep me");
    await assert.rejects(() => readFile(join(cwd, ".dev-agent")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("review reports byte and file limits without returning diff text", async () => {
  const bytes = await executeReviewCommand({
    cwd: "/workspace/project",
    gitRunner: runnerFor(sampleDiff).runner,
    limits: { maxBytes: 10, maxLines: 10_000, maxFiles: 500 },
  });
  assert.equal(bytes.status, "limited");
  assert.deepEqual(bytes.summary, { changedFiles: 0, additions: 0, deletions: 0, reason: "diff_bytes_exceeded" });

  const files = await executeReviewCommand({
    cwd: "/workspace/project",
    gitRunner: runnerFor(sampleDiff).runner,
    limits: { maxBytes: 10_000, maxLines: 10_000, maxFiles: 1 },
  });
  assert.equal(files.status, "limited");
  assert.equal(files.summary.reason, "diff_files_exceeded");
  assert.equal(files.changedFiles.length, 1);
  assert.doesNotMatch(JSON.stringify(files), /const answer|Project/);
});

test("review enforces diff byte, line, and file limits with a structured reason", async () => {
  const { runner } = runnerFor(sampleDiff);
  const result = await executeReviewCommand({
    cwd: "/workspace/project",
    gitRunner: runner,
    limits: { maxBytes: 10_000, maxLines: 3, maxFiles: 1 },
  });

  assert.equal(result.status, "limited");
  assert.equal(result.summary.reason, "diff_lines_exceeded");
  assert.deepEqual(result.warnings, ["diff_lines_exceeded"]);
  assert.ok(result.changedFiles.length <= 1);
});

test("review formats a stable JSON metadata result", async () => {
  const { runner } = runnerFor("");
  const result = await executeReviewCommand({ cwd: "/workspace/project", gitRunner: runner });

  assert.equal(
    formatReviewResult(result),
    '{"command":"review","mode":"working-tree","status":"ok","changedFiles":[],"summary":{"changedFiles":0,"additions":0,"deletions":0},"warnings":[]}',
  );
});

test("review never returns unsafe absolute paths from diff headers", async () => {
  const { runner } = runnerFor([
    "diff --git a//Users/Admin/private.txt b//Users/Admin/private.txt",
    "--- a//Users/Admin/private.txt",
    "+++ b//Users/Admin/private.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n"));
  const result = await executeReviewCommand({ cwd: "/workspace/project", gitRunner: runner });

  assert.equal(result.changedFiles[0]?.path, "[redacted-path]");
  assert.doesNotMatch(JSON.stringify(result), /\/Users\/Admin/);
});
