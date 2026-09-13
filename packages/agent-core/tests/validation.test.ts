import assert from "node:assert/strict";
import test from "node:test";

import type {
  ValidationCheck,
  ValidationPlan,
  ValidationResult,
  ValidationRunner,
} from "../dist/index.js";

test("validation contract describes an auditable plan and result", async () => {
  const check: ValidationCheck = {
    id: "package:tools:typecheck",
    label: "Typecheck @dev-agent/tools",
    command: {
      executable: "pnpm",
      args: ["--filter", "@dev-agent/tools", "typecheck"],
      cwd: "/workspace",
      timeoutMs: 120_000,
    },
  };
  const plan: ValidationPlan = {
    validationId: "validation:cs-test",
    changeSetId: "cs-test",
    status: "ready",
    checks: [check],
    summary: "1 validation check planned",
  };
  const result: ValidationResult = {
    validationId: plan.validationId,
    changeSetId: plan.changeSetId,
    status: "passed",
    checks: [
      {
        ...check,
        status: "passed",
        durationMs: 12,
        exitCode: 0,
        output: "ok",
      },
    ],
    durationMs: 12,
    summary: "1 validation check passed",
  };

  const runner: ValidationRunner = {
    async run(receivedPlan) {
      assert.equal(receivedPlan.validationId, plan.validationId);
      return result;
    },
  };

  const returned = await runner.run(plan);
  assert.equal(result.status, "passed");
  assert.equal(returned.checks[0]?.command.args[0], "--filter");
});
