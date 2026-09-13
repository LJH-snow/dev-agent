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
    context: AgentContext
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
