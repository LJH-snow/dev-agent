import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentToolRegistry,
  InMemoryMemory,
  createAgentContext,
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
      beforeHash: "before",
      afterHash: "after",
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
}: {
  decision?: "allow" | "deny";
  toolResult?: unknown;
  validation?: ValidationAdapter;
  events?: string[];
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

  const memory = new InMemoryMemory();
  const context = createAgentContext("validation-session", memory, {
    workingDirectory: "/workspace",
  });
  const policy: ApprovalPolicy = {
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
    onValidation: () => events.push("validation"),
  });

  return { context, events, inputs, loop, memory };
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
});

test("denied or unsuccessful applies do not run validation", async () => {
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

  const failedApply = scenario({
    validation,
    toolResult: { error: "preimage conflict" },
  });
  await failedApply.loop.run(failedApply.context, "stale write");
  assert.deepEqual(failedApply.inputs, [
    { action: "apply", changeSetId: review.changeSetId },
  ]);
  assert.deepEqual(deniedCalls, []);
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
