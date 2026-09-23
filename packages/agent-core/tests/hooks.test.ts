import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentHookRegistry,
  type AgentHookContext,
} from "../dist/index.js";

const context: AgentHookContext = {
  sessionId: "hooks-session",
  runId: "run-1",
  turn: 1,
  status: "thinking",
};

test("runs registered hooks in registration order and records observer errors", async () => {
  const registry = new AgentHookRegistry();
  const order: string[] = [];
  registry.register("session.start", () => { order.push("session.start"); });
  registry.register("before.model", () => { order.push("before.model"); });
  registry.register("after.model", () => {
    order.push("after.model");
    throw new Error("observer failed");
  });
  registry.register("before.tool", () => { order.push("before.tool"); });
  registry.register("after.tool", () => { order.push("after.tool"); });
  registry.register("session.end", () => { order.push("session.end"); });

  await registry.run("session.start", context);
  await registry.run("before.model", context);
  await registry.run("after.model", context);
  await registry.run("before.tool", context);
  await registry.run("after.tool", context);
  await registry.run("session.end", context);

  assert.deepEqual(order, [
    "session.start",
    "before.model",
    "after.model",
    "before.tool",
    "after.tool",
    "session.end",
  ]);
  assert.deepEqual(registry.errors().map((error) => [error.hook, error.message]), [
    ["after.model", "observer failed"],
  ]);
});

test("aborting a hook run stops later observers and propagates the abort reason", async () => {
  const registry = new AgentHookRegistry();
  const controller = new AbortController();
  const order: string[] = [];
  registry.register("before.model", () => {
    order.push("first");
    controller.abort(new Error("stop from hook"));
  });
  registry.register("before.model", () => { order.push("second"); });

  await assert.rejects(
    registry.run("before.model", context, controller.signal),
    /stop from hook/,
  );
  assert.deepEqual(order, ["first"]);
});

test("registration handles remove a hook without affecting other observers", async () => {
  const registry = new AgentHookRegistry();
  const order: string[] = [];
  const remove = registry.register("before.tool", () => { order.push("removed"); });
  registry.register("before.tool", () => { order.push("kept"); });
  remove();

  await registry.run("before.tool", context);
  assert.deepEqual(order, ["kept"]);
});
