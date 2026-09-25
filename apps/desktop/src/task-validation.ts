import { randomUUID } from "node:crypto";

import type {
  ValidationCheck,
  ValidationCheckResult,
  ValidationPlan,
  ValidationResult,
  ValidationStatus,
} from "@dev-agent/agent-core";

const maxFailureSummaryBytes = 8 * 1024;
const maxReasonBytes = 768;
const maxChecks = 256;
const retainedRunLifetimeMs = 60 * 60 * 1000;
const sensitiveKeyPattern = /((?:["']?(?:api[-_ ]?key|access[-_ ]?token|authorization|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*)(["']))[^"'\\]*(?:\\.[^"'\\]*)*\2/gi;
const sensitiveUnquotedPattern = /((?:["']?(?:api[-_ ]?key|access[-_ ]?token|authorization|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*))(?!["'])([^"'\s,}\]]+)/gi;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const tokenShapePattern = /\b(?:sk|pk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gi;

export type TaskValidationState = "idle" | "running" | ValidationStatus;
export type TaskValidationCheckState = "pending" | ValidationStatus;
export type TaskValidationPolicy = "fast" | "default" | "strict" | "unknown";
export type TaskValidationMode = "all" | "failed";

export interface TaskValidationCheckSnapshot {
  readonly id: string;
  readonly label: string;
  readonly state: TaskValidationCheckState;
  readonly durationMs: number;
  readonly exitCode?: number;
  readonly reason?: string;
}

/**
 * Metadata-only task validation state. Commands, cwd values, and raw output
 * are intentionally not part of this public projection.
 */
export interface TaskValidationSnapshot {
  readonly sessionId: string;
  readonly state: TaskValidationState;
  readonly policy: TaskValidationPolicy;
  readonly mode: TaskValidationMode;
  readonly runId?: string;
  readonly validationId?: string;
  readonly changedFiles: number;
  readonly summary: string;
  readonly checks: readonly TaskValidationCheckSnapshot[];
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly cancelRequested?: boolean;
  readonly failureSummary?: string;
}

export interface TaskValidationSession {
  prepareTaskValidation(
    changedPaths: readonly string[],
    options?: { readonly validationId?: string },
  ): Promise<ValidationPlan> | ValidationPlan;
  runTaskValidation(
    plan: ValidationPlan,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ValidationResult>;
}

export class TaskValidationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "TaskValidationError";
  }
}

interface TaskValidationRun {
  readonly sessionId: string;
  readonly runId: string;
  readonly controller: AbortController;
  readonly changedFiles: number;
  readonly policy: TaskValidationPolicy;
  readonly mode: TaskValidationMode;
  readonly startedAt: string;
  readonly planReady: Promise<void>;
  snapshot: TaskValidationSnapshot;
  finished: boolean;
  cancelRequested: boolean;
  retentionTimer?: NodeJS.Timeout;
}

function boundedText(value: unknown, maxBytes: number): string {
  const text = String(value ?? "")
    .replace(/\0/g, "�")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  if (maxBytes <= 0) return "";
  const suffix = "…";
  const contentBudget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let output = "";
  for (const character of text) {
    const candidate = output + character;
    if (Buffer.byteLength(candidate, "utf8") > contentBudget) break;
    output = candidate;
  }
  return `${output}${suffix}`;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(sensitiveKeyPattern, "$1$2[redacted]$2")
    .replace(sensitiveUnquotedPattern, "$1[redacted]")
    .replace(bearerPattern, "Bearer [redacted]")
    .replace(tokenShapePattern, "[redacted-token]");
}

function safeReason(value: unknown): string | undefined {
  const text = boundedText(redactSensitiveText(String(value ?? "")), maxReasonBytes);
  return text === "" ? undefined : text;
}

function safePolicy(value: unknown): TaskValidationPolicy {
  return value === "fast" || value === "default" || value === "strict" ? value : "unknown";
}

function safeMode(value: unknown): TaskValidationMode {
  return value === "failed" ? "failed" : "all";
}

function safeSessionId(value: string): string {
  return boundedText(value, 96) || "unknown";
}

function pendingChecks(plan: ValidationPlan): TaskValidationCheckSnapshot[] {
  return plan.checks.slice(0, maxChecks).map((check) => ({
    id: boundedText(check.id, 128),
    label: boundedText(check.label, 256),
    state: "pending",
    durationMs: 0,
  }));
}

function projectCheck(check: ValidationCheckResult): TaskValidationCheckSnapshot {
  return {
    id: boundedText(check.id, 128),
    label: boundedText(check.label, 256),
    state: check.status,
    durationMs: Number.isFinite(check.durationMs) && check.durationMs >= 0 ? Math.floor(check.durationMs) : 0,
    ...(Number.isSafeInteger(check.exitCode) ? { exitCode: check.exitCode } : {}),
    ...(safeReason(check.reason ?? check.error) === undefined
      ? {}
      : { reason: safeReason(check.reason ?? check.error) }),
  };
}

function failureSummary(result: ValidationResult): string | undefined {
  const lines = result.checks
    .filter((check) => check.status === "failed" || check.status === "blocked")
    .slice(0, maxChecks)
    .map((check) => {
      const reason = safeReason(check.reason ?? check.error) ?? "check did not pass";
      return `- ${boundedText(check.label, 256)}: ${reason}`;
    });
  if (lines.length === 0 && result.status === "blocked") {
    const reason = safeReason(result.reason) ?? "validation was blocked";
    lines.push(`- ${reason}`);
  }
  if (lines.length === 0) return undefined;
  return boundedText(lines.join("\n"), maxFailureSummaryBytes);
}

function idleSnapshot(sessionId: string, policy: TaskValidationPolicy): TaskValidationSnapshot {
  return {
    sessionId: safeSessionId(sessionId),
    state: "idle",
    policy: safePolicy(policy),
    mode: "all",
    changedFiles: 0,
    summary: "No task validation has run.",
    checks: [],
  };
}

export class DesktopTaskValidationManager {
  private readonly active = new Map<string, TaskValidationRun>();
  private readonly retained = new Map<string, TaskValidationSnapshot>();

  get(sessionId: string, policy: TaskValidationPolicy = "unknown"): TaskValidationSnapshot {
    const active = this.active.get(sessionId);
    if (active) return active.snapshot;
    return this.retained.get(sessionId) ?? idleSnapshot(sessionId, policy);
  }

  hasRunning(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  runningSessionIds(): ReadonlySet<string> {
    return new Set(this.active.keys());
  }

  clear(sessionId: string): void {
    const run = this.active.get(sessionId);
    if (run) {
      run.cancelRequested = true;
      run.controller.abort();
      return;
    }
    this.retained.delete(sessionId);
  }

  async start(
    sessionId: string,
    session: TaskValidationSession,
    changedFiles: number,
    changedPaths: readonly string[],
    policy: TaskValidationPolicy = "unknown",
    mode: TaskValidationMode = "all",
  ): Promise<TaskValidationSnapshot> {
    const selectedMode = safeMode(mode);
    if (this.active.has(sessionId)) {
      throw new TaskValidationError(
        "A task validation is already running in this session.",
        409,
        "task-validation-running",
      );
    }
    if (changedFiles < 0 || !Number.isSafeInteger(changedFiles)) {
      throw new TaskValidationError("The changed-file count is invalid.", 400, "task-validation-invalid-files");
    }
    if (changedPaths.length > maxChecks * 2) {
      throw new TaskValidationError("The changed-file list is too large to validate.", 413, "task-validation-too-many-files");
    }
    const previous = this.retained.get(sessionId);
    if (selectedMode === "failed" && !hasFailedChecks(previous)) {
      throw new TaskValidationError(
        "There are no failed or blocked checks to rerun.",
        409,
        "task-validation-no-failed-checks",
      );
    }

    const runId = randomUUID();
    const controller = new AbortController();
    const startedAt = new Date().toISOString();
    let resolvePlan!: () => void;
    const planReady = new Promise<void>((resolve) => { resolvePlan = resolve; });
    const run: TaskValidationRun = {
      sessionId,
      runId,
      controller,
      changedFiles,
      policy: safePolicy(policy),
      mode: selectedMode,
      startedAt,
      planReady,
      snapshot: {
        sessionId: safeSessionId(sessionId),
        state: "running",
        policy: safePolicy(policy),
        mode: selectedMode,
        runId,
        changedFiles,
        summary: "Preparing task validation…",
        checks: [],
        startedAt,
      },
      finished: false,
      cancelRequested: false,
    };
    this.active.set(sessionId, run);

    try {
      const validationId = `task-validation:${runId}`;
      const preparedPlan = await session.prepareTaskValidation(changedPaths, { validationId });
      if (this.active.get(sessionId) !== run) {
        throw new TaskValidationError("Task validation was superseded.", 409, "task-validation-superseded");
      }
      const plan = selectPlan(preparedPlan, selectedMode, previous);
      run.snapshot = {
        ...run.snapshot,
        validationId: boundedText(plan.validationId, 160),
        summary: boundedText(plan.summary, 512),
        checks: pendingChecks(plan),
      };
      resolvePlan();
      void this.execute(run, session, plan);
      return run.snapshot;
    } catch (error) {
      resolvePlan();
      const message = error instanceof TaskValidationError
        ? error.message
        : "Task validation could not be prepared.";
      run.finished = true;
      run.snapshot = {
        ...run.snapshot,
        state: "blocked",
        summary: "Task validation is blocked.",
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.parse(new Date().toISOString()) - Date.parse(run.startedAt)),
        failureSummary: boundedText(`- ${safeReason(message) ?? "validation could not be prepared"}`, maxFailureSummaryBytes),
      };
      this.active.delete(sessionId);
      this.retain(run);
      if (error instanceof TaskValidationError) throw error;
      return run.snapshot;
    }
  }

  cancel(sessionId: string, policy: TaskValidationPolicy = "unknown"): TaskValidationSnapshot {
    const run = this.active.get(sessionId);
    if (!run) return this.get(sessionId, policy);
    run.cancelRequested = true;
    run.controller.abort();
    run.snapshot = {
      ...run.snapshot,
      cancelRequested: true,
      summary: "Cancellation requested…",
    };
    return run.snapshot;
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const run = this.active.get(sessionId);
    if (!run) return true;
    this.cancel(sessionId);
    await run.planReady;
    while (!run.finished) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    return !this.hasRunning(sessionId);
  }

  closeAll(): void {
    for (const sessionId of this.active.keys()) this.cancel(sessionId);
    for (const run of this.active.values()) {
      if (run.retentionTimer) clearTimeout(run.retentionTimer);
    }
  }

  private async execute(
    run: TaskValidationRun,
    session: TaskValidationSession,
    plan: ValidationPlan,
  ): Promise<void> {
    try {
      const result = await session.runTaskValidation(plan, { signal: run.controller.signal });
      const finishedAt = new Date().toISOString();
      run.snapshot = {
        ...run.snapshot,
        state: result.status,
        summary: boundedText(result.summary, 512),
        checks: result.checks.slice(0, maxChecks).map(projectCheck),
        finishedAt,
        durationMs: Number.isFinite(result.durationMs) && result.durationMs >= 0
          ? Math.floor(result.durationMs)
          : Math.max(0, Date.parse(finishedAt) - Date.parse(run.startedAt)),
        ...(failureSummary(result) === undefined ? {} : { failureSummary: failureSummary(result) }),
        ...(run.cancelRequested ? { cancelRequested: true } : {}),
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const reason = error instanceof Error ? error.message : String(error);
      run.snapshot = {
        ...run.snapshot,
        state: run.cancelRequested ? "blocked" : "failed",
        summary: run.cancelRequested ? "Task validation was cancelled." : "Task validation failed to complete.",
        finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(run.startedAt)),
        failureSummary: boundedText(`- ${safeReason(reason) ?? "validation failed to complete"}`, maxFailureSummaryBytes),
        ...(run.cancelRequested ? { cancelRequested: true } : {}),
      };
    } finally {
      run.finished = true;
      this.active.delete(run.sessionId);
      this.retain(run);
    }
  }

  private retain(run: TaskValidationRun): void {
    this.retained.set(run.sessionId, run.snapshot);
    if (run.retentionTimer) clearTimeout(run.retentionTimer);
    run.retentionTimer = setTimeout(() => {
      if (this.retained.get(run.sessionId)?.runId === run.runId) this.retained.delete(run.sessionId);
    }, retainedRunLifetimeMs);
    run.retentionTimer.unref();
  }
}

function hasFailedChecks(snapshot: TaskValidationSnapshot | undefined): boolean {
  return snapshot?.checks.some((check) => check.state === "failed" || check.state === "blocked") === true;
}

function selectPlan(
  plan: ValidationPlan,
  mode: TaskValidationMode,
  previous: TaskValidationSnapshot | undefined,
): ValidationPlan {
  const boundedChecks = plan.checks.slice(0, maxChecks);
  const boundedPlan = boundedChecks.length === plan.checks.length
    ? plan
    : { ...plan, checks: boundedChecks };
  if (mode !== "failed" || boundedPlan.status !== "ready") return boundedPlan;

  const failedIds = new Set(
    (previous?.checks ?? [])
      .filter((check) => check.state === "failed" || check.state === "blocked")
      .map((check) => check.id),
  );
  const checks = boundedPlan.checks.filter((check) => failedIds.has(check.id));
  if (checks.length === 0) {
    return {
      ...boundedPlan,
      status: "skipped",
      checks: [],
      summary: "validation is skipped",
      reason: "no previously failed checks remain in the current validation plan",
    };
  }
  return {
    ...boundedPlan,
    checks,
    summary: `${checks.length} failed validation check${checks.length === 1 ? "" : "s"} selected`,
  };
}
