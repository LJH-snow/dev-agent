import type { Executor, ExecutorResult } from "@dev-agent/executor";
import type {
  ValidationCheck,
  ValidationCheckResult,
  ValidationPlan,
  ValidationResult,
  ValidationRunOptions,
  ValidationRunner,
  ValidationStatus,
} from "@dev-agent/agent-core";

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export interface ValidationRunnerOptions {
  /** Maximum UTF-8 bytes retained from stdout/stderr for one check. */
  readonly maxOutputBytes?: number;
  /** Stop after the first failed check and mark the rest skipped. */
  readonly stopOnFailure?: boolean;
}

/**
 * Runs the structured commands emitted by `deriveValidationPlan`.
 *
 * The runner deliberately accepts an Executor rather than a shell command
 * string. The executor remains responsible for process-group termination,
 * Rust cancellation, cwd validation, and its own output quota.
 */
export function createValidationRunner(
  executor: Executor,
  options: ValidationRunnerOptions = {}
): ValidationRunner {
  const maxOutputBytes = positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const stopOnFailure = options.stopOnFailure ?? true;

  return {
    run: (plan, runOptions) =>
      runValidation(executor, plan, runOptions, maxOutputBytes, stopOnFailure),
  };
}

async function runValidation(
  executor: Executor,
  plan: ValidationPlan,
  runOptions: ValidationRunOptions | undefined,
  maxOutputBytes: number,
  stopOnFailure: boolean
): Promise<ValidationResult> {
  const startedAt = Date.now();
  if (plan.status !== "ready" || plan.checks.length === 0) {
    const status: ValidationStatus = plan.status === "blocked" ? "blocked" : "skipped";
    return {
      validationId: plan.validationId,
      changeSetId: plan.changeSetId,
      status,
      checks: [],
      durationMs: elapsedSince(startedAt),
      summary: plan.summary,
      ...(plan.reason === undefined ? {} : { reason: plan.reason }),
    };
  }

  const results: ValidationCheckResult[] = [];
  const signal = runOptions?.signal;
  for (let index = 0; index < plan.checks.length; index += 1) {
    const check = plan.checks[index]!;
    if (signal?.aborted) {
      results.push(blockedResult(check, "validation aborted before check started"));
      appendSkipped(results, plan.checks, index + 1, "validation aborted before check started");
      break;
    }

    const checkStartedAt = Date.now();
    try {
      const execution = await executor.run(
        check.command.executable,
        check.command.args,
        {
          cwd: check.command.cwd,
          timeoutMs: check.command.timeoutMs,
          maxOutputBytes,
          signal,
        }
      );

      if (signal?.aborted) {
        results.push(
          blockedResult(check, "validation aborted while the check was running", elapsedSince(checkStartedAt), execution)
        );
        appendSkipped(results, plan.checks, index + 1, "validation aborted before check started");
        break;
      }

      const checkResult = resultFromExecution(check, execution, elapsedSince(checkStartedAt), maxOutputBytes);
      results.push(checkResult);
      if (checkResult.status === "failed" && stopOnFailure) {
        appendSkipped(results, plan.checks, index + 1, "skipped because a previous check failed");
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (signal?.aborted || isAbortError(error)) {
        results.push(blockedResult(check, "validation aborted while the check was running", elapsedSince(checkStartedAt), undefined, message));
        appendSkipped(results, plan.checks, index + 1, "validation aborted before check started");
        break;
      }

      const failedResult: ValidationCheckResult = {
        ...check,
        status: "failed",
        durationMs: elapsedSince(checkStartedAt),
        error: message,
        reason: `check execution failed: ${message}`,
      };
      results.push(failedResult);
      if (stopOnFailure) {
        appendSkipped(results, plan.checks, index + 1, "skipped because a previous check failed");
        break;
      }
    }
  }

  const status = overallStatus(results);
  return {
    validationId: plan.validationId,
    changeSetId: plan.changeSetId,
    status,
    checks: results,
    durationMs: elapsedSince(startedAt),
    summary: summarize(status, results),
    ...(status === "blocked" ? { reason: "validation was aborted" } : {}),
  };
}

function resultFromExecution(
  check: ValidationCheck,
  execution: ExecutorResult,
  durationMs: number,
  maxOutputBytes: number
): ValidationCheckResult {
  const timedOut = execution.timedOut === true;
  const failed = timedOut || execution.exitCode !== 0;
  const reason = timedOut
    ? `check timed out after ${check.command.timeoutMs}ms`
    : execution.exitCode === 0
      ? undefined
      : `check exited with code ${execution.exitCode}`;
  const output = boundedOutput(execution, maxOutputBytes);
  return {
    ...check,
    status: failed ? "failed" : "passed",
    durationMs: execution.durationMs ?? durationMs,
    exitCode: execution.exitCode,
    ...(output === "" ? {} : { output }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function blockedResult(
  check: ValidationCheck,
  reason: string,
  durationMs = 0,
  execution?: ExecutorResult,
  error?: string
): ValidationCheckResult {
  const output = execution ? boundedOutput(execution, DEFAULT_MAX_OUTPUT_BYTES) : "";
  return {
    ...check,
    status: "blocked",
    durationMs: execution?.durationMs ?? durationMs,
    ...(execution?.exitCode === undefined ? {} : { exitCode: execution.exitCode }),
    ...(output === "" ? {} : { output }),
    ...(error === undefined ? {} : { error }),
    reason,
  };
}

function appendSkipped(
  results: ValidationCheckResult[],
  checks: readonly ValidationCheck[],
  startIndex: number,
  reason: string
): void {
  for (let index = startIndex; index < checks.length; index += 1) {
    results.push({
      ...checks[index]!,
      status: "skipped",
      durationMs: 0,
      reason,
    });
  }
}

function overallStatus(results: readonly ValidationCheckResult[]): ValidationStatus {
  if (results.some((result) => result.status === "blocked")) {
    return "blocked";
  }
  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }
  if (results.length === 0 || results.every((result) => result.status === "skipped")) {
    return "skipped";
  }
  return "passed";
}

function summarize(status: ValidationStatus, results: readonly ValidationCheckResult[]): string {
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const blocked = results.filter((result) => result.status === "blocked").length;
  const details = [
    passed > 0 ? `${passed} passed` : undefined,
    failed > 0 ? `${failed} failed` : undefined,
    skipped > 0 ? `${skipped} skipped` : undefined,
    blocked > 0 ? `${blocked} blocked` : undefined,
  ].filter((detail): detail is string => detail !== undefined);
  return `validation ${status}: ${details.join(", ") || "no checks"}`;
}

function boundedOutput(execution: ExecutorResult, maxOutputBytes: number): string {
  const parts = [execution.stdout, execution.stderr].filter((part) => part.length > 0);
  return truncateUtf8(parts.join(parts.length > 1 ? "\n" : ""), maxOutputBytes);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  let output = "";
  for (const character of value) {
    const candidate = output + character;
    if (Buffer.byteLength(candidate, "utf8") > maxBytes) {
      break;
    }
    output = candidate;
  }
  return output;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || (error as NodeJS.ErrnoException).code === "ABORT_ERR");
}
