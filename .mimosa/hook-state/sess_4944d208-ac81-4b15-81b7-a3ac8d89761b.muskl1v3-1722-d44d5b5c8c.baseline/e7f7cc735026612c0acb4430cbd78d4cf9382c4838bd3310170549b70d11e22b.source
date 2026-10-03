import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDesktopServer } from "../dist/server.js";

async function fixture(options: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "desktop-task-center-"));
  const previous = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = dir;
  const history = JSON.stringify({ version: 1, entries: [
    { id: "a", role: "user", content: "修复登录页面\n并补充测试", createdAt: "2026-09-24T08:00:00Z" },
    { id: "b", role: "assistant", content: "已修复表单验证", createdAt: "2026-09-24T08:01:00Z" },
  ] });
  await writeFile(join(dir, "alpha.json"), history);
  const servers = [];
  async function start(extra: Record<string, unknown> = {}) {
    const server = createDesktopServer({ session: { id: "default", async run() {} }, ...options, ...extra });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as any).port}`;
  }
  const base = await start();
  return { dir, history, base, start,
    async close() {
      await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
      if (previous === undefined) delete process.env.DEV_AGENT_SESSION_DIR;
      else process.env.DEV_AGENT_SESSION_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
function patch(base, id, value, headers = {}) {
  return fetch(`${base}/api/sessions/${encodeURIComponent(id)}/presentation`, {
    method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(value),
  });
}
async function sessions(base) {
  return ((await (await fetch(`${base}/api/sessions`)).json()) as any).sessions;
}

test("display titles and pin/archive survive restart without renaming or rewriting history", async () => {
  const f = await fixture();
  try {
    const res = await patch(f.base, "alpha", { title: "登录体验优化", pinned: true, archived: true });
    assert.equal(res.status, 200);
    let alpha = (await sessions(f.base)).find((s) => s.sessionId === "alpha");
    assert.equal(alpha.presentation.title, "登录体验优化");
    assert.equal(alpha.presentation.pinned, true);
    assert.equal(alpha.presentation.archived, true);
    assert.equal(alpha.suggestedTitle, "修复登录页面 并补充测试");
    assert.equal(alpha.preview, "已修复表单验证");
    assert.equal(await readFile(join(f.dir, "alpha.json"), "utf8"), f.history);
    assert.deepEqual((await readdir(f.dir)).filter((name) => name.endsWith(".json")), ["alpha.json"]);
    const restarted = await f.start();
    alpha = (await sessions(restarted)).find((s) => s.sessionId === "alpha");
    assert.equal(alpha.presentation.title, "登录体验优化");
    assert.equal(alpha.presentation.archived, true);
    assert.equal((await patch(restarted, "alpha", { archived: false })).status, 200);
    alpha = (await sessions(restarted)).find((s) => s.sessionId === "alpha");
    assert.equal(alpha.presentation.archived, false);
    assert.equal(alpha.presentation.pinned, true);
    const messages = await (await fetch(`${restarted}/api/sessions/alpha/messages`)).json() as any;
    assert.equal(messages.messages[0].content, "修复登录页面\n并补充测试");
  } finally { await f.close(); }
});

test("partial updates serialize without dropping other fields; titles may be shared and reset", async () => {
  const f = await fixture();
  try {
    const responses = await Promise.all([
      patch(f.base, "alpha", { title: "Review" }), patch(f.base, "alpha", { pinned: true }),
      patch(f.base, "alpha", { archived: true }),
    ]);
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 200]);
    const alpha = (await sessions(f.base)).find((s) => s.sessionId === "alpha");
    assert.deepEqual([alpha.presentation.title, alpha.presentation.pinned, alpha.presentation.archived], ["Review", true, true]);
    assert.equal((await patch(f.base, "draft-only", { title: "Review" })).status, 200);
    assert.ok((await sessions(f.base)).some((s) => s.sessionId === "draft-only" && s.presentation.title === "Review"));
    assert.equal((await patch(f.base, "alpha", { title: null })).status, 200);
    assert.equal((await sessions(f.base)).find((s) => s.sessionId === "alpha").presentation.title, null);
  } finally { await f.close(); }
});

test("invalid metadata and path aliases are rejected without changing existing presentation", async () => {
  const f = await fixture();
  try {
    assert.equal((await patch(f.base, "alpha", { title: "Keep" })).status, 200);
    for (const body of [{ title: "" }, { title: "a".repeat(121) }, { title: "x\ny" }, { title: 3 },
      { pinned: "yes" }, { archived: 1 }, { sessionId: "beta" }, {}, [], null]) {
      assert.equal((await patch(f.base, "alpha", body)).status, 400, JSON.stringify(body));
    }
    for (const id of ["../alpha", "Alpha", "a/b", "a".repeat(129)]) {
      assert.equal((await patch(f.base, id, { pinned: true })).status, 400, id);
    }
    const alpha = (await sessions(f.base)).find((s) => s.sessionId === "alpha");
    assert.equal(alpha.presentation.title, "Keep");
    assert.equal(alpha.presentation.pinned, false);
    const foreign = await patch(f.base, "alpha", { title: "No" }, { origin: "https://untrusted.example" });
    assert.equal(foreign.status, 403);
  } finally { await f.close(); }
});

test("delete removes presentation-only tasks and does not resurrect stored history tasks", async () => {
  const f = await fixture();
  try {
    await patch(f.base, "alpha", { archived: true });
    await patch(f.base, "draft-only", { title: "Unsent" });
    for (const id of ["alpha", "draft-only"]) {
      assert.equal((await fetch(`${f.base}/api/sessions/${id}`, { method: "DELETE" })).status, 200);
    }
    assert.ok(!(await sessions(f.base)).some((s) => ["alpha", "draft-only"].includes(s.sessionId)));
  } finally { await f.close(); }
});

test("legacy identity rename carries presentation without leaving a ghost task", async () => {
  const f = await fixture();
  try {
    await patch(f.base, "alpha", { title: "Keep title", pinned: true });
    const res = await fetch(`${f.base}/api/sessions/alpha/rename`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "renamed" }),
    });
    assert.equal(res.status, 200);
    const list = await sessions(f.base);
    assert.ok(!list.some((s) => s.sessionId === "alpha"));
    assert.equal(list.find((s) => s.sessionId === "renamed").presentation.title, "Keep title");
  } finally { await f.close(); }
});

test("metadata failure is reported, never acknowledged as saved", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, ".desktop-tasks"), "not a directory");
    assert.equal((await patch(f.base, "alpha", { pinned: true })).status, 500);
    assert.equal(await readFile(join(f.dir, "alpha.json"), "utf8"), f.history);
  } finally { await f.close(); }
});

test("archive and display rename do not cancel or rebind a running session", async () => {
  let finish;
  let started;
  const hasStarted = new Promise<void>((resolve) => { started = resolve; });
  const untilDone = new Promise<void>((resolve) => { finish = resolve; });
  let aborted = false;
  const f = await fixture({ session: { id: "alpha", async run(_message, emit, options) {
    options?.signal?.addEventListener("abort", () => { aborted = true; });
    started(); await untilDone;
    emit({ type: "token", data: { token: "Still running with the same identity" } });
    emit({ type: "done", data: { status: "done", turns: 1 } });
  } } });
  try {
    const stream = fetch(`${f.base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "alpha", message: "continue" }) }).then((r) => r.text());
    await hasStarted;
    assert.equal((await patch(f.base, "alpha", { title: "Running task", archived: true })).status, 200);
    const alpha = (await sessions(f.base)).find((s) => s.sessionId === "alpha");
    assert.equal(alpha.run.active, true);
    assert.equal(alpha.presentation.archived, true);
    finish();
    assert.match(await stream, /Still running with the same identity/);
    assert.equal(aborted, false);
    assert.equal((await sessions(f.base)).find((s) => s.sessionId === "alpha").run.status, "done");
  } finally { finish(); await f.close(); }
});
