import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentToolRegistry,
  InMemoryMemory,
  createAgentContext,
  createValidationAttemptId,
  runValidationAttempt,
  type ApprovalPolicy,
  type ValidationAdapter,
  type ValidationPlan,
  type ValidationResult,
} from "../dist/index.js";

const review = {
  changeSetId: "cs-lifecycle",
  files: [
    {
      path: "/workspace/example.txt",
      kind: "file" as const,
      beforeHash: "b".repeat(64),
      afterHash: "a".repeat(64),
      diff: "--- a/example.txt\n+++ b/example.txt\n-old\n+new\n",
      additions: 1,
      deletions: 1,
      beforeExists: true,
      afterExists: true,
    },
  ],
  additions: 1,
  deletions: 1,
  createdAt: "2026-09-13T00:00:00.000Z",
};

const plan: ValidationPlan = {
  validationId: "validation:cs-lifecycle",
  changeSetId: review.changeSetId,
  status: "ready",
  checks: [
    {
      id: "package:tools:test",
      label: "Test tools",
      command: {
        executable: "pnpm",
        args: ["--filter", "@dev-agent/tools", "test"],
        cwd: "/workspace",
        timeoutMs: 1000,
      },
    },
  ],
  summary: "1 validation check planned",
};

function result(status: ValidationResult["status"]): ValidationResult {
  return {
    validationId: plan.validationId,
    changeSetId: plan.changeSetId,
    status,
    checks: plan.checks.map((check) => ({
      ...check,
      status,
      durationMs: 4,
      exitCode: status === "passed" ? 0 : 1,
      ...(status === "failed" ? { reason: "test failed" } : {}),
    })),
    durationMs: 4,
    summary: `validation ${status}`,
  };
}

function scenario({
  decision = "allow",
  toolResult = { ok: true, changeSetId: review.changeSetId },
  validation,
  events = [],
  validationResults = [],
  memory = new InMemoryMemory(),
  approval,
}: {
  decision?: "allow" | "deny";
  toolResult?: unknown;
  validation?: ValidationAdapter;
  events?: string[];
  validationResults?: ValidationResult[];
  memory?: InMemoryMemory;
  approval?: ApprovalPolicy;
} = {}) {
  const inputs: unknown[] = [];
  const tools = new AgentToolRegistry();
  tools.register({
    name: "filesystem",
    description: "A test filesystem tool.",
    async execute(input) {
      inputs.push(input);
      return toolResult;
    },
  });

  let modelCalls = 0;
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      modelCalls += 1;
      return modelCalls === 1
        ? {
            content: "",
            toolCalls: [
              {
                id: "call-1",
                name: "filesystem",
                input: { action: "write", path: "example.txt", content: "new" },
              },
            ],
          }
        : { content: "done", toolCalls: [] };
    },
  };

  const context = createAgentContext("validation-session", memory, {
    workingDirectory: "/workspace",
  });
  const policy: ApprovalPolicy = approval ?? {
    async prepare() {
      return {
        review,
        executeInput: { action: "apply", changeSetId: review.changeSetId },
      };
    },
    decide() {
      return { decision };
    },
  };
  const loop = new AgentLoop({
    model,
    tools,
    approval: policy,
    validation,
    onToolResult: () => events.push("tool-result"),
    onValidation: (receivedResult) => {
      events.push("validation");
      validationResults.push(receivedResult);
    },
  });

  return { context, events, inputs, loop, memory, validationResults };
}

test("approved change-set apply runs validation after the tool result and exposes it to memory", async () => {
  const calls: string[] = [];
  const validation: ValidationAdapter = {
    prepare(receivedReview, context) {
      calls.push(`prepare:${receivedReview.changeSetId}:${context.workingDirectory}`);
      return plan;
    },
    async run(receivedPlan) {
      calls.push(`run:${receivedPlan.validationId}`);
      return result("passed");
    },
  };
  const scenarioState = scenario({ validation, events: [] });

  const context = await scenarioState.loop.run(scenarioState.context, "write and verify");

  assert.equal(context.state.status, "done");
  assert.deepEqual(scenarioState.inputs, [
    { action: "apply", changeSetId: review.changeSetId },
  ]);
  assert.deepEqual(calls, ["prepare:cs-lifecycle:/workspace", "run:validation:cs-lifecycle"]);
  assert.deepEqual(scenarioState.events, ["tool-result", "validation"]);
  const entries = await scenarioState.memory.entries();
  assert.match(entries.find((entry) => entry.role === "tool")?.content ?? "", /validation passed/);
  const records = await scenarioState.memory.validations();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.validationId, result("passed").validationId);
  assert.equal(records[0]?.changeSetId, review.changeSetId);
  assert.equal(records[0]?.status, "passed");
  assert.equal(records[0]?.recordedAt.length > 0, true);
  const changeSets = await scenarioState.memory.changeSets();
  assert.equal(changeSets.length, 1);
  assert.equal(changeSets[0]?.changeSetId, review.changeSetId);
  assert.equal(changeSets[0]?.sessionId, "validation-session");
  assert.equal(changeSets[0]?.workingDirectory, "/workspace");
  assert.equal(changeSets[0]?.files[0]?.path, "example.txt");
  assert.equal(Object.hasOwn(changeSets[0]?.files[0] ?? {}, "diff"), false);
});

test("ordinary successful writes without review do not record change-set evidence", async () => {
  const ordinary = scenario({
    approval: {
      decide() {
        return { decision: "allow" };
      },
    },
  });

  const context = await ordinary.loop.run(ordinary.context, "write without review");

  assert.equal(context.state.status, "done");
  assert.deepEqual(ordinary.inputs, [
    { action: "write", path: "example.txt", content: "new" },
  ]);
  assert.deepEqual(await ordinary.memory.changeSets(), []);
});

test("denied or unsuccessful applies do not run validation or record change-set evidence", async () => {
  const deniedCalls: string[] = [];
  const validation: ValidationAdapter = {
    prepare() {
      deniedCalls.push("prepare");
      return plan;
    },
    async run() {
      deniedCalls.push("run");
      return result("passed");
    },
  };
  const denied = scenario({ decision: "deny", validation });
  await denied.loop.run(denied.context, "do not write");
  assert.deepEqual(denied.inputs, []);
  assert.deepEqual(deniedCalls, []);
  assert.deepEqual(await denied.memory.changeSets(), []);

  const failedApply = scenario({
    validation,
    toolResult: { error: "preimage conflict" },
  });
  await failedApply.loop.run(failedApply.context, "stale write");
  assert.deepEqual(failedApply.inputs, [
    { action: "apply", changeSetId: review.changeSetId },
  ]);
  assert.deepEqual(deniedCalls, []);
  assert.deepEqual(await failedApply.memory.changeSets(), []);
});

test("evidence persistence failure does not turn a successful apply into an error", async () => {
  const memory = new InMemoryMemory();
  (memory as any).recordChangeSet = async () => {
    throw new Error("disk full");
  };
  const scenarioState = scenario({ memory });

  const context = await scenarioState.loop.run(scenarioState.context, "write without evidence");

  assert.equal(context.state.status, "done");
  assert.deepEqual(scenarioState.inputs, [
    { action: "apply", changeSetId: review.changeSetId },
  ]);
});

test("validation failure is reported without turning a successful apply into a loop error", async () => {
  const events: string[] = [];
  const validation: ValidationAdapter = {
    prepare: () => plan,
    run: async () => result("failed"),
  };
  const scenarioState = scenario({ validation, events });

  const context = await scenarioState.loop.run(scenarioState.context, "write and test");

  assert.equal(context.state.status, "done");
  assert.deepEqual(events, ["tool-result", "validation"]);
  const entries = await scenarioState.memory.entries();
  assert.ok(entries.some((entry) => entry.role === "tool" && /validation failed/.test(entry.content)));
});

test("validation planning errors become blocked validation results and do not undo the apply", async () => {
  const validation: ValidationAdapter = {
    prepare: () => {
      throw new Error("repository layout is unknown");
    },
    run: async () => result("passed"),
  };
  const scenarioState = scenario({ validation });

  const context = await scenarioState.loop.run(scenarioState.context, "write without a plan");

  assert.equal(context.state.status, "done");
  const entries = await scenarioState.memory.entries();
  assert.ok(entries.some((entry) => entry.role === "tool" && /blocked/.test(entry.content)));
});

test("a blocked validation result is observable before an abort ends the loop", async () => {
  const controller = new AbortController();
  const validationResults: ValidationResult[] = [];
  const validation: ValidationAdapter = {
    prepare: () => plan,
    run: async (_receivedPlan, options) => {
      assert.strictEqual(options?.signal, controller.signal);
      controller.abort();
      return result("blocked");
    },
  };
  const scenarioState = scenario({ validation, validationResults });

  await assert.rejects(
    () => scenarioState.loop.run(scenarioState.context, "write then stop", { signal: controller.signal }),
    /aborted|abort/i
  );
  assert.deepEqual(scenarioState.events, ["tool-result", "validation"]);
  assert.equal(validationResults[0]?.status, "blocked");
});

test("validation receives the outer abort signal", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const validation: ValidationAdapter = {
    prepare: () => plan,
    run: async (_receivedPlan, options) => {
      receivedSignal = options?.signal;
      return result("blocked");
    },
  };
  const scenarioState = scenario({ validation });

  await scenarioState.loop.run(scenarioState.context, "write then stop", {
    signal: controller.signal,
  });
  assert.strictEqual(receivedSignal, controller.signal);
});


test("an explicit validation attempt gets a fresh id while staying linked to the change set", async () => {
  const context = createAgentContext("rerun", new InMemoryMemory(), {
    sessionId: "rerun",
    workingDirectory: "/workspace",
  });
  const attemptId = createValidationAttemptId(review.changeSetId);
  let receivedId: string | undefined;
  const validation: ValidationAdapter = {
    prepare(receivedReview, _context, options) {
      assert.equal(receivedReview.changeSetId, review.changeSetId);
      receivedId = options?.validationId;
      return { ...plan, validationId: options?.validationId ?? plan.validationId };
    },
    async run(receivedPlan) {
      return { ...result("passed"), validationId: receivedPlan.validationId };
    },
  };

  const rerun = await runValidationAttempt(validation, review, context, {
    validationId: attemptId,
  });

  assert.equal(receivedId, attemptId);
  assert.equal(rerun.validationId, attemptId);
  assert.equal(rerun.changeSetId, review.changeSetId);
  assert.notEqual(rerun.validationId, plan.validationId);
});

test("a validation attempt becomes blocked when a runner loses the change-set identity", async () => {
  const context = createAgentContext("rerun-identity", new InMemoryMemory(), {
    sessionId: "rerun-identity",
    workingDirectory: "/workspace",
  });
  const attemptId = createValidationAttemptId(review.changeSetId);
  const validation: ValidationAdapter = {
    prepare: (_review, _context, options) => ({
      ...plan,
      validationId: options?.validationId ?? plan.validationId,
    }),
    async run(receivedPlan) {
      return {
        ...result("passed"),
        validationId: receivedPlan.validationId,
        changeSetId: "different-change-set",
      };
    },
  };

  const rerun = await runValidationAttempt(validation, review, context, {
    validationId: attemptId,
  });

  assert.equal(rerun.status, "blocked");
  assert.equal(rerun.validationId, attemptId);
  assert.equal(rerun.changeSetId, review.changeSetId);
  assert.match(rerun.reason ?? "", /change-set identity/i);
});
