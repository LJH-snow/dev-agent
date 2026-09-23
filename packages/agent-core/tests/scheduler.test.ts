import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentTaskCancelledError,
  AgentTaskScheduler,
  type AgentTaskStatus,
} from "../dist/index.js";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("condition was not reached");
}

test("runs one task at a time and keeps later work queued", async () => {
  const scheduler = new AgentTaskScheduler({ concurrency: 1 });
  const release = deferred<string>();
  const first = scheduler.schedule({
    id: "task-1",
    run: async () => release.promise,
  });
  const second = scheduler.schedule({
    id: "task-2",
    run: async () => "two",
  });

  await waitFor(() => scheduler.get("task-1")?.status === "running");
  assert.deepEqual(
    scheduler.list().map((task) => task.status),
    ["running", "queued"],
  );

  release.resolve("one");
  assert.equal(await first, "one");
  assert.equal(await second, "two");
  assert.deepEqual(
    scheduler.list().map((task) => task.status),
    ["completed", "completed"],
  );
});

test("records waiting-for-confirmation without losing the running task", async () => {
  const scheduler = new AgentTaskScheduler({ concurrency: 1 });
  const release = deferred<string>();
  const task = scheduler.schedule({
    id: "approval-task",
    run: async ({ setStatus }) => {
      setStatus("waiting-for-confirmation", "approval pending");
      await release.promise;
      setStatus("running");
      return "approved";
    },
  });

  await waitFor(() => scheduler.get("approval-task")?.status === "waiting-for-confirmation");
  assert.equal(scheduler.get("approval-task")?.detail, "approval pending");
  release.resolve("done");
  assert.equal(await task, "approved");
  assert.equal(scheduler.get("approval-task")?.status, "completed");
});

test("cancels queued work without invoking its runner", async () => {
  const scheduler = new AgentTaskScheduler({ concurrency: 1 });
  const release = deferred<void>();
  let invoked = false;
  const first = scheduler.schedule({
    id: "active-task",
    run: async () => release.promise,
  });
  const second = scheduler.schedule({
    id: "queued-task",
    run: async () => {
      invoked = true;
    },
  });

  await waitFor(() => scheduler.get("queued-task")?.status === "queued");
  assert.equal(scheduler.cancel("queued-task", "user cancelled"), true);
  await assert.rejects(second, AgentTaskCancelledError);
  assert.equal(invoked, false);

  release.resolve();
  await first;
  assert.equal(scheduler.get("queued-task")?.status, "cancelled");
});

test("forwards cancellation to a running task and keeps it cancelled", async () => {
  const scheduler = new AgentTaskScheduler({ concurrency: 1 });
  let signal!: AbortSignal;
  const task = scheduler.schedule({
    id: "running-task",
    run: ({ signal: taskSignal }) => {
      signal = taskSignal;
      return new Promise<string>((_resolve, reject) => {
        taskSignal.addEventListener("abort", () => reject(taskSignal.reason));
      });
    },
  });

  await waitFor(() => scheduler.get("running-task")?.status === "running");
  assert.equal(scheduler.cancel("running-task", "escape"), true);
  assert.equal(signal.aborted, true);
  await assert.rejects(task, AgentTaskCancelledError);
  assert.equal(scheduler.get("running-task")?.status, "cancelled");
});

test("retains bounded terminal history and rejects invalid or duplicate ids", async () => {
  const scheduler = new AgentTaskScheduler({
    maxRetained: 2,
    now: (() => {
      let tick = 0;
      return () => `2026-09-21T00:00:0${tick++}.000Z`;
    })(),
  });

  await scheduler.schedule({ id: "one", run: async () => undefined });
  await scheduler.schedule({ id: "two", run: async () => undefined });
  await scheduler.schedule({ id: "three", run: async () => undefined });

  assert.deepEqual(scheduler.list().map((task) => task.id), ["two", "three"]);
  assert.throws(
    () => scheduler.schedule({ id: "three", run: async () => undefined }),
    /duplicate task id: three/,
  );
  assert.throws(
    () => new AgentTaskScheduler({ concurrency: 0 }),
    /concurrency must be a positive integer/,
  );
});

test("task snapshots contain only bounded lifecycle metadata", async () => {
  const scheduler = new AgentTaskScheduler();
  const task = scheduler.schedule({
    id: "safe-task",
    run: async ({ setStatus }) => {
      setStatus("running", "safe detail");
      return "secret model output";
    },
  });

  await task;
  const snapshot = scheduler.get("safe-task");
  assert.deepEqual(Object.keys(snapshot ?? {}).sort(), [
    "createdAt",
    "detail",
    "finishedAt",
    "id",
    "startedAt",
    "status",
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret model output|prompt|path/i);
  assert.ok((["queued", "running", "waiting-for-confirmation", "completed", "failed", "cancelled"] satisfies readonly AgentTaskStatus[]).includes(snapshot?.status ?? "queued"));
});

test("rejects unsafe task ids and redacts absolute paths from task details", async () => {
  const scheduler = new AgentTaskScheduler();
  assert.throws(
    () => scheduler.schedule({ id: "/Users/Admin/secret", run: async () => undefined }),
    /task id must be a safe identifier/,
  );

  const task = scheduler.schedule({
    id: "path-task",
    run: async ({ setStatus }) => {
      setStatus("waiting-for-confirmation", "/Users/Admin/Desktop/dev-agent");
      return undefined;
    },
  });
  await task;
  assert.doesNotMatch(JSON.stringify(scheduler.get("path-task")), /\/Users\/Admin/);
});
