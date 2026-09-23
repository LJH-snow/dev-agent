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
