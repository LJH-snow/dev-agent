import {
  createWorkspaceSandboxProfile,
  type SandboxProfile,
} from "@dev-agent/executor";
import type { SandboxDenialCapability } from "@dev-agent/agent-core";

/**
 * Maps built-in command tools to bounded execution intents.
 *
 * Filesystem and code-search have their own path/index boundaries, so they do
 * not receive a subprocess sandbox profile here.
 */
export function createBuiltInToolSandboxProfile(
  toolName: string,
  workingDirectory: string
): SandboxProfile | undefined {
  if (toolName === "search") {
    return createWorkspaceSandboxProfile(workingDirectory, "read-only");
  }
  if (toolName === "shell" || toolName === "git") {
    return createWorkspaceSandboxProfile(workingDirectory, "workspace-write");
  }
  return undefined;
}

/**
 * Returns the only built-in expansion currently considered safe to ask for:
 * network access on an already bounded profile. Paths and policy fragments
 * are never widened from model-provided data.
 */
export function expandBuiltInToolSandboxProfile(
  profile: SandboxProfile,
  capability: SandboxDenialCapability
): SandboxProfile | undefined {
  if (capability !== "network" || profile.network === "enabled") {
    return undefined;
  }
  return {
    ...profile,
    name: `${profile.name}+network`,
    network: "enabled",
  };
}
