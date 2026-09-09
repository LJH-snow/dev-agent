export type SandboxNetworkPolicy = "enabled" | "disabled" | "loopback";

export interface ExecutorResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: boolean;
}

export interface ExecutorRunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly input?: string | Buffer;
  readonly timeoutMs?: number;
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

export interface CreateExecutorOptions {
  readonly rustBinaryPath?: string;
}

export function createExecutor(options: CreateExecutorOptions = {}): Executor {
  if (options.rustBinaryPath) {
    return new RustExecutor({ binaryPath: options.rustBinaryPath });
  }
  return new LocalExecutor();
}
