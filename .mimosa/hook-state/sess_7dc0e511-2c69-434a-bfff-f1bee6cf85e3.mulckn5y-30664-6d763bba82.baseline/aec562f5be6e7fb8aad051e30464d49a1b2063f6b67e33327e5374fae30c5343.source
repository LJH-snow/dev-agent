import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentContext,
  InMemoryMemory,
  type ValidationResult,
} from "@dev-agent/agent-core";
import {
  buildAutoFixPrompt,
  parseAutoFixCommand,
  runAutoFixLoop,
  selectLatestAutoFixTarget,
  summarizeValidationFailure,
} from "../dist/auto-fix-command.js";

function context(sessionId = "auto-fix-test") {
  return createAgentContext(sessionId, new InMemoryMemory(), {
    sessionId,
    workingDirectory: "/tmp/auto-fix-workspace",
  });
}

function validation(
  status: ValidationResult["status"],
  validationId: string,
  changeSetId = "change-set-1",
): ValidationResult {
  return {
    validationId,
    changeSetId,
    status,
    checks: [
      {
        id: "test",
        label: "tests",
        status,
        durationMs: 12,
        command: {
          executable: "pnpm",
          args: ["test"],
          cwd: "/tmp/auto-fix-workspace",
          timeoutMs: 1000,
        },
        reason: status === "passed" ? undefined : "assertion failed",
        output: status === "passed" ? "ok" : "password=secret /tmp/auto-fix-workspace/file.ts",
      },
    ],
    durationMs: 20,
    summary: status === "passed" ? "all checks passed" : "one check failed",
    ...(status === "blocked" ? { reason: "postimage conflict" } : {}),
  };
}

test("parseAutoFixCommand accepts bounded attempts and slash aliases", () => {
  assert.deepEqual(parseAutoFixCommand(":autofix"), { handled: true, attempts: 2 });
  assert.deepEqual(parseAutoFixCommand("/autofix 1"), { handled: true, attempts: 1 });
  assert.deepEqual(parseAutoFixCommand(":autofix 3"), { handled: true, attempts: 3 });
  assert.deepEqual(parseAutoFixCommand(":autofixer"), { handled: false });
  assert.deepEqual(parseAutoFixCommand(":autofix 0"), {
    handled: true,
    error: "Usage: :autofix [1-3]",
  });
  assert.deepEqual(parseAutoFixCommand(":autofix 4"), {
    handled: true,
    error: "Usage: :autofix [1-3]",
  });
  assert.deepEqual(parseAutoFixCommand(":autofix 1 extra"), {
    handled: true,
    error: "Usage: :autofix [1-3]",
  });
});

test("validation evidence is bounded and redacted before entering the repair prompt", () => {
  const failed = validation("failed", "validation:1");
  const summary = summarizeValidationFailure(failed);
  assert.match(summary, /assertion failed/);
  assert.doesNotMatch(summary, /secret/);
  assert.doesNotMatch(summary, /auto-fix-workspace/);

  const target = selectLatestAutoFixTarget([failed]);
  assert.ok(target);
  const prompt = buildAutoFixPrompt(target, 1, 2);
  assert.match(prompt, /automatic repair attempt 1 of 2/);
  assert.match(prompt, /untrusted diagnostic data/);
  assert.match(prompt, /<validation-failure>/);
  assert.doesNotMatch(prompt, /secret/);
});

test("runAutoFixLoop stops after a new passed validation", async () => {
  const failed = validation("failed", "validation:failed");
  const validations: ValidationResult[] = [failed];
  const prompts: string[] = [];
  const result = await runAutoFixLoop({
    context: context(),
    validations,
    maxAttempts: 3,
    runRepair: async (prompt) => {
      prompts.push(prompt);
      validations.push(validation("passed", "validation:fixed", "change-set-fixed"));
      return { context: context("after-repair") };
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.attempts, 1);
  assert.equal(prompts.length, 1);
  assert.equal(result.validation.validationId, "validation:fixed");
});

test("runAutoFixLoop reruns the trusted change set when repair created no validation", async () => {
  const failed = validation("failed", "validation:failed");
  const validations: ValidationResult[] = [failed];
  const rerunIds: string[] = [];
  const seenStatuses: string[] = [];
  let reruns = 0;
  const result = await runAutoFixLoop({
    context: context(),
    validations,
    maxAttempts: 2,
    runRepair: async () => ({ context: context("after-repair") }),
    rerunValidation: async (changeSetId) => {
      rerunIds.push(changeSetId);
      reruns += 1;
      return reruns === 1
        ? validation("failed", "validation:rerun-failed", changeSetId)
        : validation("passed", "validation:rerun-passed", changeSetId);
    },
    onValidation: (next) => {
      seenStatuses.push(next.status);
      validations.push(next);
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.attempts, 2);
  assert.deepEqual(rerunIds, ["change-set-1", "change-set-1"]);
  assert.deepEqual(seenStatuses, ["failed", "passed"]);
});

test("a later passed validation suppresses an older repair target", () => {
  const failed = validation("failed", "validation:failed");
  const passed = validation("passed", "validation:passed");
  assert.equal(selectLatestAutoFixTarget([], [
    { ...failed, recordedAt: "2026-09-25T00:00:00.000Z" },
    { ...passed, recordedAt: "2026-09-25T00:00:01.000Z" },
  ]), undefined);
});

test("runAutoFixLoop reports no target without invoking the agent", async () => {
  let invoked = false;
  const result = await runAutoFixLoop({
    context: context(),
    validations: [validation("passed", "validation:passed")],
    maxAttempts: 2,
    runRepair: async () => {
      invoked = true;
      return { context: context("unexpected") };
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.attempts, 0);
  assert.equal(invoked, false);
});
