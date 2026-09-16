import type { RuntimeStatusState } from "./types.js";

export type RuntimeErrorCode =
  | "INVALID_VERSION"
  | "UNSUPPORTED_PLATFORM"
  | "INVALID_MANIFEST"
  | "MANIFEST_VERSION_MISMATCH"
  | "TARGET_MISMATCH"
  | "RUNTIME_NOT_INSTALLED"
  | "RUNTIME_CORRUPT"
  | "CHECKSUM_MISMATCH"
  | "DOWNLOAD_FAILED"
  | "ARCHIVE_INVALID"
  | "HEALTH_CHECK_FAILED"
  | "INSTALL_CANCELLED"
  | "INSTALL_FAILED";

export type RuntimeErrorDetails = Readonly<Record<string, string | number | boolean>>;

export class RuntimeManagerError extends Error {
  readonly code: RuntimeErrorCode;
  readonly details?: RuntimeErrorDetails;

  constructor(code: RuntimeErrorCode, message: string, details?: RuntimeErrorDetails) {
    super(message);
    this.name = "RuntimeManagerError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isRuntimeManagerError(error: unknown): error is RuntimeManagerError {
  return error instanceof RuntimeManagerError;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "code" in error && error.code === "ABORT_ERR")
  );
}

export function statusError(
  state: Exclude<RuntimeStatusState, "installed">,
  version: string,
  target?: string
): RuntimeManagerError {
  if (state === "unsupported") {
    return new RuntimeManagerError(
      "UNSUPPORTED_PLATFORM",
      "The current platform does not support the dev-agent runtime",
      { version }
    );
  }
  if (state === "missing") {
    return new RuntimeManagerError(
      "RUNTIME_NOT_INSTALLED",
      "The requested dev-agent runtime is not installed",
      { version, ...(target ? { target } : {}) }
    );
  }
  return new RuntimeManagerError(
    "RUNTIME_CORRUPT",
    "The requested dev-agent runtime is corrupt or incomplete",
    { version, ...(target ? { target } : {}) }
  );
}
