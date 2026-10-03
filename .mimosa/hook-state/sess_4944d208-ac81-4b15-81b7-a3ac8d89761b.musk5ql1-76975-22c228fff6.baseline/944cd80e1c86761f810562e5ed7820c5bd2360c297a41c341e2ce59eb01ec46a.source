import assert from "node:assert/strict";
import test from "node:test";

import {
  executeSkillCommand,
  formatSkillCommandResult,
  renderActiveSkillPrompt,
  type ActiveSkillState,
  type SkillCommandResult,
} from "../dist/skill-command.js";
import type { SkillDefinition, SkillRegistry } from "@dev-agent/agent-core";

const reviewSkill: SkillDefinition = {
  name: "review",
  description: "Review changed files",
  instructions: "Inspect changed files and cite exact path and line evidence.",
  scope: "project",
  path: "/tmp/project/.dev-agent/skills/review/SKILL.md",
};

const registry = {
  list: () => [reviewSkill],
  get: (name: string) => (name === reviewSkill.name ? reviewSkill : undefined),
  activate: (name: string) => {
    if (name !== reviewSkill.name) {
      throw new Error(`unknown skill: ${name}`);
    }
    return reviewSkill.instructions;
  },
} as unknown as SkillRegistry;

function expectHandled(result: SkillCommandResult): Extract<SkillCommandResult, { handled: true }> {
  assert.equal(result.handled, true);
  if (!result.handled) {
    throw new Error("expected a handled skill command");
  }
  return result;
}

test("skill command lists available metadata without exposing paths", () => {
  const state: ActiveSkillState = {};
  const result = expectHandled(executeSkillCommand(":skills", registry, state));

  assert.equal(result.handled, true);
  assert.match(formatSkillCommandResult(result), /review/);
  assert.match(formatSkillCommandResult(result), /Review changed files/);
  assert.doesNotMatch(formatSkillCommandResult(result), /SKILL\.md|\/tmp\/project/);
});

test("skill command activates, wraps, and deactivates one explicit skill", () => {
  const state: ActiveSkillState = {};
  const activated = expectHandled(executeSkillCommand(":skill review", registry, state));

  assert.equal(activated.kind, "activated");
  assert.equal(state.active?.name, "review");
  assert.match(renderActiveSkillPrompt(state) ?? "", /Active skill: review/);
  assert.match(renderActiveSkillPrompt(state) ?? "", /exact path and line evidence/);
  assert.match(
    renderActiveSkillPrompt(state) ?? "",
    /explicitly activated project or user skill/
  );

  const deactivated = expectHandled(executeSkillCommand(":skill off", registry, state));
  assert.equal(deactivated.kind, "deactivated");
  assert.equal(state.active, undefined);
  assert.equal(renderActiveSkillPrompt(state), undefined);
});

test("skill command reports usage and unknown names without changing state", () => {
  const state: ActiveSkillState = {};

  assert.equal(expectHandled(executeSkillCommand(":skill", registry, state)).kind, "usage");
  const unknown = expectHandled(executeSkillCommand(":skill missing", registry, state));
  assert.equal(unknown.kind, "unknown");
  assert.equal(state.active, undefined);
});
