export type SandboxNetworkPolicy = "enabled" | "disabled" | "loopback";

export interface ExecutorResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: boolean;
  readonly durationMs?: number;
  readonly command?: string;
  readonly bytesTruncated?: boolean;
}

import { statSync, type Stats } from "node:fs";

export interface ExecutorRunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly input?: string | Buffer;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  /**
   * Aborts a running command. `LocalExecutor` kills the child process;
   * `RustExecutor` sends a cancel to the runtime, which kills it there.
   */
  readonly signal?: AbortSignal;
}

/**
 * Validates a `cwd` before a command is spawned.
 *
 * `spawn("echo", [], { cwd: missing })` fails with `spawn echo ENOENT`, which
 * points at the command even though it exists -- the caller then "fixes" PATH or
 * swaps the command instead of the missing directory. Checked per call rather
 * than cached so a directory deleted mid-session is reported immediately.
 */
export function assertWorkingDirectory(cwd: string | undefined): void {
  if (cwd === undefined) {
    return;
  }
  let info: Stats;
  try {
    info = statSync(cwd);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`working directory does not exist: ${cwd}`);
    }
    throw new Error(
      `working directory could not be inspected: ${cwd} (${
        error instanceof Error ? error.message : String(error)
      })`
    );
  }
  if (!info.isDirectory()) {
    throw new Error(`working directory is not a directory: ${cwd}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export interface Executor {
  run(
    command: string,
    args?: readonly string[],
    options?: ExecutorRunOptions
  ): Promise<ExecutorResult>;
}

export interface SandboxProfile {
  readonly name: string;
  readonly network?: SandboxNetworkPolicy;
  readonly writablePaths?: readonly string[];
  readonly readonlyPaths?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly policyScript?: string;
}

export interface SandboxExecutor extends Executor {
  runSandboxed(
    command: string,
    args?: readonly string[],
    options?: ExecutorRunOptions & { readonly profile?: SandboxProfile }
  ): Promise<ExecutorResult>;
}

import { LocalExecutor } from "./local-executor.js";
import { RustExecutor } from "./rust-executor.js";

export * from "./local-executor.js";
export * from "./rust-executor.js";
export * from "./errors.js";

export interface CreateExecutorOptions {
  readonly rustBinaryPath?: string;
}

export function createExecutor(options: CreateExecutorOptions = {}): Executor {
  if (options.rustBinaryPath) {
    return new RustExecutor({ binaryPath: options.rustBinaryPath });
  }
  return new LocalExecutor();
}
