import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const uiModulePath = "../public/scheduled-tasks-ui.js";
const schedule = {
  id: "sched-abc123-def456", title: "Morning watch", job: "ci-watch", repo: "acme/demo",
  kind: "interval", intervalMinutes: 60, enabled: true, createdAt: "2026-09-28T00:00:00.000Z",
  nextRunAt: "2026-09-28T03:00:00.000Z", lastRunAt: "2026-09-28T02:00:00.000Z", lastOk: undefined, running: false,
};
const schedulesResponse = (list) => ({ ok: true, json: async () => ({ now: "2026-09-28T02:00:00.000Z", schedules: list }) });

class Element {
  value = ""; textContent = ""; disabled = false; hidden = false; className = ""; type = "";
  children: Element[] = []; dataset: Record<string, string> = {};
  private listeners = new Map<string, (event: { preventDefault: () => void }) => void>();
  addEventListener(type: string, listener: (event: { preventDefault: () => void }) => void) { this.listeners.set(type, listener); }
  replaceChildren(...nodes: Element[]) { this.children = nodes; }
  append(...nodes: Element[]) { this.children.push(...nodes); }
  trigger(type: string) { this.listeners.get(type)?.({ preventDefault() {} }); }
}
class Document {
  nodes = new Map<string, Element>();
  constructor() { for (const id of ["scheduled-tasks-panel", "scheduled-tasks-status", "scheduled-tasks-refresh", "scheduled-tasks-definitions",
    "scheduled-tasks-form", "scheduled-tasks-title", "scheduled-tasks-repo", "scheduled-tasks-kind",
    "scheduled-tasks-interval", "scheduled-tasks-time", "scheduled-tasks-create", "scheduled-tasks-history"]) this.nodes.set(id, new Element()); }
  getElementById(id: string) { return this.nodes.get(id); }
  createElement() { return new Element(); }
}

test("scheduled tasks panel is wired into the workbench page", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="scheduled-tasks-panel"/);
  assert.match(html, /createScheduledTasksUI.*scheduled-tasks-ui\.js/s);
  assert.match(html, /id="scheduled-tasks-create"/);
});

test("refresh renders bounded rows with actions for each schedule", async () => {
  const documentRef = new Document();
  const ui = await import(uiModulePath);
  const created = ui.createScheduledTasksUI({
    documentRef, translate: (key: string) => key,
    fetcher: async () => schedulesResponse([schedule]),
  });
  assert.equal(await created.refresh(), true);
  const rows = documentRef.getElementById("scheduled-tasks-definitions")!.children;
  assert.equal(rows.length, 1);
  const label = rows[0]!.children[0]!.textContent;
  assert.match(label, /Morning watch/);
  assert.match(label, /acme\/demo/);
  assert.match(label, /next/);
  const buttons = rows[0]!.children.slice(1) as any[];
  assert.deepEqual(buttons.map((button) => button.textContent),
    ["scheduledTasks.runNow", "scheduledTasks.disable", "scheduledTasks.history", "scheduledTasks.delete"]);
  assert.equal(buttons[0].dataset.scheduleId, schedule.id);
  assert.equal(created.getSchedules().length, 1);
});

test("create posts a cadence payload and rejects input without title or repo", async () => {
  const documentRef = new Document();
  const requests: any[] = [];
  const ui = await import(uiModulePath);
  const created = ui.createScheduledTasksUI({
    documentRef, translate: (key: string) => key,
    fetcher: async (path: string, init: any) => {
      requests.push({ path, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ schedule: { ...schedule, title: "New" } }) };
    },
  });
  assert.equal(await created.create(), false);
  assert.equal(requests.length, 0);
  documentRef.getElementById("scheduled-tasks-title")!.value = "New watch";
  documentRef.getElementById("scheduled-tasks-repo")!.value = "acme/demo";
  assert.equal(await created.create(), true);
  assert.deepEqual(requests[0], { path: "/api/schedules", body: { title: "New watch", job: "ci-watch", repo: "acme/demo", kind: "interval", intervalMinutes: 60 } });
  documentRef.getElementById("scheduled-tasks-title")!.value = "Evening watch";
  documentRef.getElementById("scheduled-tasks-kind")!.value = "daily";
  documentRef.getElementById("scheduled-tasks-time")!.value = "08:15";
  assert.equal(await created.create(), true);
  assert.equal(requests[1].body.kind, "daily");
  assert.equal(requests[1].body.timeOfDay, "08:15");
});

test("row actions hit the update, run, and delete endpoints", async () => {
  const documentRef = new Document();
  const requests: any[] = [];
  const ui = await import(uiModulePath);
  const created = ui.createScheduledTasksUI({
    documentRef, translate: (key: string) => key,
    fetcher: async (path: string, init: any) => {
      requests.push({ path, method: init?.method ?? "GET" });
      if (path === "/api/schedules") return schedulesResponse([schedule]);
      return { ok: true, json: async () => ({}) };
    },
  });
  await created.refresh();
  const buttons = documentRef.getElementById("scheduled-tasks-definitions")!.children[0]!.children.slice(1) as any[];
  assert.equal(buttons[0].textContent, "scheduledTasks.runNow");
  await created.runNow(schedule.id);
  await created.toggle(schedule);
  await created.remove(schedule.id);
  const runRequest = requests.find((request) => request.path.endsWith("/run"));
  assert.equal(runRequest?.method, "POST");
  assert.ok(requests.some((request) => request.path === `/api/schedules/${schedule.id}` && request.method === "POST"));
  assert.ok(requests.some((request) => request.path === `/api/schedules/${schedule.id}` && request.method === "DELETE"));
});

test("history renders bounded run records with trigger labels", async () => {
  const documentRef = new Document();
  const ui = await import(uiModulePath);
  const created = ui.createScheduledTasksUI({
    documentRef, translate: (key: string) => key,
    fetcher: async (path: string) => path.endsWith("/runs")
      ? { ok: true, json: async () => ({ id: schedule.id, runs: [
        { startedAt: "2026-09-28T02:00:00.000Z", finishedAt: "2026-09-28T02:00:05.000Z", ok: true, trigger: "manual", summary: { repo: "acme/demo", failingCount: 2 } },
        { startedAt: "2026-09-28T01:00:00.000Z", finishedAt: "2026-09-28T01:00:05.000Z", ok: false, trigger: "schedule", summary: { code: "opt-in-required" } },
      ] }) }
      : schedulesResponse([schedule]),
  });
  assert.equal(await created.loadHistory(schedule.id), true);
  const rows = documentRef.getElementById("scheduled-tasks-history")!.children;
  assert.equal(rows.length, 2);
  assert.match(rows[0]!.textContent, /trigger\.manual/);
  assert.match(rows[0]!.textContent, /acme\/demo/);
  assert.match(rows[1]!.textContent, /opt-in-required/);
  assert.match(rows[1]!.textContent, /scheduledTasks\.failed/);
});
