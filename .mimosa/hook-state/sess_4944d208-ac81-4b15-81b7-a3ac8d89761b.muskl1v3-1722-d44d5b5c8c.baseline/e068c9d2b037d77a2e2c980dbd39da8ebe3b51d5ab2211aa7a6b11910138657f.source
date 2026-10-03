import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve, win32 } from "node:path";

import type {
  ChangeSetFileReview,
  ChangeSetReview,
  FilesystemMutationInput,
  PreparedChangeSet,
  ToolExecutionContext,
} from "@dev-agent/tools";

export type PlanClock = () => Date;

type PlanFilesystem = {
  prepareChangeSet(
    input: unknown,
    context?: Pick<ToolExecutionContext, "sessionId" | "workingDirectory">
  ): Promise<PreparedChangeSet>;
  execute(input: unknown, context?: ToolExecutionContext): Promise<unknown>;
};

export type PlanErrorCode =
  | "invalid_json"
  | "invalid_plan"
  | "expired"
  | "session_mismatch"
  | "working_directory_mismatch"
  | "already_applied"
  | "change_set_unavailable"
  | "path_conflict"
  | "prepare_failed"
  | "apply_failed";

export interface PlanError {
  readonly code: PlanErrorCode;
  readonly message: string;
}

export interface PlanFileReview {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly beforeHash?: string;
  readonly afterHash: string;
  readonly additions: number;
  readonly deletions: number;
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
}

export interface PlanReview {
  readonly changeSetId: string;
  readonly files: readonly PlanFileReview[];
  readonly additions: number;
  readonly deletions: number;
  readonly createdAt: string;
}

export interface PlanDocument {
  readonly schemaVersion: 1;
  readonly kind: "dev-agent.plan";
  readonly planId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly sessionId: string;
  /** A one-way binding to the workspace; the absolute path is never persisted. */
  readonly workspaceId: string;
  readonly changeSetId: string;
  readonly executeInput: { readonly action: "apply"; readonly changeSetId: string };
  readonly mutations: readonly {
    readonly action: FilesystemMutationInput["action"];
    readonly path: string;
  }[];
  readonly review: PlanReview;
}

export interface CreatePlanOptions {
  readonly filesystem: PlanFilesystem;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly changes: readonly FilesystemMutationInput[];
  readonly clock?: PlanClock;
  readonly ttlMs?: number;
}

export interface ApplyPlanOptions {
  readonly filesystem: PlanFilesystem;
  readonly plan: PlanDocument | string;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly clock?: PlanClock;
  /** Original mutation inputs used to rehydrate a plan in a later process. */
  readonly changes?: readonly FilesystemMutationInput[];
}

export interface PlanSuccess {
  readonly ok: true;
  readonly command: "plan" | "apply";
  readonly plan?: PlanDocument;
  readonly planId?: string;
  readonly changeSetId?: string;
  readonly review?: PlanReview;
  readonly files?: readonly PlanAppliedFile[];
  readonly additions?: number;
  readonly deletions?: number;
  readonly appliedAt?: string;
}

export interface PlanFailure {
  readonly ok: false;
  readonly command: "plan" | "apply";
  readonly error: PlanError;
}

export type PlanResult = PlanSuccess | PlanFailure;

export interface PlanAppliedFile {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
}

interface RuntimePlanBinding {
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly planDigest: string;
  state: "planned" | "applied";
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const bindings = new WeakMap<object, Map<string, RuntimePlanBinding>>();

export async function createPlan(options: CreatePlanOptions): Promise<PlanResult> {
  const clock = options.clock ?? (() => new Date());
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (!options.sessionId || !Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(ttlMs)) {
    return failure("plan", "invalid_plan", "The plan request is invalid.");
  }

  let changes: readonly FilesystemMutationInput[];
  try {
    changes = normalizeMutations(options.changes, options.workingDirectory);
  } catch {
    return failure("plan", "path_conflict", "The plan contains an invalid or conflicting path.");
  }
  if (changes.length === 0) {
    return failure("plan", "invalid_plan", "The plan must contain at least one filesystem mutation.");
  }

  let prepared: PreparedChangeSet;
  try {
    prepared = await options.filesystem.prepareChangeSet(
      { action: "preview", changes },
      { sessionId: options.sessionId, workingDirectory: resolve(options.workingDirectory) }
    );
  } catch {
    return failure("plan", "path_conflict", "The filesystem mutations could not be prepared.");
  }

  const now = clock();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const plan: PlanDocument = {
    schemaVersion: 1,
    kind: "dev-agent.plan",
    planId: randomUUID(),
    createdAt,
    expiresAt,
    sessionId: options.sessionId,
    workspaceId: workspaceId(options.workingDirectory),
    changeSetId: prepared.review.changeSetId,
    executeInput: { action: "apply", changeSetId: prepared.review.changeSetId },
    mutations: changes.map(({ action, path }) => ({ action, path })),
    review: toPlanReview(prepared.review, options.workingDirectory),
  };

  let byPlan = bindings.get(options.filesystem as object);
  if (!byPlan) {
    byPlan = new Map();
    bindings.set(options.filesystem as object, byPlan);
  }
  byPlan.set(plan.planId, {
    sessionId: options.sessionId,
    workingDirectory: resolve(options.workingDirectory),
    planDigest: digestPlan(plan),
    state: "planned",
  });

  return {
    ok: true,
    command: "plan",
    plan,
    planId: plan.planId,
    changeSetId: plan.changeSetId,
    review: plan.review,
  };
}

export function loadPlan(input: string | unknown):
  | { readonly ok: true; readonly plan: PlanDocument }
  | { readonly ok: false; readonly error: PlanError } {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, error: { code: "invalid_json", message: "The plan document is not valid JSON." } };
    }
  }
  if (!isPlanDocument(value)) {
    return { ok: false, error: { code: "invalid_plan", message: "The plan document is invalid." } };
  }
  return { ok: true, plan: value };
}

export async function applyPlan(options: ApplyPlanOptions): Promise<PlanResult> {
  const loaded = loadPlan(options.plan);
  if (!loaded.ok) return { ok: false, command: "apply", error: loaded.error };
  const plan = loaded.plan;
  const clock = options.clock ?? (() => new Date());
  const now = clock().getTime();
  if (now >= Date.parse(plan.expiresAt)) {
    return failure("apply", "expired", "The plan has expired.");
  }
  if (plan.sessionId !== options.sessionId) {
    return failure("apply", "session_mismatch", "The plan belongs to a different session.");
  }
  if (plan.workspaceId !== workspaceId(options.workingDirectory)) {
    return failure("apply", "working_directory_mismatch", "The plan belongs to a different working directory.");
  }

  let binding = bindings.get(options.filesystem as object)?.get(plan.planId);
  let executeInput = plan.executeInput;
  if (binding && binding.planDigest !== digestPlan(plan)) {
    return failure("apply", "invalid_plan", "The plan document is invalid.");
  }
  if (binding?.state === "applied") {
    return failure("apply", "already_applied", "The plan has already been applied.");
  }
  if (binding && (binding.sessionId !== options.sessionId || binding.workingDirectory !== resolve(options.workingDirectory))) {
    return failure("apply", "working_directory_mismatch", "The plan binding does not match this workspace.");
  }

  // A plan is deliberately metadata-only, so a later CLI invocation must
  // supply the original mutation inputs to rebuild the in-memory change set.
  // Rebuilding the preview also re-checks the recorded preimage hashes before
  // anything is applied.
  if (!binding) {
    if (!options.changes) {
      return failure("apply", "change_set_unavailable", "The plan is not available for application.");
    }

    let changes: readonly FilesystemMutationInput[];
    try {
      changes = normalizeMutations(options.changes, options.workingDirectory);
    } catch {
      return failure("apply", "path_conflict", "The plan contains an invalid or conflicting path.");
    }
    if (!matchesPlanMutations(plan, changes)) {
      return failure("apply", "path_conflict", "The supplied changes do not match the planned mutations.");
    }

    let prepared: PreparedChangeSet;
    try {
      prepared = await options.filesystem.prepareChangeSet(
        { action: "preview", changes },
        { sessionId: options.sessionId, workingDirectory: resolve(options.workingDirectory) }
      );
    } catch {
      return failure("apply", "path_conflict", "The workspace no longer matches the planned guards.");
    }
    const review = toPlanReview(prepared.review, options.workingDirectory);
    if (!matchesPlanReview(plan.review, review)) {
      return failure("apply", "path_conflict", "The workspace no longer matches the planned guards.");
    }

    executeInput = prepared.executeInput;
    binding = {
      sessionId: options.sessionId,
      workingDirectory: resolve(options.workingDirectory),
      planDigest: digestPlan(plan),
      state: "planned",
    };
    let byPlan = bindings.get(options.filesystem as object);
    if (!byPlan) {
      byPlan = new Map();
      bindings.set(options.filesystem as object, byPlan);
    }
    byPlan.set(plan.planId, binding);
  }

  try {
    await options.filesystem.execute(
      executeInput,
      { sessionId: options.sessionId, workingDirectory: resolve(options.workingDirectory) }
    );
    binding!.state = "applied";
  } catch (error) {
    const code = classifyApplyError(error);
    return failure("apply", code, errorMessage(code));
  }

  return {
    ok: true,
    command: "apply",
    planId: plan.planId,
    changeSetId: plan.changeSetId,
    appliedAt: clock().toISOString(),
    files: plan.review.files.map(({ path, kind, beforeExists, afterExists }) => ({
      path,
      kind,
      beforeExists,
      afterExists,
    })),
    additions: plan.review.additions,
    deletions: plan.review.deletions,
  };
}

export function formatPlanResult(result: PlanResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function toPlanReview(review: ChangeSetReview, workingDirectory: string): PlanReview {
  return {
    changeSetId: review.changeSetId,
    files: review.files.map((file) => toPlanFileReview(file, workingDirectory)),
    additions: review.additions,
    deletions: review.deletions,
    createdAt: review.createdAt,
  };
}

function toPlanFileReview(file: ChangeSetFileReview, workingDirectory: string): PlanFileReview {
  const path = toReviewWorkspacePath(file.path, workingDirectory);
  return {
    path,
    kind: file.kind,
    ...(file.beforeHash ? { beforeHash: file.beforeHash } : {}),
    afterHash: file.afterHash,
    additions: file.additions,
    deletions: file.deletions,
    beforeExists: file.beforeExists,
    afterExists: file.afterExists,
  };
}

function normalizeMutations(
  changes: readonly FilesystemMutationInput[],
  workingDirectory: string
): readonly FilesystemMutationInput[] {
  if (!Array.isArray(changes)) throw new Error("invalid changes");
  return changes.map((change) => {
    if (!change || typeof change.path !== "string" || !change.action) throw new Error("invalid mutation");
    const path = toWorkspacePath(change.path, workingDirectory);
    return { ...change, path };
  });
}

function toReviewWorkspacePath(path: string, workingDirectory: string): string {
  if (isAbsolute(path) || win32.isAbsolute(path)) {
    const root = resolve(workingDirectory);
    const relativePath = relative(root, resolve(path)).replaceAll("\\", "/");
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../") || win32.isAbsolute(relativePath)) {
      throw new Error("review path outside workspace");
    }
    return relativePath;
  }
  return toWorkspacePath(path, workingDirectory);
}

function toWorkspacePath(path: string, workingDirectory: string): string {
  if (!path || isAbsolute(path) || win32.isAbsolute(path)) throw new Error("absolute path");
  const root = resolve(workingDirectory);
  const target = resolve(root, path);
  const relativePath = relative(root, target).replaceAll("\\", "/");
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../") || win32.isAbsolute(relativePath)) {
    throw new Error("path outside workspace");
  }
  return relativePath;
}

function workspaceId(workingDirectory: string): string {
  return createHash("sha256").update(resolve(workingDirectory)).digest("hex");
}

function digestPlan(plan: PlanDocument): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function isPlanDocument(value: unknown): value is PlanDocument {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<PlanDocument>;
  if (
    plan.schemaVersion !== 1 ||
    plan.kind !== "dev-agent.plan" ||
    typeof plan.planId !== "string" ||
    typeof plan.createdAt !== "string" ||
    typeof plan.expiresAt !== "string" ||
    typeof plan.sessionId !== "string" ||
    typeof plan.workspaceId !== "string" ||
    !/^[a-f0-9]{64}$/.test(plan.workspaceId) ||
    typeof plan.changeSetId !== "string" ||
    !plan.executeInput ||
    plan.executeInput.action !== "apply" ||
    plan.executeInput.changeSetId !== plan.changeSetId ||
    !Array.isArray(plan.mutations) ||
    !plan.review ||
    plan.review.changeSetId !== plan.changeSetId ||
    !Array.isArray(plan.review.files) ||
    Date.parse(plan.createdAt) !== Date.parse(plan.createdAt) ||
    Date.parse(plan.expiresAt) !== Date.parse(plan.expiresAt)
  ) {
    return false;
  }
  if (!plan.mutations.every((mutation) =>
    mutation &&
    ["write", "edit", "patch", "mkdir"].includes(mutation.action) &&
    typeof mutation.path === "string" &&
    !isAbsolute(mutation.path) &&
    !win32.isAbsolute(mutation.path) &&
    mutation.path !== ".." &&
    !mutation.path.startsWith("../")
  )) return false;
  return plan.review.files.every((file) =>
    file &&
    typeof file.path === "string" &&
    !isAbsolute(file.path) &&
    !win32.isAbsolute(file.path) &&
    file.path !== ".." &&
    !file.path.startsWith("../") &&
    (file.kind === "file" || file.kind === "directory") &&
    typeof file.afterHash === "string" &&
    Number.isInteger(file.additions) &&
    Number.isInteger(file.deletions) &&
    typeof file.beforeExists === "boolean" &&
    typeof file.afterExists === "boolean"
  );
}

function matchesPlanMutations(
  plan: PlanDocument,
  changes: readonly FilesystemMutationInput[]
): boolean {
  if (plan.mutations.length !== changes.length) return false;
  return plan.mutations.every((mutation, index) => {
    const change = changes[index];
    return change !== undefined && mutation.action === change.action && mutation.path === change.path;
  });
}

function matchesPlanReview(expected: PlanReview, actual: PlanReview): boolean {
  if (expected.additions !== actual.additions || expected.deletions !== actual.deletions) return false;
  if (expected.files.length !== actual.files.length) return false;
  return expected.files.every((file, index) => {
    const other = actual.files[index];
    return other !== undefined && (
      file.path === other.path &&
      file.kind === other.kind &&
      file.beforeHash === other.beforeHash &&
      file.afterHash === other.afterHash &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.beforeExists === other.beforeExists &&
      file.afterExists === other.afterExists
    );
  });
}

function classifyApplyError(error: unknown): PlanErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (/already been applied|state is applied/i.test(message)) return "already_applied";
  if (/preimage conflict|postimage conflict|expected .* but found|unknown or expired/i.test(message)) {
    return "path_conflict";
  }
  return "apply_failed";
}

function errorMessage(code: PlanErrorCode): string {
  switch (code) {
    case "already_applied": return "The plan has already been applied.";
    case "path_conflict": return "The workspace no longer matches the planned guards.";
    default: return "The plan could not be applied.";
  }
}

function failure(command: "plan" | "apply", code: PlanErrorCode, message: string): PlanFailure {
  return { ok: false, command, error: { code, message } };
}
