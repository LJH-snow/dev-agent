/** Raised when a run was stopped because its abort signal fired. */
export class ExecutorCancelledError extends Error {
  readonly command: string;

  constructor(command: string) {
    super(`Command cancelled: ${command}`);
    this.name = "ExecutorCancelledError";
    this.command = command;
  }
}

export type SandboxDenialCapability = "network" | "path" | "unknown";

/** Raised when the sandbox rejects a command before it can run. */
export class SandboxDeniedError extends Error {
  readonly code = "SANDBOX_DENIED";
  readonly originalCode: string;
  readonly capability: SandboxDenialCapability;
  readonly command: string;

  constructor(
    command: string,
    message: string,
    capability: SandboxDenialCapability = "unknown",
    originalCode = "SANDBOX_DENIED",
  ) {
    super(message);
    this.name = "SandboxDeniedError";
    this.originalCode = originalCode;
    this.capability = capability;
    this.command = command;
  }
}

export function inferSandboxDenialCapability(message: string): SandboxDenialCapability {
  if (/\b(network|internet|socket|dns|connect|connection)\b/i.test(message)) {
    return "network";
  }
  if (/\b(path|file|write|permission|operation not permitted)\b/i.test(message)) {
    return "path";
  }
  return "unknown";
}
