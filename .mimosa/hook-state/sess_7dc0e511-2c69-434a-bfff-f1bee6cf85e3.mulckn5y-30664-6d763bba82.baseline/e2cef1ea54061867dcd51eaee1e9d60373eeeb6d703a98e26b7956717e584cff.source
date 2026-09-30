import assert from "node:assert/strict";
import test from "node:test";

import { AgentDefinitionRegistry } from "@dev-agent/agent-core";
import {
  executeAgentCommand,
  formatAgentCommandResult,
} from "../dist/agent-command.js";

function registry(): AgentDefinitionRegistry {
  return {
    list: () => [{
      id: "reviewer",
      description: "Review implementation",
      instructions: "Do not show this body.",
      scope: "project",
      path: "/private/project/.dev-agent/agents/reviewer/AGENT.md",
      provider: "openai",
      model: "gpt-4.1-mini",
      toolAllowlist: ["search", "filesystem"],
      budget: { maxTurns: 2, maxTokens: 8000 },
    }],
    get: (id: string) => id === "reviewer" ? {
      id: "reviewer",
      description: "Review implementation",
      instructions: "Do not show this body.",
      scope: "project",
      path: "/private/project/.dev-agent/agents/reviewer/AGENT.md",
      provider: "openai",
      model: "gpt-4.1-mini",
      toolAllowlist: ["search", "filesystem"],
      budget: { maxTurns: 2, maxTokens: 8000 },
    } : undefined,
  } as unknown as AgentDefinitionRegistry;
}

test("agent command lists safe metadata and does not expose path or instructions", () => {
  const result = executeAgentCommand(":agents", registry());
  assert.equal(result.handled, true);
  if (!result.handled) throw new Error("agent list command was not handled");
  assert.equal(result.kind, "list");
  const output = formatAgentCommandResult(result);
  assert.match(output, /reviewer/);
  assert.match(output, /project/);
  assert.doesNotMatch(output, /private\/project/);
  assert.doesNotMatch(output, /Do not show this body/);
});

test("agent command inspects one definition and accepts slash aliases", () => {
  const result = executeAgentCommand("/agent reviewer", registry());
  assert.equal(result.handled, true);
  if (!result.handled) throw new Error("agent inspect command was not handled");
  assert.equal(result.kind, "inspect");
  const output = formatAgentCommandResult(result);
  assert.match(output, /Provider: openai/);
  assert.match(output, /Model: gpt-4\.1-mini/);
  assert.match(output, /Tools: 2/);
  assert.match(output, /maxTurns=2/);
  assert.doesNotMatch(output, /private\/project/);
  assert.doesNotMatch(output, /Do not show this body/);
});

test("agent command reports usage, unknown ids, and leaves ordinary prompts alone", () => {
  const usage = executeAgentCommand(":agent", registry());
  assert.equal(usage.handled, true);
  if (!usage.handled) throw new Error("agent usage command was not handled");
  assert.equal(usage.kind, "usage");
  const unknown = executeAgentCommand(":agent missing", registry());
  assert.equal(unknown.handled, true);
  if (!unknown.handled) throw new Error("agent unknown command was not handled");
  assert.equal(unknown.kind, "unknown");
  assert.match(formatAgentCommandResult(unknown), /missing/);
  assert.equal(executeAgentCommand("Please review this", registry()).handled, false);
});

test("agent command distinguishes an explicit no-tools role from an inherited tool ceiling", () => {
  const noTools = {
    id: "planner",
    description: "Plan without tools",
    instructions: "Private instructions",
    scope: "project" as const,
    path: "/private/project/.dev-agent/agents/planner/AGENT.md",
    toolAllowlist: [],
  };
  const emptyRegistry = {
    list: () => [noTools],
    get: () => noTools,
  } as unknown as AgentDefinitionRegistry;
  assert.match(formatAgentCommandResult(executeAgentCommand(":agents", emptyRegistry)), /tools none/);
  assert.match(formatAgentCommandResult(executeAgentCommand(":agent planner", emptyRegistry)), /Tools: none/);
});


test("agent inspection explains when a project provider and model are not applied", () => {
  const output = formatAgentCommandResult(executeAgentCommand(
    ":agent reviewer",
    registry(),
    { currentProvider: "ollama", currentModel: "qwen3-coder" },
  ));
  assert.match(output, /not applied/);
  assert.match(output, /session uses ollama/);
  assert.match(output, /inherited from session/);
});
