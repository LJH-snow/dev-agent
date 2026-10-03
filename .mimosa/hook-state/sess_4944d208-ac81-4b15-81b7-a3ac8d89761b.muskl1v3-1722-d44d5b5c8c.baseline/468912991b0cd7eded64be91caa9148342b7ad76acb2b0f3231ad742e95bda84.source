import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveExecutorSelection,
  type ExecutorSelectionInput,
} from "../dist/runtime-selection.js";

test("executor selection defaults to local without touching runtime state", () => {
  assert.deepEqual(resolveExecutorSelection({}), { mode: "local", source: "default" });
});

test("explicit local selection wins over an environment runtime preference", () => {
  assert.deepEqual(
    resolveExecutorSelection({ executor: "local", envRuntimeBinary: "/tmp/runtime" }),
    { mode: "local", source: "flag" }
  );
});

test("rust-sandbox selection requires a resolved installed binary", () => {
  assert.deepEqual(
    resolveExecutorSelection({ executor: "rust-sandbox", runtimeBinary: "/tmp/runtime" }),
    { mode: "rust-sandbox", source: "flag", rustBinaryPath: "/tmp/runtime" }
  );
  assert.throws(
    () => resolveExecutorSelection({ executor: "rust-sandbox" }),
    /runtime.*installed|binary/i
  );
});

test("explicit binary path remains a compatible rust-sandbox selection", () => {
  const input: ExecutorSelectionInput = { rustBinaryPath: "/tmp/explicit-runtime" };
  assert.deepEqual(resolveExecutorSelection(input), {
    mode: "rust-sandbox",
    source: "explicit-path",
    rustBinaryPath: "/tmp/explicit-runtime",
  });
});

test("conflicting executor flags fail closed", () => {
  assert.throws(
    () =>
      resolveExecutorSelection({
        executor: "local",
        rustBinaryPath: "/tmp/explicit-runtime",
      }),
    /cannot be combined|conflict/i
  );
});
