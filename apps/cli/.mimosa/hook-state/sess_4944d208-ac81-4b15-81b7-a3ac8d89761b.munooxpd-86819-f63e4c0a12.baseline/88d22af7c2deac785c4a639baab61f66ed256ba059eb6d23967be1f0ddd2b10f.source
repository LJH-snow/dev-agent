export type ExecutorPreference = "local" | "rust-sandbox";
export type ExecutorSelectionSource = "default" | "flag" | "explicit-path" | "runtime" | "environment";

export interface ExecutorSelectionInput {
  readonly executor?: ExecutorPreference;
  /** Legacy --rust-executor/DEV_AGENT_RUST_BINARY result. */
  readonly rustBinaryPath?: string;
  /** Source for rustBinaryPath when it was resolved from the environment. */
  readonly rustBinarySource?: "flag" | "environment";
  /** Binary resolved from the managed runtime cache. */
  readonly runtimeBinary?: string;
  /** Optional legacy-only environment path used by callers before normalization. */
  readonly envRuntimeBinary?: string;
}

export interface LocalExecutorSelection {
  readonly mode: "local";
  readonly source: "default" | "flag";
}

export interface RustSandboxExecutorSelection {
  readonly mode: "rust-sandbox";
  readonly source: "flag" | "explicit-path" | "runtime" | "environment";
  readonly rustBinaryPath: string;
}

export type ExecutorSelection = LocalExecutorSelection | RustSandboxExecutorSelection;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolves the executor preference without touching the filesystem or starting
 * a runtime. The caller is responsible for resolving an installed runtime
 * binary before selecting `rust-sandbox`.
 */
export function resolveExecutorSelection(
  input: ExecutorSelectionInput = {}
): ExecutorSelection {
  const preference = input.executor;
  const explicitBinary = nonEmpty(input.rustBinaryPath);
  const environmentBinary = nonEmpty(input.envRuntimeBinary);
  const runtimeBinary = nonEmpty(input.runtimeBinary);
  const legacyBinary = explicitBinary ?? environmentBinary;

  if (preference === "local") {
    if (explicitBinary !== undefined || runtimeBinary !== undefined) {
      throw new Error("--executor local cannot be combined with a Rust runtime binary");
    }
    // An explicit local preference intentionally suppresses a legacy
    // DEV_AGENT_RUST_BINARY value; this is the escape hatch for callers that
    // want to stay on the local executor without changing their environment.
    return { mode: "local", source: "flag" };
  }

  if (preference === "rust-sandbox") {
    const binary = explicitBinary ?? runtimeBinary ?? environmentBinary;
    if (binary === undefined) {
      throw new Error("rust-sandbox requires an installed runtime binary");
    }
    return {
      mode: "rust-sandbox",
      source:
        explicitBinary !== undefined
          ? input.rustBinarySource === "environment"
            ? "environment"
            : "explicit-path"
          : "flag",
      rustBinaryPath: binary,
    };
  }

  if (explicitBinary !== undefined) {
    return {
      mode: "rust-sandbox",
      source: input.rustBinarySource === "environment" ? "environment" : "explicit-path",
      rustBinaryPath: explicitBinary,
    };
  }

  if (runtimeBinary !== undefined) {
    return { mode: "rust-sandbox", source: "runtime", rustBinaryPath: runtimeBinary };
  }

  if (environmentBinary !== undefined) {
    return { mode: "rust-sandbox", source: "environment", rustBinaryPath: environmentBinary };
  }

  return { mode: "local", source: "default" };
}
