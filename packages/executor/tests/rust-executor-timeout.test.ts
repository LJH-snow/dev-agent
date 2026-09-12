import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RustExecutor } from "../dist/index.js";

// `import.meta.url` points at the compiled tests-dist/ copy.
const mockBinary = fileURLToPath(new URL("../tests/mock-executor-binary.mjs", import.meta.url));
const wedgedBinary = fileURLToPath(
  new URL("../tests/wedged-executor-binary.mjs", import.meta.url)
);

/** Rejects with "timed out" rather than hanging, so tests cannot stall. */
function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T | string> {
  return Promise.race([
    promise,
    new Promise<string>((resolve) => setTimeout(() => resolve(`STILL-PENDING:${label}`), ms)),
  ]);
}

test("a wedged runtime is abandoned instead of hanging the caller forever", async () => {
  const executor = new RustExecutor({ binaryPath: wedgedBinary, requestTimeoutMs: 400 });
  const started = Date.now();
  try {
    const outcome = await withDeadline(
      executor.run("echo", ["hi"]).then(
        () => "resolved",
        (error: Error) => `rejected: ${error.message}`
      ),
      3000,
      "wedged"
    );

    assert.notEqual(outcome, "STILL-PENDING:wedged", "the request must not hang");
    assert.match(String(outcome), /did not answer "echo" within 400ms/);
    assert.ok(Date.now() - started < 2500, "the backstop must fire on its own");
  } finally {
    await executor.dispose();
  }
});

test("a timed-out request frees its concurrency slot", async () => {
  const executor = new RustExecutor({
    binaryPath: wedgedBinary,
    maxConcurrentExecutions: 1,
    requestTimeoutMs: 300,
  });
  try {
    const first = await withDeadline(
      executor.run("echo", ["a"]).then(
        () => "resolved",
        (error: Error) => error.message
      ),
      3000,
      "first"
    );
    assert.match(String(first), /did not answer/, "the first call must time out");

    // Give dispose() a moment to finish tearing the old process down.
    await new Promise((resolve) => setTimeout(resolve, 900));

    // With one slot and the old process gone, the next call must reach the
    // runtime again. Before the fix it answered "Concurrent execution limit".
    const second = await withDeadline(
      executor.run("echo", ["b"]).then(
        () => "resolved",
        (error: Error) => error.message
      ),
      3000,
      "second"
    );
    assert.doesNotMatch(
      String(second),
      /Concurrent execution limit/,
      "the abandoned request must not hold its slot forever"
    );
  } finally {
    await executor.dispose();
  }
});

test("requestTimeoutMs: 0 keeps the previous unbounded behaviour", async () => {
  const executor = new RustExecutor({ binaryPath: wedgedBinary, requestTimeoutMs: 0 });
  try {
    const outcome = await withDeadline(
      executor.run("echo", ["hi"]).then(
        () => "resolved",
        (error: Error) => `rejected: ${error.message}`
      ),
      900,
      "unbounded"
    );

    assert.equal(outcome, "STILL-PENDING:unbounded", "0 disables the client backstop");
  } finally {
    await executor.dispose();
  }
});

test("a healthy runtime is unaffected by the backstop", async () => {
  const executor = new RustExecutor({ binaryPath: mockBinary, requestTimeoutMs: 5000 });
  try {
    const result = await executor.run("echo", ["hello"]);

    assert.equal(result.stdout, "mock:echo");
    assert.equal(result.exitCode, 0);
  } finally {
    await executor.dispose();
  }
});
