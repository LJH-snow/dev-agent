import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentTaskScheduler,
  AgentToolRegistry,
  createAgentContext,
  InMemoryMemory,
} from "@dev-agent/agent-core";

import {
  createTaskStatusBridge,
  scheduleInteractiveTask,
} from "../dist/task-status-bridge.js";

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("interactive task bridge tracks approval and restores the running state", async () => {
  const scheduler = new AgentTaskScheduler({ concurrency: 1 });
  const bridge = createTaskStatusBridge();
  const approval = createDeferred<void>();
  const waiting = createDeferred<void>();

  const scheduled = scheduleInteractiveTask(
    scheduler,
    bridge,
    async ({ signal, setStatus }) => {
      assert.equal(scheduler.list().at(-1)?.status, "running");
      setStatus("waiting-for-confirmation", "approval pending");
      assert.equal(
        scheduler.list().at(-1)?.status,
        "waiting-for-confirmation"
      );
      waiting.resolve();
      await approval.promise;
      bridge.running();
      assert.equal(scheduler.list().at(-1)?.status, "running");
      assert.equal(scheduler.list().at(-1)?.detail, "confirmation resolved");
      return signal.aborted;
    }
  );
  await waiting.promise;
  assert.equal(scheduler.get("task-1")?.status, "waiting-for-confirmation");
  assert.ok(bridge.current);

  approval.resolve();
  await scheduled;

  assert.equal(scheduler.get("task-1")?.status, "completed");
  assert.equal(bridge.current, undefined);
});

test("approval callbacks move the scheduled task to waiting and back", async () => {
  const scheduler = new AgentTaskScheduler({ concurrency: 1 });
  const bridge = createTaskStatusBridge();
  const tools = new AgentToolRegistry();
  tools.register({
    name: "echo",
    description: "Echoes the input.",
    async execute(input) {
      return { echoed: input };
    },
  });

  let modelCalls = 0;
  const approval = createDeferred<void>();
  const waiting = createDeferred<void>();
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: "",
          toolCalls: [
            { id: "call-1", name: "echo", input: { text: "hello" } },
          ],
        };
      }
      return { content: "done", toolCalls: [] };
    },
  };
  const context = createAgentContext("approval-status", new InMemoryMemory());
  const loop = new AgentLoop({
    model,
    tools,
    maxTurns: 3,
    onApprovalStatus: (status) => {
      if (status === "waiting") {
        bridge.waiting();
        waiting.resolve();
      } else {
        bridge.running();
      }
    },
    approval: {
      async decide() {
        await approval.promise;
        return { decision: "deny" as const, reason: "test deny" };
      },
    } as any,
  });

  const scheduled = scheduleInteractiveTask(
    scheduler,
    bridge,
    ({ signal }) => loop.run(context, "approval prompt", { signal })
  );
  await waiting.promise;
  assert.equal(scheduler.get("task-1")?.status, "waiting-for-confirmation");
  assert.equal(scheduler.get("task-1")?.detail, "approval pending");

  approval.resolve();
  await scheduled;

  assert.equal(modelCalls, 2);
  assert.equal(scheduler.get("task-1")?.status, "completed");
  assert.doesNotMatch(JSON.stringify(scheduler.list()), /approval prompt|hello/);
});
