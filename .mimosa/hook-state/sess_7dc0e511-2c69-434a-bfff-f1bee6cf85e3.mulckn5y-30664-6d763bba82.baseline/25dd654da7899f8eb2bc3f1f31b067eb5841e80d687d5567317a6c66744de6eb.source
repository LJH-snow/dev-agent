import {
  DEFAULT_RUNTIME_VERSION,
  isRuntimeManagerError,
  isRuntimeTarget,
  RuntimeManager,
  type RuntimeTarget,
} from "@dev-agent/runtime-manager";

export type DesktopManagedRuntimeState =
  | "unsupported"
  | "missing"
  | "installed"
  | "corrupt"
  | "unavailable";

export interface DesktopManagedRuntimeStatus {
  readonly state: DesktopManagedRuntimeState;
  /** A version is public only after an installed runtime has been verified. */
  readonly version?: string;
  readonly target?: RuntimeTarget;
  readonly reason?: string;
}

export interface DesktopManagedRuntimeOptions {
  readonly version?: string;
  readonly runtimeDir?: string;
  readonly target?: RuntimeTarget;
}

/**
 * Reads managed runtime state without starting a provider, MCP server, or
 * binary. The result is intentionally allowlisted and excludes binary paths.
 */
export async function resolveDesktopManagedRuntimeStatus(
  options: DesktopManagedRuntimeOptions = {}
): Promise<DesktopManagedRuntimeStatus> {
  const version =
    options.version ?? process.env.DEV_AGENT_RUNTIME_VERSION ?? DEFAULT_RUNTIME_VERSION;
  const runtimeDir = options.runtimeDir ?? process.env.DEV_AGENT_RUNTIME_DIR;
  const envTarget = process.env.DEV_AGENT_RUNTIME_TARGET;
  const target = options.target ?? (isRuntimeTarget(envTarget) ? envTarget : undefined);
  const manager = new RuntimeManager({ runtimeDir });

  try {
    const status = await manager.status(version, target);
    const unsupported =
      status.state === "unsupported"
        ? { state: "unsupported" as const, reason: "Runtime target is unsupported" }
        : undefined;
    return {
      ...(unsupported ?? { state: status.state }),
      ...(status.target === undefined ? {} : { target: status.target }),
      ...(status.state === "installed" ? { version: status.version } : {}),
      ...(status.state === "corrupt" && status.reason !== undefined
        ? { reason: status.reason }
        : {}),
    };
  } catch (error) {
    const reason = isRuntimeManagerError(error) ? error.code : "runtime_status_unavailable";
    return {
      state: "unavailable",
      ...(target === undefined ? {} : { target }),
      reason,
    };
  }
}
