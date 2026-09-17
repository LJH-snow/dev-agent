import assert from "node:assert/strict";
import test from "node:test";

import { BudgetTracker } from "../dist/index.js";

test("budget tracker reports a stable maxTokens error before the next model call", () => {
  const tracker = new BudgetTracker({ maxTokens: 10 });

  tracker.beforeModelCall();
  tracker.recordModelOutput("done", {
    promptTokens: 6,
    completionTokens: 4,
    totalTokens: 10,
  });

  assert.throws(
    () => tracker.beforeModelCall(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.deepEqual((error as unknown as { toJSON(): unknown }).toJSON(), {
        code: "budget_exceeded",
        budget: "maxTokens",
        phase: "model",
        limit: 10,
        observed: 10,
      });
      return true;
    }
  );
});

test("budget tracker uses an injected clock at the duration boundary", () => {
  let now = 100;
  const tracker = new BudgetTracker({ maxDurationMs: 50, clock: () => now });

  tracker.beforeModelCall();
  now = 150;

  assert.throws(
    () => tracker.beforeToolCall(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.deepEqual((error as unknown as { toJSON(): unknown }).toJSON(), {
        code: "budget_exceeded",
        budget: "maxDurationMs",
        phase: "tool",
        limit: 50,
        observed: 50,
      });
      return true;
    }
  );
});

test("budget tracker blocks a tool call when output is at the configured boundary", () => {
  const tracker = new BudgetTracker({ maxOutputChars: 4 });

  tracker.beforeModelCall();
  tracker.recordModelOutput("done");

  assert.throws(
    () => tracker.beforeToolCall(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.deepEqual((error as unknown as { toJSON(): unknown }).toJSON(), {
        code: "budget_exceeded",
        budget: "maxOutputChars",
        phase: "tool",
        limit: 4,
        observed: 4,
      });
      return true;
    }
  );
});

test("budget tracker blocks the next model call at maxTurns", () => {
  const tracker = new BudgetTracker({ maxTurns: 1 });

  tracker.beforeModelCall();

  assert.throws(
    () => tracker.beforeModelCall(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.deepEqual((error as unknown as { toJSON(): unknown }).toJSON(), {
        code: "budget_exceeded",
        budget: "maxTurns",
        phase: "model",
        limit: 1,
        observed: 1,
      });
      return true;
    }
  );
});

test("budget tracker aggregates per-run usage and output statistics", () => {
  let now = 10;
  const tracker = new BudgetTracker({
    maxTurns: 3,
    maxTokens: 20,
    maxOutputChars: 20,
    clock: () => now,
  });

  tracker.beforeModelCall();
  tracker.recordModelOutput("hello", {
    promptTokens: 4,
    completionTokens: 3,
    totalTokens: 7,
  });
  now = 15;
  tracker.beforeToolCall();
  tracker.recordToolOutput("world");

  assert.deepEqual(tracker.snapshot(), {
    turns: 1,
    tokens: 7,
    outputChars: 10,
    elapsedMs: 5,
  });
});
