import type { AgentDefinition, AgentDefinitionRegistry } from "@dev-agent/agent-core";

interface AgentSummary {
  readonly id: string;
  readonly description: string;
  readonly scope: AgentDefinition["scope"];
  readonly provider?: string;
  readonly model?: string;
  readonly toolCount?: number;
  readonly budget: AgentDefinition["budget"];
  readonly modelSelectionNote?: string;
}

export type AgentCommandResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly kind: "list"; readonly agents: readonly AgentSummary[] }
  | { readonly handled: true; readonly kind: "inspect"; readonly agent: AgentSummary }
  | { readonly handled: true; readonly kind: "usage" }
  | { readonly handled: true; readonly kind: "unknown"; readonly id: string };

const NOT_HANDLED: AgentCommandResult = { handled: false };

export function isAgentCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  return normalized === ":agents" || normalized === ":agent" || normalized.startsWith(":agent ");
}

export interface AgentCommandOptions {
  readonly currentProvider?: string;
  readonly currentModel?: string;
}

export function executeAgentCommand(
  command: string,
  registry: Pick<AgentDefinitionRegistry, "list" | "get">,
  options: AgentCommandOptions = {},
): AgentCommandResult {
  const normalized = normalizeCommand(command);
  if (normalized === ":agents") {
    return {
      handled: true,
      kind: "list",
      agents: registry.list().map((agent) => toSummary(agent, options)),
    };
  }
  if (normalized === ":agent") {
    return { handled: true, kind: "usage" };
  }
  if (!normalized.startsWith(":agent ")) return NOT_HANDLED;

  const id = normalized.slice(":agent ".length).trim();
  if (id === "" || /\s/u.test(id)) return { handled: true, kind: "usage" };
  const agent = registry.get(id);
  return agent === undefined
    ? { handled: true, kind: "unknown", id }
    : { handled: true, kind: "inspect", agent: toSummary(agent, options) };
}

export function formatAgentCommandResult(result: AgentCommandResult): string {
  if (!result.handled) return "";
  switch (result.kind) {
    case "list":
      return result.agents.length === 0
        ? "No agents available."
        : ["Available agents:", ...result.agents.map(formatListRow)].join("\n");
    case "inspect":
      return [
        `Agent: ${safeText(result.agent.id)}`,
        `Description: ${safeText(result.agent.description)}`,
        `Scope: ${result.agent.scope}`,
        `Provider: ${result.agent.provider === undefined ? "default" : safeText(result.agent.provider)}`,
        `Model: ${result.agent.model === undefined ? "default" : safeText(result.agent.model)}`,
        ...(result.agent.modelSelectionNote === undefined ? [] : [
          `Model policy: ${safeText(result.agent.modelSelectionNote)}`,
        ]),
        `Tools: ${result.agent.toolCount === undefined ? "all available" : result.agent.toolCount === 0 ? "none" : result.agent.toolCount}`,
        `Budget: ${formatBudget(result.agent.budget)}`,
      ].join("\n");
    case "usage":
      return "Usage: :agents | :agent <id>";
    case "unknown":
      return `Unknown agent: ${safeText(result.id)}`;
  }
}

function toSummary(agent: AgentDefinition, options: AgentCommandOptions = {}): AgentSummary {
  const modelSelectionNote = crossProviderNote(agent, options);
  return {
    id: agent.id,
    description: agent.description,
    scope: agent.scope,
    ...(agent.provider === undefined ? {} : { provider: agent.provider }),
    ...(agent.model === undefined ? {} : { model: agent.model }),
    ...(agent.toolAllowlist === undefined ? {} : { toolCount: agent.toolAllowlist.length }),
    budget: agent.budget === undefined ? undefined : { ...agent.budget },
    ...(modelSelectionNote === undefined ? {} : { modelSelectionNote }),
  };
}

function formatListRow(agent: AgentSummary): string {
  const selectors = [
    agent.provider === undefined ? undefined : `provider ${safeText(agent.provider)}`,
    agent.model === undefined ? undefined : `model ${safeText(agent.model)}`,
    agent.modelSelectionNote === undefined ? undefined : safeText(agent.modelSelectionNote),
  ].filter((value): value is string => value !== undefined);
  const budget = formatBudget(agent.budget);
  return `- ${safeText(agent.id)} · ${safeText(agent.description)} · ${agent.scope} · ` +
    `tools ${agent.toolCount === undefined ? "all" : agent.toolCount === 0 ? "none" : agent.toolCount}` +
    `${selectors.length === 0 ? "" : ` · ${selectors.join(", ")}`}` +
    `${budget === "default" ? "" : ` · ${budget}`}`;
}

function crossProviderNote(
  agent: AgentDefinition,
  options: AgentCommandOptions,
): string | undefined {
  if (agent.scope !== "project" || agent.provider === undefined ||
      options.currentProvider === undefined || agent.provider === options.currentProvider) {
    return undefined;
  }
  const model = options.currentModel === undefined ? "the session model" : options.currentModel;
  return `requested ${agent.provider}/${agent.model ?? "default"} is not applied; ` +
    `project agents do not switch the session; the session uses ${options.currentProvider} and model ${model}; the agent's model is inherited from session`;
}

function formatBudget(budget: AgentDefinition["budget"]): string {
  if (budget === undefined) return "default";
  return Object.entries(budget)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  return trimmed.startsWith("/") ? `:${trimmed.slice(1)}` : trimmed;
}

function safeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 256);
}
