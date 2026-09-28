import assert from "node:assert/strict";
import test from "node:test";

import { AgentToolRegistry } from "@dev-agent/agent-core";
import { resolveSpecialistRoles } from "../dist/specialist-roles.js";

function register(registry: AgentToolRegistry, name: string): void {
  registry.register({
    name,
    description: `${name} test tool`,
    async execute() { return name; },
  });
}

test("resolves named role model, task budget, and the intersection of role and user tool ceilings", () => {
  const tools = new AgentToolRegistry();
  register(tools, "filesystem");
  register(tools, "search");
  register(tools, "shell");
  const modelSelections: Array<{ provider?: string; model?: string }> = [];

  const [role] = resolveSpecialistRoles({
    configured: [{
      id: "code-reviewer",
      instructions: "Review implementation risks.",
      provider: "openai",
      model: "gpt-4.1-mini",
      toolAllowlist: ["filesystem", "shell"],
      budget: { maxTurns: 2, maxTokens: 8000 },
    }],
    tools,
    toolCeiling: ["filesystem", "search"],
    createModel: (selection) => {
      modelSelections.push(selection);
      return {
        id: "openai",
        model: selection.model ?? "default",
        async chat() { return { content: "", toolCalls: [] }; },
      };
    },
  });

  assert.equal(role?.id, "code-reviewer");
  assert.deepEqual(modelSelections, [{ provider: "openai", model: "gpt-4.1-mini" }]);
  assert.deepEqual(role?.tools?.list().map((tool) => tool.name), ["filesystem"]);
  assert.deepEqual(role?.budget, { maxTurns: 2, maxTokens: 8000 });
  assert.equal(role?.tools?.get("shell"), undefined);
});

test("uses the caller ceiling for defaults and rejects unavailable caller-authorized names", () => {
  const tools = new AgentToolRegistry();
  register(tools, "filesystem");
  register(tools, "search");

  const roles = resolveSpecialistRoles({
    tools,
    toolCeiling: ["search"],
    createModel: () => { throw new Error("default role should use the caller model"); },
  });
  assert.equal(roles.length, 3);
  assert.ok(roles.every((role) => role.tools?.list().map((tool) => tool.name).join() === "search"));
  assert.throws(() => resolveSpecialistRoles({
    tools,
    toolCeiling: ["missing"],
    createModel: () => { throw new Error("unreachable"); },
  }), /unavailable tool/);
});

test("augments built-in roles with discovered definitions and lets explicit JSON roles shadow ids", () => {
  const tools = new AgentToolRegistry();
  register(tools, "search");
  const model = {
    id: "ollama" as const,
    model: "test",
    async chat() { return { content: "", toolCalls: [] }; },
  } satisfies import("@dev-agent/model").ModelProvider;

  const discovered = resolveSpecialistRoles({
    tools,
    discovered: [{
      id: "architect",
      instructions: "Project architecture instructions.",
      toolAllowlist: ["search"],
    }, {
      id: "security",
      instructions: "Review security boundaries.",
      toolAllowlist: ["search"],
    }],
    createModel: () => model,
  });

  assert.equal(discovered.find((role) => role.id === "architect")?.instructions, "Project architecture instructions.");
  assert.equal(discovered.find((role) => role.id === "security")?.instructions, "Review security boundaries.");
  assert.ok(discovered.some((role) => role.id === "tester"));

  const configured = resolveSpecialistRoles({
    tools,
    configured: [{ id: "security", instructions: "JSON security instructions." }],
    discovered: [{ id: "security", instructions: "Markdown security instructions." }],
    createModel: () => model,
  });
  assert.equal(configured.find((role) => role.id === "security")?.instructions, "JSON security instructions.");
});

test("an explicit empty discovered tool list grants no collaboration tools", () => {
  const tools = new AgentToolRegistry();
  register(tools, "filesystem");
  const roles = resolveSpecialistRoles({
    tools,
    toolCeiling: ["filesystem"],
    discovered: [{ id: "planner", instructions: "Plan only.", toolAllowlist: [] }],
    createModel: () => { throw new Error("planner should use the caller model"); },
  });
  assert.deepEqual(roles.find((role) => role.id === "planner")?.tools?.list(), []);
});


test("explicit JSON roles still reject unavailable tools", () => {
  const tools = new AgentToolRegistry();
  register(tools, "filesystem");
  assert.throws(() => resolveSpecialistRoles({
    tools,
    configured: [{ id: "strict", instructions: "Review.", toolAllowlist: ["missing-tool"] }],
    createModel: () => { throw new Error("unreachable"); },
  }), /unavailable tool/);
});


test("project roles cannot silently switch the provider used by the caller", () => {
  const tools = new AgentToolRegistry();
  register(tools, "search");
  const modelSelections: Array<{ provider?: string; model?: string }> = [];

  const roles = resolveSpecialistRoles({
    currentProvider: "ollama",
    discovered: [{
      id: "cloud-reviewer",
      instructions: "Review with the project policy.",
      scope: "project",
      provider: "openai",
      model: "gpt-4.1-mini",
      toolAllowlist: ["search"],
    }],
    tools,
    createModel: (selection) => {
      modelSelections.push(selection);
      return {
        id: "ollama",
        model: selection.model ?? "caller-model",
        async chat() { return { content: "", toolCalls: [] }; },
      };
    },
  });

  const role = roles.find((candidate) => candidate.id === "cloud-reviewer");
  assert.equal(role?.model, undefined);
  assert.deepEqual(modelSelections, []);
});

test("project roles keep an explicit model when they use the caller provider", () => {
  const tools = new AgentToolRegistry();
  register(tools, "search");
  const modelSelections: Array<{ provider?: string; model?: string }> = [];

  resolveSpecialistRoles({
    currentProvider: "ollama",
    discovered: [{
      id: "local-reviewer",
      instructions: "Review locally.",
      scope: "project",
      provider: "ollama",
      model: "qwen3-coder",
    }],
    tools,
    createModel: (selection) => {
      modelSelections.push(selection);
      return {
        id: "ollama",
        model: selection.model ?? "caller-model",
        async chat() { return { content: "", toolCalls: [] }; },
      };
    },
  });

  assert.deepEqual(modelSelections, [{ provider: "ollama", model: "qwen3-coder" }]);
});

test("user JSON roles retain their explicit cross-provider model selection", () => {
  const tools = new AgentToolRegistry();
  register(tools, "search");
  const modelSelections: Array<{ provider?: string; model?: string }> = [];

  resolveSpecialistRoles({
    currentProvider: "ollama",
    configured: [{
      id: "trusted-cloud-reviewer",
      instructions: "Use the approved cloud reviewer.",
      provider: "openai",
      model: "gpt-4.1-mini",
    }],
    tools,
    createModel: (selection) => {
      modelSelections.push(selection);
      return {
        id: "openai",
        model: selection.model ?? "default",
        async chat() { return { content: "", toolCalls: [] }; },
      };
    },
  });

  assert.deepEqual(modelSelections, [{ provider: "openai", model: "gpt-4.1-mini" }]);
});
