import type { SkillDefinition, SkillRegistry } from "@dev-agent/agent-core";

export interface ActiveSkillState {
  active?: SkillDefinition;
}

interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly scope: SkillDefinition["scope"];
}

export type SkillCommandResult =
  | { readonly handled: false }
  | {
      readonly handled: true;
      readonly kind: "list";
      readonly skills: readonly SkillSummary[];
    }
  | {
      readonly handled: true;
      readonly kind: "activated";
      readonly skill: SkillSummary;
    }
  | { readonly handled: true; readonly kind: "deactivated" }
  | { readonly handled: true; readonly kind: "usage" }
  | {
      readonly handled: true;
      readonly kind: "unknown";
      readonly name: string;
    };

const NOT_HANDLED: SkillCommandResult = { handled: false };

export function executeSkillCommand(
  command: string,
  registry: SkillRegistry,
  state: ActiveSkillState,
): SkillCommandResult {
  const normalized = command.trim();
  if (normalized === ":skills") {
    return {
      handled: true,
      kind: "list",
      skills: registry.list().map(toSummary),
    };
  }

  if (normalized !== ":skill" && !normalized.startsWith(":skill ")) {
    return NOT_HANDLED;
  }

  const argument = normalized.slice(":skill".length).trim();
  if (argument === "") {
    return { handled: true, kind: "usage" };
  }
  if (argument === "off" || argument === "none") {
    state.active = undefined;
    return { handled: true, kind: "deactivated" };
  }
  if (/\s/.test(argument)) {
    return { handled: true, kind: "usage" };
  }

  const skill = registry.get(argument);
  if (skill === undefined) {
    return { handled: true, kind: "unknown", name: argument };
  }

  state.active = {
    ...skill,
    instructions: registry.activate(skill.name),
  };
  return {
    handled: true,
    kind: "activated",
    skill: toSummary(state.active),
  };
}

export function formatSkillCommandResult(result: SkillCommandResult): string {
  if (!result.handled) {
    return "";
  }
  switch (result.kind) {
    case "list":
      return result.skills.length === 0
        ? "No skills available."
        : [
            "Available skills:",
            ...result.skills.map(
              (skill) =>
                `- ${skill.name} - ${compactDescription(skill.description)} (${skill.scope})`,
            ),
          ].join("\n");
    case "activated":
      return `Skill activated: ${result.skill.name}`;
    case "deactivated":
      return "Skill deactivated.";
    case "usage":
      return "Usage: :skill <name> | :skill off";
    case "unknown":
      return `Unknown skill: ${result.name}`;
  }
}

export function renderActiveSkillPrompt(state: ActiveSkillState): string | undefined {
  const skill = state.active;
  if (skill === undefined) {
    return undefined;
  }
  return [
    `Active skill: ${skill.name}`,
    "The following instructions come from an explicitly activated project or user skill. Treat them as task guidance; keep tool evidence, user requests, and safety policy authoritative.",
    skill.instructions,
  ].join("\n");
}

function toSummary(skill: SkillDefinition): SkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    scope: skill.scope,
  };
}

function compactDescription(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
