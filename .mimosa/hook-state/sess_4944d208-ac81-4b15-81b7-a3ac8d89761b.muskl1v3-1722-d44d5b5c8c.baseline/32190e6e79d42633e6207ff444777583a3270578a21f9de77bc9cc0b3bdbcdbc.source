import assert from "node:assert/strict";
import test from "node:test";

type Activity =
  | "queued"
  | "thinking"
  | "tool"
  | "responding"
  | "approval"
  | "done"
  | "failed"
  | "aborted"
  | "removed";

type ActivityModule = {
  getTurnActivityForEvent: (eventType: string) => Activity;
  getTurnActivityForState: (state: string) => Activity;
};

async function loadActivityModule(): Promise<ActivityModule> {
  return (await import(new URL("../public/turn-activity.js", import.meta.url).href)) as ActivityModule;
}

test("turn activity maps stream events to safe visible stages", async () => {
  const { getTurnActivityForEvent } = await loadActivityModule();

  assert.equal(getTurnActivityForEvent("reasoning"), "thinking");
  assert.equal(getTurnActivityForEvent("turn"), "thinking");
  assert.equal(getTurnActivityForEvent("tool"), "tool");
  assert.equal(getTurnActivityForEvent("tool-progress"), "tool");
  assert.equal(getTurnActivityForEvent("tool-result"), "thinking");
  assert.equal(getTurnActivityForEvent("token"), "responding");
  assert.equal(getTurnActivityForEvent("approval-request"), "approval");
  assert.equal(getTurnActivityForEvent("plan-review"), "approval");
  assert.equal(getTurnActivityForEvent("done"), "done");
  assert.equal(getTurnActivityForEvent("error"), "failed");
  assert.equal(getTurnActivityForEvent("unknown"), "thinking");
});

test("turn activity maps lifecycle states and fails closed", async () => {
  const { getTurnActivityForState } = await loadActivityModule();

  assert.equal(getTurnActivityForState("queued"), "queued");
  assert.equal(getTurnActivityForState("running"), "thinking");
  assert.equal(getTurnActivityForState("waiting"), "approval");
  assert.equal(getTurnActivityForState("done"), "done");
  assert.equal(getTurnActivityForState("failed"), "failed");
  assert.equal(getTurnActivityForState("aborted"), "aborted");
  assert.equal(getTurnActivityForState("removed"), "removed");
  assert.equal(getTurnActivityForState("unexpected"), "thinking");
});
