import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApprovedPlanContext,
  latestAssistantPlanText,
} from "../dist/plan-mode.js";

test("captures the latest non-error assistant response as the pending plan", () => {
  const plan = latestAssistantPlanText([
    { role: "user", content: "old request" },
    { role: "assistant", content: "old answer" },
    { role: "assistant", content: "[error] provider timeout" },
    {
      role: "assistant",
      content: "1. Inspect the route\n2. Add a regression test\n3. Run the test suite",
    },
  ] as any);

  assert.equal(
    plan,
    "1. Inspect the route\n2. Add a regression test\n3. Run the test suite",
  );
});

test("approved plan context tells the next model turn to execute the reviewed plan", () => {
  const context = buildApprovedPlanContext(
    "1. Update src/router.ts\n2. Run pnpm test",
  );

  assert.match(context, /approved implementation plan/i);
  assert.match(context, /execute it now/i);
  assert.match(context, /src\/router\.ts/);
  assert.match(context, /pnpm test/);
});

test("approved plan context is bounded", () => {
  const context = buildApprovedPlanContext("x".repeat(100_000));

  assert.ok(context.length <= 24_000);
});
