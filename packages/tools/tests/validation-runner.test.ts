import assert from "node:assert/strict";
import test from "node:test";

import type { Executor, ExecutorResult, ExecutorRunOptions } from "@dev-agent/executor";
import {
  createValidationRunner,
  type ValidationRunnerOptions,
} from "../dist/index.js";
import type { ValidationPlan } from "@dev-agent/agent-core";

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly options?: ExecutorRunOptions;
}

function plan(checks: ValidationPlan["checks"], status: ValidationPlan["status"] = "ready"): ValidationPlan {
  return {
    validationId: "validation:runner",
    changeSetId: "cs-runner",
    status,
    checks,
    summary: `${checks.length} planned`,
  };
}

function check(id: string): ValidationPlan["checks"][number] {
  return {
    id,
    label: id,
    command: {
      executable: "trusted-check",
      args: ["--check", id],
      cwd: "/workspace",
      timeoutMs: 500,
    },
  };
}

function fakeExecutor(
  handler: (command: string, args: readonly string[], options?: ExecutorRunOptions) => Promise<ExecutorResult>
): { executor: Executor; calls: Call[] } {
  const calls: Call[] = [];
  const executor: Executor = {
    async run(command, args = [], options) {
      calls.push({ command, args: [...args], options });
      return handler(command, args, options);
    },
  };
  return { executor, calls };
}

function ok(stdout = "ok"): ExecutorResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 7 };
}

function failed(stderr = "failed"): ExecutorResult {
  return { stdout: "", stderr, exitCode: 1, durationMs: 9 };
}

test("runner executes structured checks with cwd, timeout, signal, and passes", async () => {
  const { executor, calls } = fakeExecutor(async () => ok("passed"));
  const controller = new AbortController();
  const options: ValidationRunnerOptions = { maxOutputBytes: 1024 };
  const runner = createValidationRunner(executor, options);

  const result = await runner.run(plan([check("one")]), { signal: controller.signal });

  assert.equal(result.status, "passed");
  assert.equal(result.changeSetId, "cs-runner");
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0]?.status, "passed");
  assert.equal(result.checks[0]?.exitCode, 0);
  assert.equal(result.checks[0]?.output, "passed");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    command: "trusted-check",
    args: ["--check", "one"],
    options: {
      cwd: "/workspace",
      timeoutMs: 500,
      maxOutputBytes: 1024,
      signal: controller.signal,
    },
  });
});

test("a failed check stops later work and marks it skipped", async () => {
  const { executor, calls } = fakeExecutor(async () => failed("bad output"));
  const runner = createValidationRunner(executor);

  const result = await runner.run(plan([check("first"), check("second")]));

  assert.equal(result.status, "failed");
  assert.equal(calls.length, 1);
  assert.equal(result.checks[0]?.status, "failed");
  assert.equal(result.checks[0]?.output, "bad output");
  assert.equal(result.checks[1]?.status, "skipped");
  assert.match(result.checks[1]?.reason ?? "", /previous check failed/i);
  assert.match(result.summary, /failed/i);
});

test("a timed-out executor result is a failed check with an auditable reason", async () => {
  const { executor } = fakeExecutor(async () => ({
    stdout: "partial",
    stderr: "",
    exitCode: 124,
    timedOut: true,
    durationMs: 501,
  }));
  const runner = createValidationRunner(executor);

  const result = await runner.run(plan([check("slow")]));

  assert.equal(result.status, "failed");
  assert.equal(result.checks[0]?.status, "failed");
  assert.match(result.checks[0]?.reason ?? "", /timed out/i);
  assert.equal(result.checks[0]?.exitCode, 124);
});

test("abort before a check blocks validation without running a command", async () => {
  const { executor, calls } = fakeExecutor(async () => ok());
  const runner = createValidationRunner(executor);
  const controller = new AbortController();
  controller.abort();

  const result = await runner.run(plan([check("one"), check("two")]), {
    signal: controller.signal,
  });

  assert.equal(result.status, "blocked");
  assert.equal(calls.length, 0);
  assert.equal(result.checks[0]?.status, "blocked");
  assert.equal(result.checks[1]?.status, "skipped");
  assert.match(result.reason ?? "", /aborted/i);
});

test("an executor abort during a check blocks that check and skips the rest", async () => {
  const controller = new AbortController();
  const { executor, calls } = fakeExecutor(async (_command, _args, options) => {
    controller.abort();
    options?.signal?.throwIfAborted();
    return ok();
  });
  const runner = createValidationRunner(executor);

  const result = await runner.run(plan([check("one"), check("two")]), {
    signal: controller.signal,
  });

  assert.equal(result.status, "blocked");
  assert.equal(calls.length, 1);
  assert.equal(result.checks[0]?.status, "blocked");
  assert.equal(result.checks[1]?.status, "skipped");
});

test("runner bounds captured output and never turns it into a shell command", async () => {
  const { executor, calls } = fakeExecutor(async () => ok("0123456789abcdef"));
  const options: ValidationRunnerOptions = { maxOutputBytes: 8 };
  const runner = createValidationRunner(executor, options);

  const result = await runner.run(
    plan([
      {
        ...check("safe"),
        command: {
          ...check("safe").command,
          args: ["--literal", "$(rm -rf /)", "; echo injected"],
        },
      },
    ])
  );

  assert.equal(result.status, "passed");
  assert.ok(Buffer.byteLength(result.checks[0]?.output ?? "", "utf8") <= 8);
  assert.deepEqual(calls[0]?.args, ["--literal", "$(rm -rf /)", "; echo injected"]);
});

test("empty and blocked plans do not call the executor", async () => {
  const { executor, calls } = fakeExecutor(async () => ok());
  const runner = createValidationRunner(executor);

  const skipped = await runner.run(plan([]));
  const blocked = await runner.run(
    {
      ...plan([], "blocked"),
      reason: "unsafe review path",
    }
  );

  assert.equal(skipped.status, "skipped");
  assert.equal(blocked.status, "blocked");
  assert.equal(calls.length, 0);
  assert.match(blocked.reason ?? "", /unsafe review path/);
});
