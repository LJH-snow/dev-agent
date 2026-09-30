import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDesktopServer } from "../dist/server.js";

const compareModulePath = "../dist/github-repair-verify.js";
const url = "https://github.com/acme/demo/pull/42";
const newSha = "b".repeat(40);

function diagnosis(shaValue: string, checks: { name: string; state: string; workflow?: string }[], overrides: any = {}) {
  return { readOnly: true, target: { owner: "acme", repo: "demo", number: 42, url }, headSha: shaValue,
    stale: false, evidence: "checks-only", checks: checks.map((check) => ({ workflow: "CI", url: "", ...check })),
    runs: [], truncated: false, ...overrides };
}

test("repair verification compares check states and classifies the outcome", async () => {
  const { compareCiDiagnosis } = await import(compareModulePath);
  const sha = "a".repeat(40);
  const before = diagnosis(sha, [{ name: "build", state: "failed" }, { name: "lint", state: "passed" }]);
  const repaired = diagnosis(newSha, [{ name: "build", state: "passed" }, { name: "lint", state: "passed" }]);
  const result = compareCiDiagnosis(before as any, repaired as any);
  assert.equal(result.verdict, "repaired");
  assert.equal(result.stale, false);
  assert.deepEqual(result.before, { failed: 1, total: 2 });
  assert.deepEqual(result.after, { failed: 0, total: 2 });
  assert.equal(result.rows.find((row) => row.name === "build")?.after, "passed");

  const improved = diagnosis(newSha, [{ name: "build", state: "passed" }, { name: "lint", state: "passed" }, { name: "test", state: "failed" }]);
  assert.equal(compareCiDiagnosis(before as any, improved as any).verdict, "unresolved");

  const partlyFailing = diagnosis(sha, [{ name: "build", state: "failed" }, { name: "lint", state: "failed" }]);
  const oneFixed = diagnosis(newSha, [{ name: "build", state: "passed" }, { name: "lint", state: "failed" }]);
  assert.equal(compareCiDiagnosis(partlyFailing as any, oneFixed as any).verdict, "improved");

  const stillFailing = diagnosis(newSha, [{ name: "build", state: "failed" }, { name: "lint", state: "passed" }]);
  assert.equal(compareCiDiagnosis(before as any, stillFailing as any).verdict, "unresolved");

  const staleAfter = diagnosis(newSha, [{ name: "build", state: "passed" }], { stale: true, evidence: "stale", checks: [] });
  assert.equal(compareCiDiagnosis(before as any, staleAfter as any).verdict, "inconclusive");

  const noFailures = diagnosis(sha, [{ name: "build", state: "passed" }]);
  assert.equal(compareCiDiagnosis(noFailures as any, repaired as any).verdict, "inconclusive");

  const vanished = diagnosis(newSha, []);
  const vanishedResult = compareCiDiagnosis(before as any, vanished as any);
  assert.equal(vanishedResult.verdict, "inconclusive");
  assert.equal(vanishedResult.rows.find((row) => row.name === "build")?.after, "unknown");
});

test("repair lineage is captured on repair creation and verification closes the loop", async () => {
  const { root, container, sha } = await repo();
  let mode: "failing" | "repaired" | "disabled" = "failing";
  const server = createDesktopServer({
    session: { id: "desktop-default", async run() {} }, workspaceRoot: root,
    worktreeDirectory: join(container, "worktrees"), workspaceStateFile: join(container, "state.json"),
    createSession: (sessionId: string, workingDirectory?: string) => ({ id: sessionId, workingDirectory, async run() {} }),
    capabilityToken: "verify-test-token",
    githubCiDiagnosis: async () => {
      if (mode === "disabled") return { ok: false, code: "opt-in-required" };
      if (mode === "repaired") return { ok: true, snapshot: diagnosis(newSha, [{ name: "build", state: "passed" }]) };
      return { ok: true, snapshot: diagnosis(sha, [{ name: "build", state: "failed" }]) };
    },
  } as any);
  const base = await start(server);
  try {
    const noLineage = await fetch(`${base}/api/github/repair-lineage?sessionId=task-none-1`);
    assert.equal(noLineage.status, 404);
    const verifyNothing = await post(base, "/api/github/repair-verify", { sessionId: "task-none-1" });
    assert.equal(verifyNothing.status, 404);

    const repair = await post(base, "/api/github/ci-repair", { url, expectedSha: sha, confirm: true });
    assert.equal(repair.status, 201);
    const task = await repair.json() as any;

    const beforeReport = await (await fetch(`${base}/api/sessions/${task.sessionId}/delivery-report`)).text();
    assert.doesNotMatch(beforeReport, /Remote CI verification/);

    const lineage = await (await fetch(`${base}/api/github/repair-lineage?sessionId=${task.sessionId}`)).json() as any;
    assert.equal(lineage.prUrl, url);
    assert.equal(lineage.failedSha, sha);
    assert.equal(lineage.branch, task.branch);
    assert.equal(lineage.lastVerification, undefined);

    mode = "repaired";
    const verified = await post(base, "/api/github/repair-verify", { sessionId: task.sessionId });
    assert.equal(verified.status, 200);
    const payload = await verified.json() as any;
    assert.equal(payload.prUrl, url);
    assert.equal(payload.failedSha, sha);
    assert.equal(payload.verification.verdict, "repaired");
    assert.equal(payload.verification.afterHeadSha, newSha);
    assert.match(payload.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);

    const lineageAfter = await (await fetch(`${base}/api/github/repair-lineage?sessionId=${task.sessionId}`)).json() as any;
    assert.equal(lineageAfter.lastVerification.verdict, "repaired");

    const afterReport = await (await fetch(`${base}/api/sessions/${task.sessionId}/delivery-report`)).text();
    assert.match(afterReport, /Remote CI verification/);
    assert.match(afterReport, /Verdict: repaired/);
    assert.match(afterReport, /snapshot from its recorded time/);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(container, { recursive: true, force: true }); }
});

test("repair verification refuses unknown sessions, disabled integration, and untrusted origins", async () => {
  const { root, container, sha } = await repo();
  let mode: "failing" | "disabled" = "failing";
  const server = createDesktopServer({
    session: { id: "desktop-default", async run() {} }, workspaceRoot: root,
    worktreeDirectory: join(container, "worktrees"), workspaceStateFile: join(container, "state.json"),
    createSession: (sessionId: string, workingDirectory?: string) => ({ id: sessionId, workingDirectory, async run() {} }),
    capabilityToken: "verify-test-token",
    githubCiDiagnosis: async () => mode === "disabled" ? { ok: false, code: "opt-in-required" }
      : { ok: true, snapshot: diagnosis(sha, [{ name: "build", state: "failed" }]) },
  } as any);
  const base = await start(server);
  try {
    const repair = await post(base, "/api/github/ci-repair", { url, expectedSha: sha, confirm: true });
    assert.equal(repair.status, 201);
    const task = await repair.json() as any;

    const origin = await fetch(`${base}/api/github/repair-lineage?sessionId=${task.sessionId}`, {
      headers: { origin: "https://evil.example" },
    });
    assert.equal(origin.status, 403);

    mode = "disabled";
    const verifyDisabled = await post(base, "/api/github/repair-verify", { sessionId: task.sessionId });
    assert.equal(verifyDisabled.status, 403);
    assert.equal((await verifyDisabled.json() as any).code, "opt-in-required");

    const badBody = await post(base, "/api/github/repair-verify", { sessionId: task.sessionId, force: true });
    assert.equal(badBody.status, 400);

    const wrongToken = await fetch(base + "/api/github/repair-verify", {
      method: "POST", headers: { "content-type": "application/json", "x-dev-agent-capability": "wrong" }, body: JSON.stringify({ sessionId: task.sessionId }),
    });
    assert.equal(wrongToken.status, 403);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(container, { recursive: true, force: true }); }
});

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env,
    GIT_AUTHOR_NAME: "Repair verify tests", GIT_AUTHOR_EMAIL: "verify@example.invalid",
    GIT_COMMITTER_NAME: "Repair verify tests", GIT_COMMITTER_EMAIL: "verify@example.invalid" } }).trim();
}
async function repo() {
  const container = await mkdtemp(join(tmpdir(), "desktop-repair-verify-")); const root = join(container, "repo"); await mkdir(root);
  git(root, "init", "-q"); git(root, "config", "user.name", "Repair verify tests"); git(root, "config", "user.email", "verify@example.invalid");
  await writeFile(join(root, "README.md"), "base\n"); git(root, "add", "."); git(root, "commit", "-qm", "base");
  return { container, root, sha: git(root, "rev-parse", "HEAD") };
}
async function start(server: any): Promise<string> {
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => {
    const addr = server.address(); assert.ok(addr && typeof addr !== "string"); resolve(`http://127.0.0.1:${addr.port}`);
  }); });
}
function post(base: string, path: string, body: any, token = "verify-test-token") {
  return fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-dev-agent-capability": token }, body: JSON.stringify(body) });
}
