import { DEFAULT_COLLABORATION_ROLES } from "@dev-agent/agent-core";
import type {
  AgentLoopBudget,
  CollaborationRole,
  ModelProvider,
  ToolCollection,
} from "@dev-agent/agent-core";
import type { SpecialistAgentConfig } from "./config.js";

export interface SpecialistRoleModelSelection {
  readonly provider?: string;
  readonly model?: string;
}

export interface ResolveSpecialistRolesOptions {
  readonly configured?: readonly SpecialistAgentConfig[];
  /** Project/user Markdown definitions discovered by Agent Core. */
  readonly discovered?: readonly SpecialistAgentConfig[];
  readonly tools: ToolCollection;
  /** Existing user-owned collaboration ceiling; role lists can only narrow it. */
  readonly toolCeiling?: readonly string[];
  /** Active caller provider used to prevent implicit project-level provider changes. */
  readonly currentProvider?: string;
  readonly createModel: (selection: SpecialistRoleModelSelection) => ModelProvider;
}

/**
 * Resolves config-defined specialist roles into trusted execution bindings.
 * Planner/model-generated task data never participates in these grants.
 */
export function resolveSpecialistRoles(
  options: ResolveSpecialistRolesOptions,
): readonly CollaborationRole[] {
  const availableTools = options.tools.list();
  const availableByName = new Map(availableTools.map((tool) => [tool.name, tool]));
  const availableNames = availableTools.map((tool) => tool.name);
  const ceiling = options.toolCeiling ?? availableNames;
  for (const name of ceiling) {
    if (!availableByName.has(name)) {
      throw new Error(`collaboration.toolAllowlist references unavailable tool: ${name}`);
    }
  }
  const ceilingSet = new Set(ceiling);
  const configured = options.configured;
  if (configured !== undefined && configured.length === 0) {
    throw new Error("collaboration.roles must contain at least one role");
  }

  const roles = mergeSpecialistRoleConfigs(configured, options.discovered);

  return roles.map((role) => {
    const requested = role.toolAllowlist ?? ceiling;
    const seen = new Set<string>();
    for (const name of requested) {
      if (seen.has(name)) {
        throw new Error(`collaboration role ${role.id} contains a duplicate tool: ${name}`);
      }
      seen.add(name);
      if (!availableByName.has(name)) {
        throw new Error(`collaboration role ${role.id} references unavailable tool: ${name}`);
      }
    }
    // A narrower role allowlist is a request, never an authority source.
    const effective = requested.filter((name) => ceilingSet.has(name));
    const tools = createToolView(options.tools, effective);
    const budget = role.budget === undefined
      ? undefined
      : ({ ...role.budget } satisfies AgentLoopBudget);
    return {
      id: role.id,
      instructions: role.instructions,
      tools,
      ...(() => {
        const selection = resolveRoleModelSelection(role, options.currentProvider);
        return selection === undefined
          ? {}
          : { model: options.createModel(selection) };
      })(),
      ...(budget === undefined ? {} : { budget }),
    };
  });
}

function resolveRoleModelSelection(
  role: SpecialistAgentConfig,
  currentProvider: string | undefined,
): SpecialistRoleModelSelection | undefined {
  const crossesProjectProviderBoundary = role.scope === "project" &&
    role.provider !== undefined &&
    currentProvider !== undefined &&
    role.provider !== currentProvider;
  if (crossesProjectProviderBoundary) {
    // Project Markdown is shared input. It may describe a preferred provider,
    // but it cannot silently move a caller's prompt to another trust boundary.
    return undefined;
  }
  if (role.provider === undefined && role.model === undefined) return undefined;
  return {
    ...(role.provider === undefined ? {} : { provider: role.provider }),
    ...(role.model === undefined ? {} : { model: role.model }),
  };
}

function createToolView(
  source: ToolCollection,
  names: readonly string[],
): ToolCollection {
  const tools = new Map(names.map((name) => [name, source.get(name)!]));
  return {
    list: () => [...tools.values()],
    get: (name) => tools.get(name),
    metadata: (name) => tools.has(name) ? source.metadata?.(name) : undefined,
  };
}

/**
 * Merges trusted JSON role configuration with discovered Markdown definitions.
 * Explicit JSON roles win duplicate ids. When no JSON role list is present,
 * discovered definitions augment the built-in collaboration roles.
 */
export function mergeSpecialistRoleConfigs(
  configured?: readonly SpecialistAgentConfig[],
  discovered: readonly SpecialistAgentConfig[] = [],
): readonly SpecialistAgentConfig[] {
  const sources: readonly SpecialistAgentConfig[] = [
    ...(configured === undefined
      ? DEFAULT_COLLABORATION_ROLES.map(({ id, instructions }) => ({ id, instructions }))
      : []),
    ...discovered,
    ...(configured ?? []),
  ];
  const byId = new Map<string, SpecialistAgentConfig>();
  for (const role of sources) {
    byId.set(role.id, role);
  }
  return [...byId.values()];
}
