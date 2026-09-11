import assert from "node:assert/strict";
import test from "node:test";

import { LocalExecutor } from "../dist/local-executor.js";

test("LocalExecutor truncates output exceeding maxOutputBytes", async () => {
  const executor = new LocalExecutor();
  const result = await executor.run("node", ["-e", "console.log('x'.repeat(200))"], {
    maxOutputBytes: 50,
  });

  assert.ok(result.bytesTruncated, "Expected bytesTruncated to be true");
  assert.ok(result.stdout.length <= 100, `Expected stdout to be <= 100 chars, got ${result.stdout.length}`);
});

test("LocalExecutor does not truncate output within limit", async () => {
  const executor = new LocalExecutor();
  const result = await executor.run("echo", ["hello"]);

  assert.equal(result.bytesTruncated, undefined);
  assert.match(result.stdout, /hello/);
  assert.equal(result.exitCode, 0);
});

test("LocalExecutor rejects when concurrent execution limit reached", async () => {
  const executor = new LocalExecutor({ maxConcurrentExecutions: 1 });

  // Start a command that blocks reading from stdin (keeps running)
  const pending = executor.run("node", ["-e", "process.stdin.resume(); setTimeout(() => {}, 5000)"], {});

  // Small delay to let the first command start
  await new Promise((r) => setTimeout(r, 300));

  // Second execution should reject
  await assert.rejects(
    () => executor.run("echo", ["too many"]),
    /Concurrent execution limit reached/
  );

  // Clean up
  await executor.run("node", ["-e", ""], {}).catch(() => {});
});

test("LocalExecutor activeCount tracks running executions", async () => {
  const executor = new LocalExecutor({ maxConcurrentExecutions: 5 });
  assert.equal(executor.getActiveCount(), 0);

  const result = await executor.run("echo", ["test"]);
  assert.equal(result.exitCode, 0);
  assert.equal(executor.getActiveCount(), 0);
});

test("LocalExecutor releases slot after execution completes", async () => {
  const executor = new LocalExecutor({ maxConcurrentExecutions: 1 });

  const r1 = await executor.run("echo", ["first"]);
  assert.equal(r1.exitCode, 0);
  assert.equal(executor.getActiveCount(), 0);

  // Should succeed now
  const r2 = await executor.run("echo", ["second"]);
  assert.equal(r2.exitCode, 0);
});
