import assert from "node:assert/strict";
import test from "node:test";

type QueueModule = {
  PromptMode?: "normal" | "plan";
  createPromptQueue: (options?: {
    maxQueued?: number;
    maxPromptLength?: number;
  }) => {
    enqueue(message: string, ids?: {
      queueId?: string;
      turnId?: string;
      mode?: "normal" | "plan";
    }):
      | { ok: true; item: { queueId: string; turnId: string; message: string; mode: "normal" | "plan" } }
      | { ok: false; reason: string };
    startNext(): { queueId: string; turnId: string; message: string; mode: "normal" | "plan" } | undefined;
    setWaitingApproval(): void;
    complete(status: "done" | "failed" | "aborted"): void;
    requeueActive(): { queueId: string; turnId: string; message: string; mode: "normal" | "plan" } | undefined;
    remove(queueId: string): boolean;
    clearQueued(): number;
    resume(): void;
    snapshot(): {
      mode: string;
      active?: { queueId: string; turnId: string; message: string; mode: "normal" | "plan" };
      queued: readonly { queueId: string; turnId: string; message: string; mode: "normal" | "plan" }[];
    };
  };
  createTurnLedger: () => {
    create(turnId: string, message: string): void;
    start(turnId: string): void;
    reopen(turnId: string): boolean;
    close(turnId: string, status: "done" | "failed" | "aborted"): void;
    acceptEvent(turnId: string, event: { type: string }): boolean;
  };
  createReplayCursor: () => {
    accept(runId: string, sequence: number): boolean;
  };
};

async function loadQueueModule(): Promise<QueueModule> {
  return (await import(new URL("../public/chat-queue.js", import.meta.url).href)) as QueueModule;
}

test("prompt queue drains waiting prompts in FIFO order after a normal completion", async () => {
  const { createPromptQueue } = await loadQueueModule();
  const queue = createPromptQueue();

  assert.equal(queue.enqueue("first", { queueId: "q1", turnId: "t1" }).ok, true);
  assert.equal(queue.enqueue("second", { queueId: "q2", turnId: "t2" }).ok, true);
  assert.deepEqual(queue.startNext(), {
    queueId: "q1",
    turnId: "t1",
    message: "first",
    mode: "normal",
  });

  queue.complete("done");
  assert.deepEqual(queue.startNext(), {
    queueId: "q2",
    turnId: "t2",
    message: "second",
    mode: "normal",
  });
});

test("prompt queue pauses on failure or abort without losing waiting prompts", async () => {
  const { createPromptQueue } = await loadQueueModule();
  const queue = createPromptQueue();

  queue.enqueue("active", { queueId: "q1", turnId: "t1" });
  queue.enqueue("waiting", { queueId: "q2", turnId: "t2" });
  queue.startNext();
  queue.complete("failed");

  assert.equal(queue.snapshot().mode, "paused");
  assert.equal(queue.snapshot().queued.length, 1);
  assert.equal(queue.startNext(), undefined);

  queue.resume();
  assert.deepEqual(queue.startNext(), {
    queueId: "q2",
    turnId: "t2",
    message: "waiting",
    mode: "normal",
  });
});

test("prompt queue rejects oversized and over-capacity input without dropping the active run", async () => {
  const { createPromptQueue } = await loadQueueModule();
  const queue = createPromptQueue({ maxQueued: 1, maxPromptLength: 4 });

  queue.enqueue("live", { queueId: "q1", turnId: "t1" });
  assert.deepEqual(queue.startNext(), {
    queueId: "q1",
    turnId: "t1",
    message: "live",
    mode: "normal",
  });
  assert.equal(queue.enqueue("wait", { queueId: "q2", turnId: "t2" }).ok, true);
  assert.deepEqual(queue.enqueue("more", { queueId: "q3", turnId: "t3" }), {
    ok: false,
    reason: "queue_full",
  });
  assert.deepEqual(queue.enqueue("toolong", { queueId: "q4", turnId: "t4" }), {
    ok: false,
    reason: "prompt_too_long",
  });
  assert.deepEqual(queue.snapshot().active, {
    queueId: "q1",
    turnId: "t1",
    message: "live",
    mode: "normal",
  });
});

test("prompt queue can remove waiting items and return an active item to the front", async () => {
  const { createPromptQueue } = await loadQueueModule();
  const queue = createPromptQueue();

  queue.enqueue("first", { queueId: "q1", turnId: "t1" });
  queue.enqueue("second", { queueId: "q2", turnId: "t2" });
  queue.enqueue("third", { queueId: "q3", turnId: "t3" });
  assert.deepEqual(queue.startNext(), {
    queueId: "q1",
    turnId: "t1",
    message: "first",
    mode: "normal",
  });
  assert.equal(queue.remove("q3"), true);
  assert.equal(queue.remove("q3"), false);

  assert.deepEqual(queue.requeueActive(), {
    queueId: "q1",
    turnId: "t1",
    message: "first",
    mode: "normal",
  });
  assert.equal(queue.snapshot().mode, "paused");
  assert.deepEqual(queue.snapshot().queued, [
    { queueId: "q1", turnId: "t1", message: "first", mode: "normal" },
    { queueId: "q2", turnId: "t2", message: "second", mode: "normal" },
  ]);

  assert.equal(queue.clearQueued(), 2);
  assert.equal(queue.snapshot().queued.length, 0);
});

test("prompt queue keeps plan mode with the prompt while it waits and requeues", async () => {
  const { createPromptQueue } = await loadQueueModule();
  const queue = createPromptQueue();

  assert.deepEqual(
    queue.enqueue("inspect before changing", {
      queueId: "q-plan",
      turnId: "t-plan",
      mode: "plan",
    }),
    {
      ok: true,
      item: {
        queueId: "q-plan",
        turnId: "t-plan",
        message: "inspect before changing",
        mode: "plan",
      },
    },
  );
  assert.deepEqual(queue.startNext(), {
    queueId: "q-plan",
    turnId: "t-plan",
    message: "inspect before changing",
    mode: "plan",
  });
  queue.setWaitingApproval();
  assert.equal(queue.snapshot().mode, "waiting-approval");
  assert.equal(queue.requeueActive()?.mode, "plan");
});

test("turn ledger rejects streamed events after a turn reaches a terminal state", async () => {
  const { createTurnLedger } = await loadQueueModule();
  const ledger = createTurnLedger();

  ledger.create("t1", "first");
  ledger.start("t1");
  assert.equal(ledger.acceptEvent("t1", { type: "token" }), true);
  ledger.close("t1", "done");

  assert.equal(ledger.acceptEvent("t1", { type: "token" }), false);
  assert.equal(ledger.acceptEvent("t1", { type: "tool" }), false);
  assert.equal(ledger.reopen("t1"), true);
  assert.equal(ledger.acceptEvent("t1", { type: "token" }), true);
});

test("replay cursor accepts increasing sequences once and resets for a new run", async () => {
  const { createReplayCursor } = await loadQueueModule();
  const cursor = createReplayCursor();

  assert.equal(cursor.accept("run-a", 1), true);
  assert.equal(cursor.accept("run-a", 1), false);
  assert.equal(cursor.accept("run-a", 0), false);
  assert.equal(cursor.accept("run-a", 2), true);
  assert.equal(cursor.accept("run-b", 1), true);
});
