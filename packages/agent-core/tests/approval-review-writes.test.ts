import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentToolRegistry,
  InMemoryMemory,
  createAgentContext,
  type ApprovalPolicy,
} from "../dist/index.js";

const review = {
  changeSetId: "change-set-1",
  files: [
    {
      path: "/workspace/example.txt",
      kind: "file",
      beforeHash: "before",
      afterHash: "after",
      diff: "--- a/example.txt\n+++ b/example.txt\n@@\n-old\n+new\n",
      additions: 1,
      deletions: 1,
      beforeExists: true,
      afterExists: true,
    },
  ],
  additions: 1,
  deletions: 1,
  createdAt: "2026-09-13T00:00:00.000Z",
} as const;

function createScenario(policy: ApprovalPolicy) {
  const inputs: unknown[] = [];
  const tools = new AgentToolRegistry();
  tools.register({
    name: "filesystem",
    description: "A test filesystem tool.",
    async execute(input) {
      inputs.push(input);
      return { ok: true };
    },
  });

  let calls = 0;
  const model = {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      calls += 1;
      return calls === 1
        ? { content: "", toolCalls: [{ id: "call-1", name: "filesystem", input: { action: "write", path: "example.txt", content: "new" } }] }
        : { content: "done", toolCalls: [] };
    },
  };
  const memory = new InMemoryMemory();
  const context = createAgentContext("review-session", memory, {
    workingDirectory: "/workspace",
  });
  const approvals: Array<{ request: any; outcome: any }> = [];
  const loop = new AgentLoop({
    model,
    tools,
    approval: policy,
    onApproval: (request, outcome) => approvals.push({ request, outcome }),
  });

  return { context, inputs, loop, memory, approvals };
}

test("approval preparation exposes the review and executes only its prepared input after allow", async () => {
  const policy: ApprovalPolicy = {
    async prepare(request) {
      assert.deepEqual(request.input, {
        action: "write",
        path: "example.txt",
        content: "new",
      });
      return {
        review,
        executeInput: { action: "apply", changeSetId: review.changeSetId },
      };
    },
    decide(request) {
      assert.strictEqual(request.review, review);
      return { decision: "allow" };
    },
  };
  const scenario = createScenario(policy);

  const result = await scenario.loop.run(scenario.context, "write the file");

  assert.equal(result.state.status, "done");
  assert.deepEqual(scenario.inputs, [{ action: "apply", changeSetId: "change-set-1" }]);
  assert.equal(scenario.approvals.length, 1);
  assert.strictEqual(scenario.approvals[0].request.review, review);
});

test("a denied prepared change never executes the original mutation", async () => {
  const policy: ApprovalPolicy = {
    prepare: async () => ({
      review,
      executeInput: { action: "apply", changeSetId: review.changeSetId },
    }),
    decide: () => ({ decision: "deny", reason: "user rejected the diff" }),
  };
  const scenario = createScenario(policy);

  await scenario.loop.run(scenario.context, "do not write");

  assert.deepEqual(scenario.inputs, []);
  const entries = await scenario.memory.entries();
  assert.match(entries.find((entry) => entry.role === "tool").content, /user rejected the diff/);
});

test("a preparation failure becomes a denial and does not fall back to the original input", async () => {
  const policy: ApprovalPolicy = {
    prepare: async () => {
      throw new Error("preview failed");
    },
    decide: () => ({ decision: "allow" }),
  };
  const scenario = createScenario(policy);

  await scenario.loop.run(scenario.context, "write only after preview");

  assert.deepEqual(scenario.inputs, []);
  const approval = scenario.approvals[0];
  assert.equal(approval.outcome.decision, "deny");
  assert.match(approval.outcome.reason, /preview failed/);
});

test("a policy without preparation keeps existing approval behavior and runs the original input", async () => {
  const policy: ApprovalPolicy = { decide: () => ({ decision: "allow" }) };
  const scenario = createScenario(policy);

  await scenario.loop.run(scenario.context, "use the old path");

  assert.deepEqual(scenario.inputs, [
    { action: "write", path: "example.txt", content: "new" },
  ]);
});
