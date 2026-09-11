import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { LocalExecutor, RustExecutor } from "../dist/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const mockBinary = join(here, "mock-executor-binary.mjs");

test("LocalExecutor aborts a running command", async () => {
  const executor = new LocalExecutor();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);

  const started = Date.now();
  await assert.rejects(
    () => executor.run("sleep", ["10"], { signal: controller.signal }),
    /cancelled/i
  );

  assert.ok(Date.now() - started < 2000, "the command should stop early");
});

test("LocalExecutor refuses to start a command with an aborted signal", async () => {
  const executor = new LocalExecutor();
  const controller = new AbortController();
  controller.abort();

  const started = Date.now();
  await assert.rejects(
    () => executor.run("sleep", ["10"], { signal: controller.signal }),
    /cancelled/i
  );

  assert.ok(Date.now() - started < 2000, "an already-aborted signal must not run the command");
});

test("RustExecutor cancels through the cancel envelope", async () => {
  process.env.MOCK_EXECUTOR_BEHAVIOR = "slow";
  const executor = new RustExecutor({ binaryPath: mockBinary });
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const started = Date.now();
    await assert.rejects(
      () => executor.run("sleep", ["10"], { signal: controller.signal }),
      /cancelled/i
    );

    assert.ok(Date.now() - started < 2000, "the runtime should answer with CANCELLED promptly");
  } finally {
    await executor.dispose();
    delete process.env.MOCK_EXECUTOR_BEHAVIOR;
  }
});

test("RustExecutor rejects a request beyond its concurrency limit", async () => {
  process.env.MOCK_EXECUTOR_BEHAVIOR = "slow";
  const executor = new RustExecutor({ binaryPath: mockBinary, maxConcurrentExecutions: 1 });
  try {
    const controller = new AbortController();
    const first = executor.run("sleep", ["10"], { signal: controller.signal });

    await assert.rejects(
      () => executor.run("echo", ["hi"]),
      /Concurrent execution limit reached \(1\)/
    );

    controller.abort();
    await assert.rejects(() => first, /cancelled/i);
  } finally {
    await executor.dispose();
    delete process.env.MOCK_EXECUTOR_BEHAVIOR;
  }
});

test("LocalExecutor escalates to SIGKILL when the command ignores SIGTERM", async () => {
  const executor = new LocalExecutor();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);

  const started = Date.now();
  await assert.rejects(
    () =>
      executor.run("/bin/sh", ["-c", "trap '' TERM; while :; do sleep 1; done"], {
        signal: controller.signal,
      }),
    /cancelled/i
  );

  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 2000, `expected the grace period to elapse, got ${elapsed}ms`);
  assert.ok(elapsed < 6000, `expected SIGKILL to take over, got ${elapsed}ms`);
});
