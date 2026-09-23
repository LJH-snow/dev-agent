import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentToolRegistry,
  InMemoryMemory,
  runCollaborativePlan,
} from "../dist/index.js";

test("collaborative planning runs bounded specialist roles and synthesizes their findings", async () => {
  let active = 0;
  let peak = 0;
  const events: string[] = [];
  const result = await runCollaborativePlan("design a safe cache layer", {
    model: {
      id: "openai",
      model: "test-model",
      async chat(messages) {
        const isSynthesis = messages.some((message) =>
          message.content.includes("COLLABORATION SYNTHESIS"),
        );
        if (isSynthesis) {
          return {
            content: "Combined plan: use the architecture, risks, and tests together.",
            toolCalls: [],
          };
        }
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        const role = messages
          .find((message) => message.role === "system" && message.content.includes("ROLE:"))
          ?.content.match(/ROLE: ([^\n]+)/)?.[1] ?? "unknown";
        return { content: `${role} finding`, toolCalls: [] };
      },
    },
    workingDirectory: "/workspace",
    sessionId: "collaboration-test",
    maxParallel: 2,
    onRoleEvent: (event) => events.push(`${event.roleId}:${event.phase}`),
  });

  assert.equal(result.roles.length, 3);
  assert.ok(peak <= 2);
  assert.match(result.synthesis, /Combined plan/);
  assert.equal(result.roles.every((role) => role.status === "done"), true);
  assert.deepEqual(
    events.filter((event) => event.endsWith(":started")).length,
    3,
  );
  assert.deepEqual(
    events.filter((event) => event.endsWith(":completed")).length,
    3,
  );
});

test("collaborative planning keeps specialist work in plan mode", async () => {
  const tools = new AgentToolRegistry();
  let executions = 0;
  tools.register({
    name: "filesystem",
    description: "mutating test tool",
    metadata: {
      risk: "mutating",
      confirmation: "on-risk",
      resultFormat: "json",
      supportsProgress: false,
    },
    async execute() {
      executions += 1;
      return "should not run";
    },
  });

  const result = await runCollaborativePlan("change a file", {
    model: {
      id: "openai",
      model: "test-model",
      async chat(messages) {
        if (messages.some((message) => message.content.includes("COLLABORATION SYNTHESIS"))) {
          return { content: "synthesized", toolCalls: [] };
        }
        return {
          content: "",
          toolCalls: [{
            id: "write",
            name: "filesystem",
            input: { action: "write", path: "unsafe.txt", content: "x" },
          }],
        };
      },
    },
    tools,
    workingDirectory: "/workspace",
    sessionId: "collaboration-plan",
    maxTurns: 2,
  });

  assert.equal(executions, 0);
  assert.equal(result.roles.length, 3);
});

test("named collaboration roles use their trusted model and enforce task budgets", async () => {
  let baseModelCalls = 0;
  let specialistCalls = 0;
  const baseModel = {
    id: "openai" as const,
    model: "base",
    async chat(messages: readonly { role: string; content: string }[]) {
      baseModelCalls += 1;
      assert.ok(messages.some((message) => message.content.includes("COLLABORATION SYNTHESIS")));
      return { content: "synthesis", toolCalls: [] };
    },
  };
  const specialistModel = {
    id: "openai" as const,
    model: "specialist",
    async chat() {
      specialistCalls += 1;
      return specialistCalls === 1
        ? {
            content: "",
            toolCalls: [{ id: "inspect-1", name: "reader", input: {} }],
          }
        : { content: "source-grounded review", toolCalls: [] };
    },
  };
  const tools = new AgentToolRegistry();
  tools.register({
    name: "reader",
    description: "Read-only test tool",
    async execute() { return "inspected"; },
  });

  const result = await runCollaborativePlan("review this change", {
    model: baseModel,
    tools,
    workingDirectory: "/workspace",
    sessionId: "role-budget-test",
    roles: [{
      id: "code-reviewer",
      instructions: "Review correctness.",
      model: specialistModel,
      budget: { maxTurns: 1, maxTokens: 1000 },
    }],
  });

  assert.equal(result.roles[0]?.status, "error");
  assert.equal(specialistCalls, 1, "the specialist budget must stop a second model turn");
  assert.equal(baseModelCalls, 1);
});
