import { homedir } from "node:os";

import {
  isRuntimeTarget,
  isRuntimeManagerError,
  RuntimeManager,
  type RuntimeTarget,
  DEFAULT_RUNTIME_VERSION,
} from "@dev-agent/runtime-manager";
import {
  probeRustBinary,
  RUST_RUNTIME_PROTOCOL_VERSION,
  validateRustRuntimeContract,
} from "./doctor.js";

type RuntimeAction = "status" | "install" | "path" | "remove";

/** The official release currently carries runtime 0.2.0 assets. */
export const DEFAULT_RUNTIME_RELEASE_VERSION = "0.1.6";

export interface RuntimeCommandOptions {
  readonly action: RuntimeAction;
  readonly args: readonly string[];
}

export interface RuntimeCommandResult {
  readonly exitCode: number;
  readonly payload?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string };
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function readRuntimeVersion(args: readonly string[]): string {
  const value = flagValue(args, "--runtime-version")?.trim();
  return value || DEFAULT_RUNTIME_VERSION;
}

export function readRuntimeManifestRelease(args: readonly string[]): string {
  return flagValue(args, "--runtime-release")?.trim() || DEFAULT_RUNTIME_RELEASE_VERSION;
}

export function readRuntimeDirectory(args: readonly string[]): string | undefined {
  const value = flagValue(args, "--runtime-dir")?.trim();
  if (value) return value;
  const fromEnv = process.env.DEV_AGENT_RUNTIME_DIR?.trim();
  return fromEnv || undefined;
}

export function readRuntimeTarget(args: readonly string[]): RuntimeTarget | undefined {
  const value = flagValue(args, "--target")?.trim();
  if (!value) return undefined;
  if (!isRuntimeTarget(value)) {
    throw new Error(`Unsupported runtime target '${value}'.`);
  }
  return value;
}

function commandPayload(
  action: RuntimeAction,
  version: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  return { command: "runtime", action, version, ...payload };
}

function errorResult(error: unknown): RuntimeCommandResult {
  if (isRuntimeManagerError(error)) {
    return {
      exitCode: 1,
      error: { code: error.code, message: error.message },
    };
  }
  return {
    exitCode: 1,
    error: {
      code: "RUNTIME_COMMAND_FAILED",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

/** Executes runtime lifecycle commands without loading a provider, MCP, or session. */
export function createCliRuntimeManager(args: readonly string[]): RuntimeManager {
  return new RuntimeManager({
    runtimeDir: readRuntimeDirectory(args),
    home: homedir(),
    healthVerifier: async (binaryPath) => {
      const probe = await probeRustBinary(binaryPath);
      const contract = validateRustRuntimeContract(probe, {
        releaseVersion: readRuntimeVersion(args),
        protocolVersion: RUST_RUNTIME_PROTOCOL_VERSION,
      });
      if (!contract.ok) {
        throw new Error(`Runtime contract validation failed: ${contract.reason}`);
      }
    },
  });
}

export async function resolveManagedRuntimeBinary(args: readonly string[]): Promise<string> {
  const manager = createCliRuntimeManager(args);
  return manager.path(readRuntimeVersion(args), readRuntimeTarget(args));
}

/** Provides provider-free managed runtime metadata for doctor; never touches the network. */
export async function resolveManagedRuntimeStatus(args: readonly string[]): Promise<{
  state: "unsupported" | "missing" | "installed" | "corrupt";
  version: string;
  target?: RuntimeTarget;
  reason?: string;
}> {
  const manager = createCliRuntimeManager(args);
  const status = await manager.status(readRuntimeVersion(args), readRuntimeTarget(args));
  return {
    state: status.state,
    version: status.version,
    ...(status.target === undefined ? {} : { target: status.target }),
    ...(status.reason === undefined ? {} : { reason: status.reason }),
  };
}

export async function executeRuntimeCommand(
  options: RuntimeCommandOptions
): Promise<RuntimeCommandResult> {
  const version = readRuntimeVersion(options.args);
  try {
    const target = readRuntimeTarget(options.args);
    const manager = createCliRuntimeManager(options.args);

    if (options.action === "status") {
      const status = await manager.status(version, target);
      return {
        exitCode: 0,
        payload: commandPayload(options.action, version, {
          state: status.state,
          supported: status.state !== "unsupported",
          ...(status.target === undefined ? {} : { target: status.target }),
          ...(status.reason === undefined ? {} : { reason: status.reason }),
          ...(status.binaryPath === undefined ? {} : { binaryPath: status.binaryPath }),
        }),
      };
    }

    if (options.action === "path") {
      const binaryPath = await manager.path(version, target);
      return {
        exitCode: 0,
        payload: commandPayload(options.action, version, {
          ...(target === undefined ? {} : { target }),
          path: binaryPath,
        }),
      };
    }

    if (options.action === "remove") {
      const removed = await manager.remove(version, target);
      return {
        exitCode: 0,
        payload: commandPayload(options.action, version, {
          ...(removed.target === undefined ? {} : { target: removed.target }),
          removed: removed.removed,
        }),
      };
    }

    const installed = await manager.install(version, {
      ...(target === undefined ? {} : { target }),
      manifestReleaseVersion: readRuntimeManifestRelease(options.args),
    });
    return {
      exitCode: 0,
      payload: commandPayload(options.action, version, {
        target: installed.target,
        path: installed.binaryPath,
        reused: installed.reused,
      }),
    };
  } catch (error) {
    return errorResult(error);
  }
}

export function formatRuntimeCommandResult(
  result: RuntimeCommandResult,
  jsonOutput: boolean
): string {
  if (jsonOutput) {
    return JSON.stringify(
      result.error === undefined ? result.payload : { error: result.error },
      null,
      2
    );
  }
  if (result.error !== undefined) {
    return `${result.error.code}: ${result.error.message}`;
  }
  const payload = result.payload ?? {};
  if (payload.action === "status") {
    return `Runtime ${String(payload.version)}: ${String(payload.state)}`;
  }
  if (payload.action === "path") {
    return String(payload.path);
  }
  if (payload.action === "remove") {
    return payload.removed === true ? `Removed runtime ${String(payload.version)}.` : `Runtime ${String(payload.version)} was not installed.`;
  }
  return `Installed runtime ${String(payload.version)} at ${String(payload.path)}.`;
}
