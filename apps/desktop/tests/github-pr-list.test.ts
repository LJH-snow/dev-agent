import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopServer } from "../dist/server.js";
const modulePath = "../dist/github-pr-list.js";
const repoUrl = "https://github.com/acme/demo";
const prUrl = (n: number) => `${repoUrl}/pull/${n}`;
const sha = "a".repeat(40);

function prFixture(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `Fix parser #${number}`,
    isDraft: false,
    state: "open",
    author: { login: "octocat" },
    headRefName: `feature/${number}`,
    headRefOid: sha,
    updatedAt: "2026-09-27T10:00:00Z",
    url: prUrl(number),
    statusCheckRollup: [
      { __typename: "CheckRun", name: "build", conclusion: "SUCCESS", status: "COMPLETED" },
      { __typename: "CheckRun", name: "test", conclusion: "FAILURE", status: "COMPLETED" },
      { __typename: "CheckRun", name: "lint", conclusion: undefined, status: "IN_PROGRESS" },
    ],
    ...overrides,
  };
}

function fixture(options: { stdout?: string; ok?: boolean; code?: string | number } = {}) {
  const calls: string[][] = [];
  const runCommand = async (command: string, args: readonly string[]) => {
    assert.equal(command, "gh");
    calls.push([...args]);
    if (options.ok === false) return { ok: false, code: options.code };
    return { ok: true, stdout: options.stdout ?? JSON.stringify([prFixture(1), prFixture(2)]) };
  };
  return { calls, runCommand };
}

test("PR list is opt-in and does not call gh while disabled", async () => {
  const { loadGitHubPrList } = await import(modulePath);
  const { calls, runCommand } = fixture();
  const result = await loadGitHubPrList(repoUrl, { enabled: false, runCommand });
  assert.deepEqual(result, { ok: false, code: "opt-in-required" });
  assert.equal(calls.length, 0);
});

test("PR list loads bounded read-only rows with check rollups and no mutation flags", async () => {
  const { loadGitHubPrList } = await import(modulePath);
  const { calls, runCommand } = fixture();
  const result = await loadGitHubPrList("acme/demo", { enabled: true, runCommand });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.readOnly, true);
  assert.deepEqual(result.snapshot.repo, { owner: "acme", repo: "demo", url: repoUrl });
  assert.equal(result.snapshot.prs.length, 2);
  const first = result.snapshot.prs[0]!;
  assert.equal(first.number, 1);
  assert.equal(first.author, "octocat");
  assert.equal(first.headRefOid, sha);
  assert.equal(first.url, prUrl(1));
  assert.equal(first.updatedAt, "2026-09-27T10:00:00Z");
  assert.deepEqual(first.checks, { passed: 1, failed: 1, pending: 1, unknown: 0, total: 3, verdict: "failing" });
  assert.deepEqual(calls[0]!.slice(0, 4), ["pr", "list", "--repo", "acme/demo"]);
  assert.equal(calls[0]!.includes("--state"), true);
  const joined = calls[0]!.join(" ");
  for (const mutation of ["edit", "close", "merge", "ready", "comment", "checkout"]) {
    assert.equal(joined.includes(mutation), false, `unexpected gh flag: ${mutation}`);
  }
});

test("check classification covers bucket, CheckRun, and StatusContext shapes", async () => {
  const { classifyCheckItem, summarizeCheckRollup } = await import(modulePath);
  assert.equal(classifyCheckItem({ bucket: "pass" }), "passed");
  assert.equal(classifyCheckItem({ bucket: "skipping" }), "passed");
  assert.equal(classifyCheckItem({ bucket: "fail" }), "failed");
  assert.equal(classifyCheckItem({ bucket: "pending" }), "pending");
  assert.equal(classifyCheckItem({ conclusion: "SUCCESS", status: "COMPLETED" }), "passed");
  assert.equal(classifyCheckItem({ conclusion: "neutral" }), "passed");
  assert.equal(classifyCheckItem({ conclusion: "TIMED_OUT" }), "failed");
  assert.equal(classifyCheckItem({ conclusion: "CANCELLED" }), "failed");
  assert.equal(classifyCheckItem({ conclusion: undefined, status: "QUEUED" }), "pending");
  assert.equal(classifyCheckItem({ state: "SUCCESS" }), "passed");
  assert.equal(classifyCheckItem({ state: "ERROR" }), "failed");
  assert.equal(classifyCheckItem({ state: "EXPECTED" }), "pending");
  assert.equal(classifyCheckItem({ context: "ci" }), "unknown");
  assert.equal(classifyCheckItem("SUCCESS"), "unknown");
  assert.deepEqual(summarizeCheckRollup([]), { passed: 0, failed: 0, pending: 0, unknown: 0, total: 0, verdict: "none" });
  assert.equal(summarizeCheckRollup([{ conclusion: "SUCCESS" }, { state: "PENDING" }]).verdict, "pending");
  assert.equal(summarizeCheckRollup([{ state: "PENDING" }, { conclusion: "SUCCESS" }, { bucket: "pass" }]).verdict, "pending");
  assert.equal(summarizeCheckRollup([{ conclusion: "SUCCESS" }, { context: "ci" }]).verdict, "unknown");
  assert.equal(summarizeCheckRollup([{ conclusion: "SUCCESS" }, { conclusion: "SUCCESS" }]).verdict, "passing");
});

test("PR list rows are capped at 25 and check counts at 64", async () => {
  const { loadGitHubPrList } = await import(modulePath);
  const many = Array.from({ length: 30 }, (_, i) => prFixture(i + 1, {
    statusCheckRollup: Array.from({ length: 70 }, () => ({ conclusion: "SUCCESS" })),
  }));
  const { runCommand } = fixture({ stdout: JSON.stringify(many) });
  const result = await loadGitHubPrList(repoUrl, { enabled: true, runCommand });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.prs.length, 25);
  assert.equal(result.snapshot.truncated, true);
  assert.equal(result.snapshot.prs[0]!.checks.total, 64);
  assert.equal(result.snapshot.prs[0]!.checks.verdict, "passing");
});

test("PR list rejects foreign hosts, malformed payloads, and oversized responses", async () => {
  const { loadGitHubPrList } = await import(modulePath);
  assert.equal((await loadGitHubPrList("https://gitlab.com/acme/demo", { enabled: true, runCommand: fixture().runCommand })).ok, false);
  const malformed = fixture({ stdout: JSON.stringify({ prs: [] }) });
  assert.equal((await loadGitHubPrList(repoUrl, { enabled: true, runCommand: malformed.runCommand })).code, "malformed-response");
  const invalidJson = fixture({ stdout: "not-json" });
  assert.equal((await loadGitHubPrList(repoUrl, { enabled: true, runCommand: invalidJson.runCommand })).code, "malformed-response");
  const oversized = fixture({ stdout: "x".repeat(256 * 1024 + 1) });
  assert.equal((await loadGitHubPrList(repoUrl, { enabled: true, runCommand: oversized.runCommand })).code, "response-too-large");
  const failed = fixture({ ok: false, code: 1 });
  assert.equal((await loadGitHubPrList(repoUrl, { enabled: true, runCommand: failed.runCommand })).code, "request-failed");
  const missingCli = fixture({ ok: false, code: "ENOENT" });
  assert.equal((await loadGitHubPrList(repoUrl, { enabled: true, runCommand: missingCli.runCommand })).code, "cli-unavailable");
});

test("PR list entries without a verifiable PR URL are dropped", async () => {
  const { loadGitHubPrList } = await import(modulePath);
  const { runCommand } = fixture({ stdout: JSON.stringify([prFixture(1, { url: "https://evil.example/pull/1" }), prFixture(2)]) });
  const result = await loadGitHubPrList(repoUrl, { enabled: true, runCommand });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.snapshot.prs.map((entry) => entry.number), [2]);
});

test("PR list route is loopback-only, validates the target, and maps loader failures", async () => {
  const server = createDesktopServer({
    session: { id: "desktop-default", run: async () => undefined },
    githubPrList: async () => ({
      ok: true,
      snapshot: {
        readOnly: true,
        repo: { owner: "acme", repo: "demo", url: repoUrl },
        prs: [prFixture(7) as any],
        truncated: false,
      },
    }),
  } as any);
  const base: string = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address(); assert.ok(address && typeof address !== "string");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  try {
    const accepted = await post("/api/github/pr-list", { owner: "acme", repo: "demo" });
    assert.equal(accepted.status, 200);
    const payload = await accepted.json() as any;
    assert.equal(payload.snapshot.repo.owner, "acme");
    assert.equal(payload.snapshot.prs[0].number, 7);
    assert.equal((await post("/api/github/pr-list", { owner: "acme", repo: "demo", limit: 99 })).status, 400);
    assert.equal((await post("/api/github/pr-list", { owner: "../etc" })).status, 400);
    assert.equal((await post("/api/github/pr-list", { url: repoUrl }, { origin: "https://evil.example" })).status, 403);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("PR list route maps opt-in, oversized, and loader failures to bounded status codes", async () => {
  const loader = (code: string) => async () => code === "ok" ? { ok: true, snapshot: { readOnly: true, repo: { owner: "acme", repo: "demo", url: repoUrl }, prs: [], truncated: false } } : { ok: false, code };
  for (const [code, status] of [["opt-in-required", 403], ["response-too-large", 413], ["request-failed", 502], ["malformed-response", 502]] as const) {
    const server = createDesktopServer({ session: { id: "s", run: async () => undefined }, githubPrList: loader(code) } as any);
    const base: string = await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address(); assert.ok(address && typeof address !== "string");
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    try {
      const response = await fetch(base + "/api/github/pr-list", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: "acme", repo: "demo" }),
      });
      assert.equal(response.status, status);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }
  const mismatched = createDesktopServer({
    session: { id: "s", run: async () => undefined },
    githubPrList: async () => ({ ok: true, snapshot: { readOnly: true, repo: { owner: "other", repo: "repo", url: "https://github.com/other/repo" }, prs: [], truncated: false } }),
  } as any);
  const base: string = await new Promise((resolve, reject) => {
    mismatched.once("error", reject);
    mismatched.listen(0, "127.0.0.1", () => {
      const address = mismatched.address(); assert.ok(address && typeof address !== "string");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  try {
    const response = await fetch(base + "/api/github/pr-list", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: "acme", repo: "demo" }),
    });
    assert.equal(response.status, 502);
  } finally { await new Promise<void>((resolve) => mismatched.close(() => resolve())); }
});
