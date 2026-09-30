import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ScheduledTaskManager,
  computeNextRunAt,
  normalizeScheduleDefinition,
  type ScheduleMutationResult,
} from "../dist/scheduled-tasks.js";

function failCode(result: ScheduleMutationResult): string {
  // The test tsconfig compiles without strictNullChecks, where parameter-flow
  // narrowing of this union is unavailable; read the discriminant explicitly.
  return result.ok ? "" : (result as { code: string }).code;
}

function harness() {
  let currentMs = Date.UTC(2026, 8, 28, 2, 0, 0);
  const fired: number[] = [];
  let jobResult: { ok: boolean; summary: Record<string, unknown> } = { ok: true, summary: { state: "clean" } };
  const manager = new ScheduledTaskManager({
    stateFile: join(tmpdir(), `sched-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`),
    now: () => currentMs,
    runJob: async () => {
      fired.push(currentMs);
      return jobResult;
    },
  });
  return {
    manager,
    jobs: fired,
    advance: (ms: number) => { currentMs += ms; },
    set nowMs(value: number) { currentMs = value; },
    get nowMs() { return currentMs; },
    set jobResult(value: { ok: boolean; summary: Record<string, unknown> }) { jobResult = value; },
  };
}

const intervalInput = { title: "Morning CI watch", job: "ci-watch", repo: "acme/demo", kind: "interval", intervalMinutes: 15 };

test("create validates cadence fields and computes the first nextRunAt", async () => {
  const { manager, nowMs } = harness();
  assert.equal(failCode(await manager.create({ ...intervalInput, intervalMinutes: 10 })), "invalid-cadence");
  assert.equal(failCode(await manager.create({ ...intervalInput, kind: "daily" })), "invalid-definition");
  assert.equal(failCode(await manager.create({ ...intervalInput, kind: "daily", timeOfDay: "25:00" })), "invalid-cadence");
  assert.equal(failCode(await manager.create({ ...intervalInput, job: "deploy" })), "invalid-job");
  assert.equal(failCode(await manager.create({ ...intervalInput, title: "   " })), "invalid-title");
  const created = await manager.create(intervalInput);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.match(created.schedule.id, /^sched-/);
  assert.equal(created.schedule.enabled, true);
  assert.equal(Date.parse(created.schedule.nextRunAt ?? ""), nowMs + 15 * 60_000);
});

test("computeNextRunAt rolls daily schedules to the next local wall-clock occurrence", () => {
  const at = (hours: number, minutes: number) => {
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
  };
  const cadence = { kind: "daily" as const, timeOfDay: "09:00" };
  const before = at(8, 0);
  const expected = new Date(before); expected.setHours(9, 0, 0, 0);
  assert.equal(computeNextRunAt(cadence, before), expected.getTime());
  const after = at(9, 30);
  const expectedTomorrow = new Date(after); expectedTomorrow.setHours(9, 0, 0, 0);
  assert.equal(computeNextRunAt(cadence, after), expectedTomorrow.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(computeNextRunAt({ kind: "interval", intervalMinutes: 30 }, 1_000), 1_000 + 30 * 60_000);
});

test("tick fires due definitions once, records bounded history, and advances the cadence", async () => {
  const h = harness();
  const created = await h.manager.create(intervalInput);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  h.advance(15 * 60_000);
  const recorded = await h.manager.tick();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.ok, true);
  assert.equal(recorded[0]!.trigger, "schedule");
  assert.equal(Date.parse(created.schedule.nextRunAt ?? "") <= h.nowMs, true);
  const after = h.manager.get(created.schedule.id);
  assert.equal(Date.parse(after!.nextRunAt ?? ""), h.nowMs + 15 * 60_000);
  assert.ok(after!.lastRunAt);
  const history = h.manager.history(created.schedule.id);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0]!.summary, { state: "clean" });
  assert.equal((await h.manager.tick()).length, 0);
});

test("a schedule left overdue by downtime catches up exactly once", async () => {
  const { manager, advance, jobs } = harness();
  const created = await manager.create(intervalInput);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  advance(3 * 24 * 60 * 60 * 1000);
  assert.equal((await manager.tick()).length, 1);
  advance(60_000);
  assert.equal((await manager.tick()).length, 0);
  assert.equal(jobs.length, 1);
  const schedule = manager.get(created.schedule.id)!;
  assert.equal(Date.parse(schedule.nextRunAt ?? "") - Date.parse(schedule.lastRunAt ?? ""), 15 * 60_000);
});

test("run history caps at 20 newest-first", async () => {
  const { manager, advance } = harness();
  const created = await manager.create(intervalInput);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  for (let i = 0; i < 25; i += 1) {
    advance(15 * 60_000);
    await manager.tick();
  }
  const history = manager.history(created.schedule.id);
  assert.equal(history.length, 20);
  const schedule = manager.get(created.schedule.id)!;
  assert.equal(Date.parse(history[0]!.startedAt), Date.parse(schedule.lastRunAt ?? ""));
});

test("oversized run summaries are truncated to a bounded marker", async () => {
  const h = harness();
  const created = await h.manager.create(intervalInput);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  h.jobResult = { ok: true, summary: { blob: "x".repeat(9 * 1024) } };
  h.advance(15 * 60_000);
  const recorded = await h.manager.tick();
  assert.deepEqual(recorded[0]!.summary, { truncated: true });
});

test("long-running jobs are not re-fired by overlapping ticks", async () => {
  const stateFile = join(tmpdir(), `sched-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  let currentMs = Date.UTC(2026, 8, 28, 2, 0, 0);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let fires = 0;
  const manager = new ScheduledTaskManager({
    stateFile,
    now: () => currentMs,
    runJob: async () => { fires += 1; await gate; return { ok: true, summary: {} }; },
  });
  const created = await manager.create(intervalInput);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  currentMs += 15 * 60_000;
  const firstTick = manager.tick();
  assert.equal((await manager.tick()).length, 0);
  release!();
  assert.equal((await firstTick).length, 1);
  assert.equal(fires, 1);
  await rm(stateFile, { force: true });
});

test("update, enable/disable, and remove behave and persist", async () => {
  const stateFile = join(tmpdir(), `sched-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const manager = new ScheduledTaskManager({ stateFile });
  const created = await manager.create(intervalInput);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const disabled = await manager.update(created.schedule.id, { enabled: false });
  assert.equal(disabled.ok, true);
  if (!disabled.ok) return;
  assert.equal(disabled.schedule.enabled, false);
  const nextRunAtWhenDisabled = disabled.schedule.nextRunAt;
  const reEnabled = await manager.update(created.schedule.id, { enabled: true });
  if (!reEnabled.ok) return void assert.fail("re-enable failed");
  assert.ok(Date.parse(reEnabled.schedule.nextRunAt ?? "") >= Date.parse(nextRunAtWhenDisabled ?? ""));
  const retimed = await manager.update(created.schedule.id, { kind: "daily", timeOfDay: "08:30" });
  assert.equal(retimed.ok, true);
  if (!retimed.ok) return;
  assert.equal(retimed.schedule.timeOfDay, "08:30");
  assert.equal(retimed.schedule.intervalMinutes, undefined);
  assert.equal(failCode(await manager.update("sched-does-not-exist-000", { enabled: false })), "unknown-schedule");
  assert.equal(await manager.remove(created.schedule.id), true);
  assert.equal(manager.get(created.schedule.id), undefined);
  await rm(stateFile, { force: true });
});

test("definitions cap at 64 and state round-trips across manager restarts", async () => {
  const stateFile = join(tmpdir(), `sched-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const manager = new ScheduledTaskManager({ stateFile });
  for (let i = 0; i < 64; i += 1) {
    const created = await manager.create({ ...intervalInput, title: `s${i}`, intervalMinutes: 15 + i });
    assert.equal(created.ok, true, `definition ${i}`);
  }
  assert.equal(failCode(await manager.create(intervalInput)), "schedule-limit");
  const reloaded = new ScheduledTaskManager({ stateFile });
  assert.equal(reloaded.list().length, 64);
  const first = reloaded.list()[0]!;
  assert.equal(first.job, "ci-watch");
  assert.equal(first.repo, "acme/demo");
  await rm(stateFile, { force: true });
});

test("malformed state files are ignored instead of crashing the manager", async () => {
  const stateFile = join(tmpdir(), `sched-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(stateFile, "{ not json", "utf8");
  const manager = new ScheduledTaskManager({ stateFile });
  assert.equal(manager.list().length, 0);
  assert.equal((await manager.create(intervalInput)).ok, true);
  const persisted = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(persisted.version, 1);
  await rm(stateFile, { force: true });
});

test("normalizeScheduleDefinition rejects malformed persisted entries", () => {
  assert.equal(normalizeScheduleDefinition({ id: "bad", title: "x", job: "ci-watch", kind: "interval", intervalMinutes: 15, enabled: true, createdAt: new Date().toISOString() }), undefined);
  assert.equal(normalizeScheduleDefinition({ id: "sched-abcdef-abcdef", title: "x", job: "deploy", kind: "interval", intervalMinutes: 15, enabled: true, createdAt: new Date().toISOString() }), undefined);
  const ok = normalizeScheduleDefinition({
    id: "sched-abcdef-abcdef", title: "watch", job: "ci-watch", repo: "acme/demo",
    kind: "daily", timeOfDay: "09:00", enabled: true, createdAt: "2026-09-28T00:00:00.000Z",
  });
  assert.equal(ok?.timeOfDay, "09:00");
});
