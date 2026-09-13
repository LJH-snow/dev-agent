import { randomUUID } from "node:crypto";
import type { ChangeSetReview } from "./approval.js";
import type { AgentContext } from "./context.js";

/** The final state of a validation run or of an individual check. */
export type ValidationStatus = "passed" | "failed" | "skipped" | "blocked";

/** Whether a plan has runnable checks or is intentionally unable to run one. */
export type ValidationPlanStatus = "ready" | "skipped" | "blocked";

/** An executable command produced by a trusted validation planner. */
export interface ValidationCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

/** One deterministic check in a validation plan. */
export interface ValidationCheck {
  readonly id: string;
  readonly label: string;
  readonly command: ValidationCommand;
}

/** Checks selected after inspecting an applied change set. */
export interface ValidationPlan {
  readonly validationId: string;
  readonly changeSetId: string;
  readonly status: ValidationPlanStatus;
  readonly checks: readonly ValidationCheck[];
  readonly summary: string;
  readonly reason?: string;
}

/** The observed outcome of one planned check. */
export interface ValidationCheckResult extends ValidationCheck {
  readonly status: ValidationStatus;
  readonly durationMs: number;
  readonly exitCode?: number;
  readonly output?: string;
  readonly error?: string;
  readonly reason?: string;
}

/** The complete outcome returned to a caller after validation. */
export interface ValidationResult {
  readonly validationId: string;
  readonly changeSetId: string;
  readonly status: ValidationStatus;
  readonly checks: readonly ValidationCheckResult[];
  readonly durationMs: number;
  readonly summary: string;
  readonly reason?: string;
}

/** A validation result retained as structured session evidence. */
export interface ValidationRecord extends ValidationResult {
  readonly recordedAt: string;
}

export interface ValidationRunOptions {
  readonly signal?: AbortSignal;
}

/** Optional identity supplied when a validation is explicitly rerun. */
export interface ValidationPrepareOptions {
  readonly validationId?: string;
}

/** Options shared by the trusted planner and runner for one validation attempt. */
export interface ValidationAttemptOptions extends ValidationRunOptions, ValidationPrepareOptions {}

/** Runs only the structured commands supplied by a validation planner. */
export interface ValidationRunner {
  run(plan: ValidationPlan, options?: ValidationRunOptions): Promise<ValidationResult>;
}

/**
 * Integration point for AgentLoop. A host supplies a planner and a runner so
 * the core package stays independent of filesystem/tool implementations.
 */
export interface ValidationAdapter {
  prepare(
    review: ChangeSetReview,
    context: AgentContext,
    options?: ValidationPrepareOptions
  ): Promise<ValidationPlan> | ValidationPlan;
  run(plan: ValidationPlan, options?: ValidationRunOptions): Promise<ValidationResult>;
}

/** Deterministic id used to correlate a validation with its change set. */
export function createValidationId(changeSetId: string): string {
  return `validation:${changeSetId}`;
}

/** Explicitly opt into a fresh id when a caller needs multiple runs per set. */
export function createValidationAttemptId(changeSetId: string): string {
  return `validation:${changeSetId}:${randomUUID()}`;
}

/**
 * Runs one validation attempt with the same abort and blocked semantics used by
 * the agent loop. Callers may provide a fresh validation id for an explicit
 * rerun; the planner and runner must preserve both identities.
 */
export async function runValidationAttempt(
  adapter: ValidationAdapter,
  review: ChangeSetReview,
  context: AgentContext,
  options: ValidationAttemptOptions = {}
): Promise<ValidationResult> {
  const startedAt = Date.now();
  const validationId = options.validationId ?? createValidationId(review.changeSetId);
  if (options.signal?.aborted) {
    return createBlockedValidationResult(
      review.changeSetId,
      validationId,
      "validation aborted before checks started",
      startedAt
    );
  }

  let plan: ValidationPlan;
  try {
    plan = await adapter.prepare(
      review,
      context,
      options.validationId === undefined ? undefined : { validationId }
    );
  } catch (error) {
    return createBlockedValidationResult(
      review.changeSetId,
      validationId,
      `validation preparation failed: ${error instanceof Error ? error.message : String(error)}`,
      startedAt
    );
  }

  if (plan.changeSetId !== review.changeSetId || plan.validationId !== validationId) {
    return createBlockedValidationResult(
      review.changeSetId,
      validationId,
      "validation plan has an invalid change-set identity",
      startedAt,
      plan
    );
  }

  try {
    const result = await adapter.run(plan, { signal: options.signal });
    if (options.signal?.aborted && result.status !== "blocked") {
      return createBlockedValidationResult(
        review.changeSetId,
        validationId,
        "validation aborted while the checks were running",
        startedAt,
        plan
      );
    }
    if (result.changeSetId !== review.changeSetId || result.validationId !== validationId) {
      return createBlockedValidationResult(
        review.changeSetId,
        validationId,
        "validation result has an invalid change-set identity",
        startedAt,
        plan
      );
    }
    return result;
  } catch (error) {
    if (options.signal?.aborted) {
      return createBlockedValidationResult(
        review.changeSetId,
        validationId,
        "validation aborted while the checks were running",
        startedAt,
        plan
      );
    }
    return createBlockedValidationResult(
      review.changeSetId,
      validationId,
      `validation runner failed: ${error instanceof Error ? error.message : String(error)}`,
      startedAt,
      plan
    );
  }
}

/** Creates a blocked result without running or undoing any filesystem change. */
export function createBlockedValidationResult(
  changeSetId: string,
  validationId: string,
  reason: string,
  startedAt = Date.now(),
  plan?: ValidationPlan
): ValidationResult {
  return {
    validationId,
    changeSetId,
    status: "blocked",
    checks: [],
    durationMs: Math.max(0, Date.now() - startedAt),
    summary: "validation is blocked",
    reason,
    ...(plan?.status === "blocked" && plan.reason ? { reason: `${reason}; ${plan.reason}` } : {}),
  };
}
