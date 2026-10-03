import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createDesktopServer } from "../dist/server.js";
const reviewModulePath = "../dist/github-pr-review.js";
const reviewModulePromise = import(reviewModulePath) as Promise<any>;

function start(server: ReturnType<typeof createDesktopServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server: ReturnType<typeof createDesktopServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const rawSnapshot = {
  state: "ready",
  readOnly: false,
  target: {
    url: "https://github.com/acme/demo/pull/42",
    owner: "acme",
    repo: "demo",
    number: 42,
  },
  pr: {
    number: 42,
    title: "Improve parser",
    body: "Please review this change.",
    author: { login: "alice" },
    state: "OPEN",
    isDraft: false,
    merged: false,
    baseRefName: "main",
    headRefName: "feature/parser",
    additions: 12,
    deletions: 4,
    changedFiles: 2,
    url: "https://github.com/acme/demo/pull/42",
    updatedAt: "2026-09-25T10:00:00Z",
  },
  files: [
    { path: "src/parser.ts", status: "modified", additions: 10, deletions: 3 },
    { path: "tests/parser.test.ts", status: "added", additions: 2, deletions: 1 },
  ],
  diff: "diff --git a/src/parser.ts b/src/parser.ts\n@@ -1 +1 @@\n-old\n+new\n",
  reviews: [{ author: "bob", state: "APPROVED", body: "Looks good", submittedAt: "2026-09-25T11:00:00Z" }],
  comments: [{ author: "carol", body: "Please add a regression test.", path: "src/parser.ts", line: 9, createdAt: "2026-09-25T12:00:00Z", url: "https://github.com/acme/demo/pull/42#issuecomment-1" }],
  truncated: false,
  limits: { maxFiles: 100, maxDiffBytes: 512 * 1024, maxComments: 64 },
};

test("normalizes GitHub pull request URLs and owner/repo/number inputs", async () => {
  const { normalizeGitHubPrTarget } = await reviewModulePromise;
  assert.deepEqual(normalizeGitHubPrTarget("https://github.com/acme/demo/pull/42"), {
    owner: "acme",
    repo: "demo",
    number: 42,
    url: "https://github.com/acme/demo/pull/42",
  });
  assert.deepEqual(normalizeGitHubPrTarget({ owner: "acme", repo: "demo", number: "42" }), {
    owner: "acme",
    repo: "demo",
    number: 42,
    url: "https://github.com/acme/demo/pull/42",
  });
  assert.deepEqual(normalizeGitHubPrTarget("acme/demo#42"), {
    owner: "acme",
    repo: "demo",
    number: 42,
    url: "https://github.com/acme/demo/pull/42",
  });
  assert.equal(normalizeGitHubPrTarget("https://evil.example/acme/demo/pull/42"), undefined);
  assert.equal(normalizeGitHubPrTarget("acme/demo/0"), undefined);
  assert.equal(normalizeGitHubPrTarget("acme/demo/999999999999999999999"), undefined);
});

test("normalizes PR projection, keeps review data bounded, and forces read-only state", async () => {
  const { normalizeGitHubPrReviewSnapshot } = await reviewModulePromise;
  const normalized = normalizeGitHubPrReviewSnapshot({
    ...rawSnapshot,
    readOnly: true,
    pr: { ...rawSnapshot.pr, title: "x".repeat(10_000), body: "secret=not-a-secret" },
    files: [...rawSnapshot.files, { path: "\u0000bad", status: "?", additions: 999999, deletions: -2 }],
    reviews: [{ author: "a".repeat(500), state: "UNKNOWN", body: "b".repeat(20_000) }],
  });
  assert.equal(normalized.state, "ready");
  assert.equal(normalized.readOnly, true);
  assert.equal(normalized.pr.title.length, 256);
  assert.equal(normalized.pr.body, "secret=not-a-secret");
  assert.equal(normalized.files.length, 2);
  assert.equal(normalized.reviews[0]?.author.length, 96);
  assert.equal(normalized.reviews[0]?.body.length, 4096);
  assert.equal(normalized.limits.maxFiles, 100);
  assert.doesNotMatch(JSON.stringify(normalized), /token|password|authorization/i);
});

test("malformed and oversized projections fail closed", async () => {
  const { normalizeGitHubPrReviewSnapshot } = await reviewModulePromise;
  assert.equal(normalizeGitHubPrReviewSnapshot({ state: "ready" }), undefined);
  assert.equal(normalizeGitHubPrReviewSnapshot({ ...rawSnapshot, diff: "x".repeat(900_000) }), undefined);
  assert.equal(normalizeGitHubPrReviewSnapshot({ ...rawSnapshot, target: { ...rawSnapshot.target, url: "javascript:alert(1)" } }), undefined);
});

test("GitHub PR loader is opt-in and never executes gh while disabled", async () => {
  const { loadGitHubPrReview } = await reviewModulePromise;
  let calls = 0;
  const result = await loadGitHubPrReview("acme/demo/42", {
    enabled: false,
    runCommand: async () => {
      calls += 1;
      return { ok: true, stdout: "{}" };
    },
  });
  assert.deepEqual(result, { ok: false, state: "disabled", code: "opt-in-required" });
  assert.equal(calls, 0);
});

test("GitHub PR loader projects bounded metadata and diff from explicit read-only commands", async () => {
  const { loadGitHubPrReview } = await reviewModulePromise;
  const commands: string[][] = [];
  const result = await loadGitHubPrReview({ owner: "acme", repo: "demo", number: 42 }, {
    enabled: true,
    runCommand: async (_command, args) => {
      commands.push([...args]);
      if (args.includes("--patch")) return { ok: true, stdout: rawSnapshot.diff };
      return { ok: true, stdout: JSON.stringify({
        ...rawSnapshot.pr,
        author: { login: rawSnapshot.pr.author.login },
        files: rawSnapshot.files,
        reviews: rawSnapshot.reviews,
        comments: rawSnapshot.comments,
        url: rawSnapshot.pr.url,
      }) };
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.readOnly, true);
    assert.equal(result.snapshot.diff, rawSnapshot.diff);
    assert.equal(result.snapshot.pr.title, rawSnapshot.pr.title);
  }
  assert.equal(commands.length, 2);
  assert.ok(commands[0]?.includes("pr"));
  assert.ok(commands[0]?.includes("view"));
  assert.ok(commands[0]?.includes("--json"));
  assert.ok(commands[1]?.includes("diff"));
  assert.ok(commands[1]?.includes("--patch"));
  assert.ok(commands[1]?.includes("--color"));
  assert.ok(commands[1]?.includes("never"));
  const requestedFields = commands[0]![commands[0]!.indexOf("--json") + 1]!.split(",");
  assert.ok(requestedFields.includes("mergedAt"));
  assert.ok(!requestedFields.includes("merged"));
  assert.ok(commands.every((args) => args.includes("acme/demo")));
  assert.ok(commands.every((args) => !args.includes("review") && !args.includes("comment")));
});

test("PR review endpoint is loopback-only, bounded, and does not expose mutation routes", async () => {
  let received: unknown;
  const server = createDesktopServer({
    session: { id: "pr-session", run: async () => undefined },
    githubPrReview: async (input) => {
      received = input;
      return { ok: true, snapshot: rawSnapshot };
    },
  } as any);
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/github/pr-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "pr-session", url: "https://github.com/acme/demo/pull/42" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.snapshot.readOnly, true);
    assert.equal((received as any)?.url, "https://github.com/acme/demo/pull/42");

    const extra = await fetch(`${base}/api/github/pr-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "acme/demo/42", command: "gh pr comment" }),
    });
    assert.equal(extra.status, 400);

    const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /gh pr (comment|review)/);
  } finally {
    await close(server);
  }
});

test("PR review endpoint returns stable sanitized errors", async () => {
  const server = createDesktopServer({
    session: { id: "pr-session", run: async () => undefined },
    githubPrReview: async () => ({ ok: false, state: "unauthenticated", code: "not-authenticated" }),
  } as any);
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/github/pr-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "acme/demo/42" }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "GitHub authentication is required.", code: "not-authenticated" });
  } finally {
    await close(server);
  }
});

test("PR review endpoint fails closed when a custom loader returns malformed data", async () => {
  const server = createDesktopServer({
    session: { id: "pr-session", run: async () => undefined },
    githubPrReview: async () => undefined as any,
  } as any);
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/github/pr-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "acme/demo/42" }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "GitHub returned an invalid pull request response.", code: "malformed-response" });
  } finally {
    await close(server);
  }
});

test("Desktop serves the PR review panel and its safe client module", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="github-pr-review-panel"/);
  assert.match(html, /id="github-pr-review-url"/);
  assert.match(html, /createGitHubPrReviewUI.*github-pr-review-ui\.js/);
  assert.match(html, /githubPrReview/);
});

test("PR review prompt formatter keeps remote content bounded and distinguishes local notes", async () => {
  const module = await import("../public/github-pr-review-ui.js");
  const prompt = module.formatGitHubPrReviewPrompt(rawSnapshot, "Prioritize parser regressions.");
  assert.match(prompt, /Improve parser/);
  assert.match(prompt, /Prioritize parser regressions\./);
  assert.match(prompt, /src\/parser\.ts/);
  assert.match(prompt, /```diff/);
  assert.ok(prompt.length <= 48 * 1024);
});

test("PR review draft storage fails closed on malformed and oversized local data", async () => {
  const module = await import("../public/github-pr-review-ui.js");
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  };
  assert.deepEqual(module.readGitHubPrReviewDraft(adapter as any, "https://github.com/acme/demo/pull/42"), "");
  assert.equal(module.writeGitHubPrReviewDraft(adapter as any, "https://github.com/acme/demo/pull/42", "notes"), true);
  assert.equal(module.readGitHubPrReviewDraft(adapter as any, "https://github.com/acme/demo/pull/42"), "notes");
  storage.set(module.GITHUB_PR_REVIEW_STORAGE_KEY, "not-json");
  assert.equal(module.readGitHubPrReviewDraft(adapter as any, "https://github.com/acme/demo/pull/42"), "");
});

class FakeElement {
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  private readonly listeners = new Map<string, (event: any) => void>();

  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.set(type, listener);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children = nodes;
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  appendChild(node: FakeElement): FakeElement {
    this.children.push(node);
    return node;
  }

  trigger(type: string): void { this.listeners.get(type)?.({ preventDefault() {} }); }

  focus(): void {}

  setSelectionRange(): void {}
}

class FakeDocument {
  private readonly nodes = new Map<string, FakeElement>();

  constructor() {
    for (const id of [
      "github-pr-review-panel",
      "github-pr-review-form",
      "github-pr-review-url",
      "github-pr-review-load",
      "github-pr-review-status",
      "github-pr-review-summary",
      "github-pr-review-files",
      "github-pr-review-diff",
      "github-pr-review-reviews",
      "github-pr-review-comments",
      "github-pr-review-notes",
      "github-pr-review-insert",
      "github-pr-review-start",
      "github-pr-review-clear",
    ]) {
      this.nodes.set(id, new FakeElement());
    }
  }

  getElementById(id: string): FakeElement | undefined {
    return this.nodes.get(id);
  }

  createElement(): FakeElement {
    return new FakeElement();
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

test("PR review invalidates late responses when cleared or switched to another session", async () => {
  const module = await import("../public/github-pr-review-ui.js");
  const documentRef = new FakeDocument();
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  };
  let sessionId = "session-a";
  const first = deferred<any>();
  const second = deferred<any>();
  let requestCount = 0;
  const ui = module.createGitHubPrReviewUI({
    documentRef,
    storage: adapter,
    getSessionId: () => sessionId,
    translate: (key: string) => key,
    fetcher: () => {
      requestCount += 1;
      return requestCount === 1 ? first.promise : second.promise;
    },
  });
  const targetInput = documentRef.getElementById("github-pr-review-url")!;
  targetInput.value = rawSnapshot.target.url;

  const clearedRequest = ui.load();
  ui.clear();
  assert.equal(documentRef.getElementById("github-pr-review-load")!.disabled, false);
  first.resolve({ ok: true, json: async () => ({ snapshot: rawSnapshot }) });
  assert.equal(await clearedRequest, false);
  assert.equal(ui.getSnapshot(), undefined);

  targetInput.value = rawSnapshot.target.url;
  const switchedRequest = ui.load();
  sessionId = "session-b";
  ui.sessionChanged();
  second.resolve({ ok: true, json: async () => ({ snapshot: rawSnapshot }) });
  assert.equal(await switchedRequest, false);
  assert.equal(ui.getSnapshot(), undefined);
  assert.equal(targetInput.value, "");
});


test("PR identity is consistent and target URLs reject credentials or nonstandard ports", async () => {
  const { normalizeGitHubPrTarget, normalizeGitHubPrReviewSnapshot } = await reviewModulePromise;
  assert.equal(normalizeGitHubPrTarget("https://user:password@github.com/acme/demo/pull/42"), undefined);
  assert.equal(normalizeGitHubPrTarget("https://github.com:444/acme/demo/pull/42"), undefined);
  assert.equal(normalizeGitHubPrTarget({ ...rawSnapshot.target, number: 43 }), undefined);
  assert.equal(normalizeGitHubPrReviewSnapshot({ ...rawSnapshot, pr: { ...rawSnapshot.pr, number: 43 } }), undefined);
  assert.equal(normalizeGitHubPrReviewSnapshot({ ...rawSnapshot, pr: { ...rawSnapshot.pr, url: "https://github.com/other/repo/pull/42" } }), undefined);
  const merged = normalizeGitHubPrReviewSnapshot({ ...rawSnapshot, pr: { ...rawSnapshot.pr, state: "MERGED", merged: undefined, mergedAt: "2026-09-25T10:00:00Z" } });
  assert.equal(merged.pr.state, "merged");
  assert.equal(merged.pr.merged, true);
});

test("metadata truncation is explicit and CLI buffer failures have a stable oversized code", async () => {
  const { normalizeGitHubPrReviewSnapshot, loadGitHubPrReview } = await reviewModulePromise;
  const files = Array.from({ length: 101 }, (_, i) => ({ path: `src/${i}.ts`, additions: 1, deletions: 0 }));
  const bounded = normalizeGitHubPrReviewSnapshot({ ...rawSnapshot, files, pr: { ...rawSnapshot.pr, changedFiles: 101 } });
  assert.equal(bounded.files.length, 100);
  assert.equal(bounded.truncated, true);
  const result = await loadGitHubPrReview("acme/demo/42", { enabled: true, runCommand: async () => ({ ok: false, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stderr: "secret output" }) });
  assert.deepEqual(result, { ok: false, state: "oversized", code: "response-too-large" });
});

test("large review prompts retain local notes and close the bounded diff", async () => {
  const module = await import("../public/github-pr-review-ui.js");
  const prompt = module.formatGitHubPrReviewPrompt({
    ...rawSnapshot,
    files: Array.from({ length: 100 }, () => ({ path: "a".repeat(512) })),
    reviews: Array.from({ length: 16 }, () => ({ body: "b".repeat(4096) })),
    comments: Array.from({ length: 16 }, () => ({ body: "c".repeat(4096) })),
    diff: "+".repeat(500_000),
  }, "KEEP LOCAL NOTES");
  assert.ok(prompt.length <= 48 * 1024);
  assert.match(prompt, /KEEP LOCAL NOTES/);
  assert.match(prompt, /truncated/i);
  assert.match(prompt, /```$/);
});

test("inserting a PR stays bounded and keeps review context after a long composer draft", async () => {
  const module = await import("../public/github-pr-review-ui.js");
  const documentRef = new FakeDocument();
  const current = "Existing user request. ".repeat(3000);
  let inserted = "";
  const ui = module.createGitHubPrReviewUI({ documentRef, storage: null, getPrompt: () => current, setPrompt: (text: string) => { inserted = text; }, fetcher: async () => ({ ok: true, json: async () => ({ snapshot: rawSnapshot }) }) });
  documentRef.getElementById("github-pr-review-url")!.value = rawSnapshot.target.url;
  assert.equal(await ui.load(), true);
  documentRef.getElementById("github-pr-review-insert")!.trigger("click");
  assert.ok(inserted.length <= 48 * 1024);
  assert.ok(inserted.startsWith(current.slice(0, 1000)));
  assert.match(inserted, /Review this GitHub pull request/);
});

test("PR endpoint refuses non-loopback origins before loading remote data", async () => {
  let calls = 0;
  const server = createDesktopServer({ session: { id: "pr-session", run: async () => undefined }, githubPrReview: async () => { calls++; return { ok: true, snapshot: rawSnapshot } as any; } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/github/pr-review`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ url: rawSnapshot.target.url }) });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  } finally { await close(server); }
});
