import {
  AgentToolRegistry,
  type AgentTool,
  type ToolExecutionContext as AgentToolExecutionContext,
} from "@dev-agent/agent-core";

export type ToolName = "filesystem" | "shell" | "git" | "search" | "code-search";

export type Tool = AgentTool & { readonly name: ToolName };
export type ToolExecutionContext = AgentToolExecutionContext;

/**
 * Compatibility entry point for callers that historically imported the
 * built-in registry from `@dev-agent/tools`. Agent Core owns the actual
 * registry and metadata normalization.
 */
export class ToolRegistry extends AgentToolRegistry {
  override get(name: string): Tool | undefined {
    return super.get(name) as Tool | undefined;
  }

  override list(): Tool[] {
    return super.list() as Tool[];
  }
}

export * from "./change-set.js";
export * from "./filesystem.js";
export * from "./workspace-path.js";
export * from "./shell.js";
export * from "./git.js";
export * from "./search.js";
export * from "./code-search.js";
export * from "./sandbox-profile.js";
export * from "./create-default-tools.js";
export * from "./validation-plan.js";
export * from "./validation-runner.js";
