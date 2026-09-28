import assert from "node:assert/strict";
import test from "node:test";

async function ui() { return import(new URL("../public/task-center.js", import.meta.url).href); }

test("task groups put archived pinned tasks only in archive and sort recent activity without mutating input", async () => {
  const { groupTasks } = await ui();
  const input = [
    { sessionId: "old", lastActiveAt: "2026-09-20T10:00:00Z" },
    { sessionId: "archived", presentation: { pinned: true, archived: true } },
    { sessionId: "pinned", presentation: { pinned: true } },
    { sessionId: "new", lastActiveAt: "2026-09-25T10:00:00Z" },
  ];
  const groups = groupTasks(input);
  assert.deepEqual(groups.pinned.map((s) => s.sessionId), ["pinned"]);
  assert.deepEqual(groups.recent.map((s) => s.sessionId), ["new", "old"]);
  assert.deepEqual(groups.archived.map((s) => s.sessionId), ["archived"]);
  assert.deepEqual(input.map((s) => s.sessionId), ["old", "archived", "pinned", "new"]);
});

test("display title falls back through custom title, first message and stable id", async () => {
  const { taskTitle } = await ui();
  assert.equal(taskTitle({ sessionId: "a", suggestedTitle: "Automatic", presentation: { title: "Custom" } }), "Custom");
  assert.equal(taskTitle({ sessionId: "a", suggestedTitle: "Automatic", presentation: { title: null } }), "Automatic");
  assert.equal(taskTitle({ sessionId: "stable-id" }), "stable-id");
  assert.equal(taskTitle({ sessionId: "x", presentation: { title: "<img src=x onerror=alert(1)>" } }), "<img src=x onerror=alert(1)>");
});

test("search combines title, preview and stable id with truthful status filters including archived tasks", async () => {
  const { groupTasks } = await ui();
  const input = [
    { sessionId: "alpha", presentation: { title: "登录修复" }, preview: "Validation Passed", run: { status: "done" } },
    { sessionId: "beta", presentation: { title: "登录计划", archived: true }, run: { status: "waiting" } },
    { sessionId: "gamma", preview: "Validation Failed", run: { status: "failed" } },
  ];
  assert.deepEqual(groupTasks(input, { query: "登录", status: "waiting" }).archived.map((s) => s.sessionId), ["beta"]);
  assert.deepEqual(groupTasks(input, { query: "PASSED" }).recent.map((s) => s.sessionId), ["alpha"]);
  assert.deepEqual(groupTasks(input, { query: "GAMMA" }).recent.map((s) => s.sessionId), ["gamma"]);
  assert.deepEqual(groupTasks(input, { query: "none" }), { pinned: [], recent: [], archived: [] });
});

test("running tasks stay discoverable and valid timestamps win over malformed time values", async () => {
  const { groupTasks, taskStatus } = await ui();
  assert.equal(taskStatus({ run: { status: "running" } }), "running");
  assert.equal(taskStatus({ run: { status: "made-up" }, entryCount: 20 }), "idle");
  assert.equal(taskStatus({ entryCount: 20 }), "idle");
  assert.deepEqual(groupTasks([
    { sessionId: "z", lastActiveAt: "invalid" },
    { sessionId: "b", lastActiveAt: "2026-09-25T01:00:00Z" },
    { sessionId: "a", run: { status: "running", startedAt: "2026-09-25T02:00:00Z" } },
  ]).recent.map((s) => s.sessionId), ["a", "b", "z"]);
});
