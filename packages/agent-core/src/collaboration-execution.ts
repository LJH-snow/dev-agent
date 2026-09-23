import { createHash, randomUUID } from "node:crypto";

import type { ModelProvider } from "@dev-agent/model";
import { denyDangerousPolicy, type ApprovalPolicy } from "./approval.js";
import type { CollaborationRole } from "./collaboration.js";
import { createAgentContext } from "./context.js";
import { AgentLoop, type AgentLoopOptions } from "./loop.js";
import { InMemoryMemory, type AgentMemory } from "./memory.js";
import type { ToolCollection } from "./tools.js";

const DEFAULT_MAX_PARALLEL = 3;
const MAX_PARALLEL = 8;
const DEFAULT_RETRY_LIMIT = 1;
const MAX_TASKS = 32;
const MAX_COLLABORATION_TASK_TOOLS = 256;
const MAX_TEXT_CHARS = 12_000;
const MAX_SUMMARY_CHARS = 4_000;

export type CollaborationTaskStatus =
  | "queued"
  | "blocked"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type CollaborationExecutionStatus =
  | "running"
  | "review"
  | "failed"
  | "cancelled";

export interface CollaborationTask {
  readonly id: string;
  readonly title: string;
  readonly instructions: string;
  readonly role?: string;
  readonly dependsOn?: readonly string[];
  /** Total attempts, including the first attempt. Defaults to retryLimit + 1. */
  readonly maxAttempts?: number;
}

export interface CollaborationTaskGraph {
  readonly tasks: readonly CollaborationTask[];
}

/**
 * User-reviewed per-task scopes bound to one exact normalized task graph.
 * Scope positions are caller-owned ordered slots, never planner task IDs.
 */
export interface ReviewedCollaborationToolScopes {
  readonly planFingerprint: string;
  readonly scopesByTaskIndex: readonly (readonly string[])[];
}

export interface CollaborationWorkspace {
  readonly id: string;
  readonly path: string;
  readonly mode: "worktree" | "changeset";
  readonly baseRevision?: string;
}

export interface CollaborationDiff {
  readonly changedFiles: readonly string[];
  readonly additions: number;
  readonly deletions: number;
  readonly summary?: string;
  readonly conflicts?: readonly string[];
}

export interface CollaborationValidation {
  readonly status: "passed" | "failed" | "blocked" | "skipped";
  readonly summary: string;
}

export interface CollaborationWorkspaceProvider {
  create(
    task: CollaborationTask,
    options: { readonly signal: AbortSignal },
  ): Promise<CollaborationWorkspace>;
  inspect(
    workspace: CollaborationWorkspace,
    options: { readonly signal: AbortSignal },
  ): Promise<CollaborationDiff>;
  validate?(
    workspace: CollaborationWorkspace,
    task: CollaborationTask,
    options: { readonly signal: AbortSignal },
  ): Promise<CollaborationValidation>;
  dispose(workspace: CollaborationWorkspace): Promise<void>;
  merge?(
    review: CollaborationReview,
    options: { readonly signal: AbortSignal },
  ): Promise<CollaborationMergeResult>;
}

export interface CollaborationTaskResult {
  readonly id: string;
  readonly title: string;
  readonly role?: string;
  readonly dependsOn: readonly string[];
  readonly status: CollaborationTaskStatus;
  readonly attempts: number;
  readonly durationMs: number;
  readonly text: string;
  readonly error?: string;
  readonly workspace?: CollaborationWorkspace;
  readonly diff?: CollaborationDiff;
  readonly validation?: CollaborationValidation;
}

export interface CollaborationReview {
  readonly status: "ready" | "blocked";
  readonly mergeable: boolean;
  readonly tasks: readonly CollaborationTaskResult[];
  readonly changedFiles: readonly string[];
  readonly additions: number;
  readonly deletions: number;
  readonly conflicts: readonly string[];
}

export interface CollaborationMergeResult {
  readonly status: "merged" | "conflict" | "failed";
  readonly summary: string;
  readonly conflicts?: readonly string[];
}

export type CollaborationExecutionEvent =
  | {
      readonly type: "execution.started";
      readonly taskIds: readonly string[];
    }
  | {
      readonly type: "plan.ready";
      readonly taskIds: readonly string[];
      readonly tasks: readonly CollaborationTask[];
    }
  | {
      readonly type: "task.queued" | "task.blocked" | "task.cancelled";
      readonly taskId: string;
      readonly detail?: string;
    }
  | {
      readonly type: "task.started";
      readonly taskId: string;
      readonly attempt: number;
      readonly workspace: CollaborationWorkspace;
    }
  | {
      readonly type: "task.retrying";
      readonly taskId: string;
      readonly attempt: number;
      readonly error: string;
    }
  | {
      readonly type: "task.completed";
      readonly taskId: string;
      readonly result: CollaborationTaskResult;
    }
  | {
      readonly type: "task.failed";
      readonly taskId: string;
      readonly result: CollaborationTaskResult;
    }
  | {
      readonly type: "review.ready";
      readonly review: CollaborationReview;
    }
  | {
      readonly type: "execution.completed";
      readonly status: CollaborationExecutionStatus;
    };

export interface CollaborativeExecutionOptions {
  readonly model: ModelProvider;
  readonly tools?: ToolCollection;
  /**
   * Caller-owned named role bindings. A task's role label may select only one
   * of these preconfigured bindings; its tools are further intersected with
   * the user-reviewed task scope and global tool ceiling.
   */
  readonly roleBindings?: readonly CollaborationRole[];
  /** Application-owned executor profile selection shared with worker loops. */
  readonly toolSandboxProfile?: AgentLoopOptions["toolSandboxProfile"];
  /** Application-owned, bounded sandbox expansion decision shared with workers. */
  readonly onSandboxExpansion?: AgentLoopOptions["onSandboxExpansion"];
  /**
   * Caller-owned tool policy. `task` may contain planner-generated fields;
   * never derive grants from its id, role, title, or instructions without an
   * independent user-authorized binding. The index is its slot in the exact
   * normalized graph. Each list narrows the supplied tools.
   */
  readonly toolAllowlistForTask?: (
    task: CollaborationTask,
    taskIndex: number,
  ) => readonly string[];
  /** Optional user-owned ceiling applied before any narrower task scopes. */
  readonly toolScopeCeiling?: readonly string[];
  /** Explicit user-reviewed scopes tied to the exact normalized graph. */
  readonly reviewedToolScopes?: ReviewedCollaborationToolScopes;
  readonly prompt: string;
  readonly tasks: readonly CollaborationTask[];
  readonly workspaceProvider: CollaborationWorkspaceProvider;
  readonly workingDirectory: string;
  readonly sessionId: string;
  readonly maxParallel?: number;
  readonly maxTurns?: number;
  readonly retryLimit?: number;
  readonly signal?: AbortSignal;
  readonly attachedContext?: string;
  readonly createMemory?: (task: CollaborationTask) => AgentMemory;
  readonly approval?: ApprovalPolicy;
  readonly onEvent?: (event: CollaborationExecutionEvent) => void;
}

export interface CollaborationTaskPlanningOptions {
  readonly model: ModelProvider;
  readonly signal?: AbortSignal;
  readonly maxTasks?: number;
}

export interface CollaborationExecutionResult {
  readonly prompt: string;
  readonly plan: readonly CollaborationTask[];
  readonly status: CollaborationExecutionStatus;
  readonly tasks: readonly CollaborationTaskResult[];
  readonly review: CollaborationReview;
}

export interface CollaborationExecutionHandle {
  readonly promise: Promise<CollaborationExecutionResult>;
  cancel(reason?: string): void;
  cancelTask(taskId: string, reason?: string): boolean;
}

/**
 * Asks the selected model for a small JSON task graph. Invalid or
 * non-structured planner output falls back to a deterministic graph rather
 * than preventing the user from starting an execution review.
 */
export async function planCollaborativeTasks(
  prompt: string,
  options: CollaborationTaskPlanningOptions,
): Promise<readonly CollaborationTask[]> {
  if (options.signal?.aborted) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error("collaboration task planning was interrupted");
  }
  const maxTasks = normalizePositive(options.maxTasks, 8, "maxTasks", MAX_TASKS);
  try {
    const completion = await options.model.chat(
      [
        {
          role: "system",
          content: [
            "COLLABORATIVE TASK PLANNER",
            "Break the request into at most " + maxTasks + " independently reviewable coding tasks.",
            "Identify dependencies explicitly so independent tasks can run in parallel.",
            "Return JSON only with this shape: {\"tasks\":[{\"id\":\"safe-id\",\"title\":\"short title\",\"role\":\"architect|coder|tester|reviewer\",\"instructions\":\"concrete work\",\"dependsOn\":[\"other-id\"],\"maxAttempts\":1}]}",
            "Do not include markdown, secrets, absolute paths, hidden reasoning, or commentary outside the JSON.",
          ].join("\n"),
        },
        {
          role: "user",
          content: truncate(prompt, MAX_TEXT_CHARS),
        },
      ],
      {
        signal: options.signal,
        temperature: 0,
        maxTokens: 4_000,
      },
    );
    const parsed = parseTaskPlan(completion.content);
    if (parsed.length > 0) {
      return createCollaborationTaskGraph(parsed.slice(0, maxTasks)).tasks;
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }
  }
  return fallbackCollaborativeTasks(prompt).slice(0, maxTasks);
}

export function createCollaborationTaskGraph(
  tasks: readonly CollaborationTask[],
): CollaborationTaskGraph {
  if (tasks.length === 0) {
    throw new Error("collaboration task graph must contain at least one task");
  }
  if (tasks.length > MAX_TASKS) {
    throw new Error(`collaboration task graph cannot contain more than ${MAX_TASKS} tasks`);
  }

  const normalized = tasks.map(normalizeTask);
  const ids = new Set<string>();
  for (const task of normalized) {
    if (ids.has(task.id)) {
      throw new Error(`duplicate collaboration task id: ${task.id}`);
    }
    ids.add(task.id);
  }

  for (const task of normalized) {
    for (const dependency of task.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        throw new Error(`unknown dependency: ${dependency}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(normalized.map((task) => [task.id, task]));
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new Error(`collaboration task dependency cycle includes ${id}`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of normalized) visit(task.id);

  return { tasks: normalized };
}

/**
 * Fingerprints every normalized task and dependency edge in original plan
 * order. This is a binding/check, not an authorization source: callers still
 * have to obtain the scopes independently from the user or another trusted
 * policy boundary.
 */
export function fingerprintCollaborationTaskGraph(
  tasks: readonly CollaborationTask[],
): string {
  const normalized = createCollaborationTaskGraph(tasks).tasks;
  const canonicalPlan = normalized.map((task) => [
    task.id,
    task.title,
    task.role ?? null,
    task.instructions,
    [...(task.dependsOn ?? [])],
    task.maxAttempts ?? null,
  ]);
  return createHash("sha256")
    .update(`dev-agent-collaboration-plan-v1\n${JSON.stringify(canonicalPlan)}`, "utf8")
    .digest("hex");
}

function parseTaskPlan(content: string): CollaborationTask[] {
  const json = extractJson(content);
  if (json === undefined) return [];
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  const rawTasks = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.tasks)
      ? value.tasks
      : [];
  return rawTasks
    .filter(isRecord)
    .map((task) => ({
      id: typeof task.id === "string" ? task.id : "",
      title: typeof task.title === "string" ? task.title : "",
      role: typeof task.role === "string" ? task.role : undefined,
      instructions: typeof task.instructions === "string" ? task.instructions : "",
      dependsOn: Array.isArray(task.dependsOn)
        ? task.dependsOn.filter((value): value is string => typeof value === "string")
        : undefined,
      maxAttempts: typeof task.maxAttempts === "number" ? task.maxAttempts : undefined,
    }))
    .filter((task) => task.id.trim() !== "" && task.title.trim() !== "" && task.instructions.trim() !== "");
}

function fallbackCollaborativeTasks(prompt: string): readonly CollaborationTask[] {
  const request = truncate(prompt, 2_000);
  return [
    {
      id: "analysis",
      title: "Analyze the request",
      role: "architect",
      instructions: `Inspect the workspace and define the smallest safe implementation boundary for: ${request}`,
    },
    {
      id: "implementation",
      title: "Implement the core change",
      role: "coder",
      instructions: "Implement the requested change using the analysis as the execution contract.",
      dependsOn: ["analysis"],
    },
    {
      id: "tests",
      title: "Add focused verification",
      role: "tester",
      instructions: "Add or update focused tests and run the smallest useful verification for the request.",
      dependsOn: ["analysis"],
    },
    {
      id: "review",
      title: "Review the combined result",
      role: "reviewer",
      instructions: "Inspect the implementation and tests, identify regressions, and make only targeted fixes if needed.",
      dependsOn: ["implementation", "tests"],
    },
  ];
}

export function createCollaborativeExecution(
  options: CollaborativeExecutionOptions,
): CollaborationExecutionHandle {
  const graph = createCollaborationTaskGraph(options.tasks);
  const roleBindings = indexCollaborationRoleBindings(options.roleBindings ?? []);
  const roleByTaskId = new Map<string, CollaborationRole | undefined>();
  for (const task of graph.tasks) {
    const roleId = task.role?.trim().toLowerCase();
    roleByTaskId.set(task.id, roleId === undefined ? undefined : roleBindings.get(roleId));
  }
  const maxParallel = normalizePositive(
    options.maxParallel,
    DEFAULT_MAX_PARALLEL,
    "maxParallel",
    MAX_PARALLEL,
  );
  const retryLimit = normalizePositive(options.retryLimit, DEFAULT_RETRY_LIMIT, "retryLimit", 4);
  if (
    options.reviewedToolScopes !== undefined &&
    options.toolAllowlistForTask !== undefined
  ) {
    throw new Error("reviewed tool scopes cannot be combined with a task scope resolver");
  }
  if (options.reviewedToolScopes !== undefined) {
    const reviewed = options.reviewedToolScopes;
    if (!/^[a-f0-9]{64}$/u.test(reviewed.planFingerprint)) {
      throw new Error("reviewed tool scopes contain an invalid plan fingerprint");
    }
    if (reviewed.planFingerprint !== fingerprintCollaborationTaskGraph(graph.tasks)) {
      throw new Error("reviewed tool scopes do not match the normalized collaboration plan");
    }
    if (
      !Array.isArray(reviewed.scopesByTaskIndex) ||
      reviewed.scopesByTaskIndex.length !== graph.tasks.length
    ) {
      throw new Error("reviewed tool scopes do not cover the complete collaboration plan");
    }
    for (const [taskIndex, taskScope] of reviewed.scopesByTaskIndex.entries()) {
      if (!Array.isArray(taskScope)) {
        throw new Error(`reviewed tool scopes are missing ordered task slot ${taskIndex + 1}`);
      }
    }
  }

  // Resolve and validate the ceiling and every task scope synchronously before
  // any workspace is created. Planner data can describe tasks, but cannot
  // select tools or bind a reviewed scope to a task.
  const ceilingTools = options.toolScopeCeiling === undefined
    ? undefined
    : createTaskToolCollection(options.tools, options.toolScopeCeiling, "global ceiling");
  const ceilingNames = options.toolScopeCeiling === undefined
    ? undefined
    : new Set(options.toolScopeCeiling);
  const taskTools = new Map<string, ToolCollection | undefined>();
  for (const [taskIndex, task] of graph.tasks.entries()) {
    const allowlist = options.reviewedToolScopes?.scopesByTaskIndex[taskIndex] ??
      options.toolAllowlistForTask?.(task, taskIndex) ??
      options.toolScopeCeiling;
    if (allowlist === undefined) {
      taskTools.set(task.id, options.tools);
      continue;
    }
    if (!Array.isArray(allowlist)) {
      throw new Error(`tool allowlist for task "${task.id}" must be an array`);
    }
    if (ceilingNames !== undefined && allowlist.some((name) => !ceilingNames.has(name))) {
      throw new Error(`tool allowlist for task "${task.id}" exceeds the configured global ceiling`);
    }
    taskTools.set(
      task.id,
      createTaskToolCollection(ceilingTools ?? options.tools, allowlist, task.id),
    );
  }
  const overallController = new AbortController();
  const taskControllers = new Map<string, AbortController>();
  const cancelledTasks = new Map<string, string>();
  const taskResults = new Map<string, CollaborationTaskResult>();
  const running = new Map<string, Promise<void>>();
  const onEvent = options.onEvent;

  if (options.signal) {
    if (options.signal.aborted) {
      overallController.abort(options.signal.reason);
    } else {
      options.signal.addEventListener(
        "abort",
        () => overallController.abort(options.signal?.reason),
        { once: true },
      );
    }
  }

  const cancelTask = (taskId: string, reason = "task cancelled"): boolean => {
    const task = graph.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return false;
    const current = taskResults.get(taskId);
    if (current && isTerminal(current.status)) return false;
    const detail = sanitizeDetail(reason);
    cancelledTasks.set(taskId, detail);
    taskControllers.get(taskId)?.abort(new Error(sanitizeDetail(reason)));
    if (!current || current.status === "queued" || current.status === "retrying") {
      taskResults.set(taskId, {
        ...createQueuedResult(task, current?.attempts ?? 0),
        status: "cancelled",
        error: detail,
      });
      emit({
        type: "task.cancelled",
        taskId,
        detail,
      });
    }
    return true;
  };

  const cancel = (reason = "collaboration cancelled"): void => {
    overallController.abort(new Error(sanitizeDetail(reason)));
    for (const task of graph.tasks) {
      if (!isTerminal(taskResults.get(task.id)?.status)) {
        cancelTask(task.id, reason);
      }
    }
  };

  const promise = execute();
  return { promise, cancel, cancelTask };

  async function execute(): Promise<CollaborationExecutionResult> {
    emit({
      type: "execution.started",
      taskIds: graph.tasks.map((task) => task.id),
    });
    emit({
      type: "plan.ready",
      taskIds: graph.tasks.map((task) => task.id),
      tasks: graph.tasks,
    });
    for (const task of graph.tasks) {
      taskResults.set(task.id, createQueuedResult(task));
      emit({ type: "task.queued", taskId: task.id });
    }

    while (true) {
      if (overallController.signal.aborted) {
        for (const task of graph.tasks) {
          const result = taskResults.get(task.id);
          if (result && !isTerminal(result.status)) {
            markCancelled(task, cancelledTasks.get(task.id) ?? "collaboration cancelled");
          }
        }
      }

      markBlockedTasks();
      launchReadyTasks();

      if (running.size > 0) {
        await Promise.race(running.values());
        continue;
      }

      if (graph.tasks.every((task) => isTerminal(taskResults.get(task.id)?.status))) {
        break;
      }

      // The only remaining non-terminal tasks have unsatisfied dependencies.
      for (const task of graph.tasks) {
        if (!isTerminal(taskResults.get(task.id)?.status)) {
          markBlocked(task, "dependency did not complete");
        }
      }
    }

    const tasks = graph.tasks.map((task) => taskResults.get(task.id) ?? createQueuedResult(task));
    const review = buildReview(tasks);
      const status: CollaborationExecutionStatus =
      overallController.signal.aborted
        ? "cancelled"
        : tasks.some((task) =>
            task.status === "failed" ||
            task.status === "blocked" ||
            task.status === "cancelled"
          )
          ? "failed"
          : "review";
    onEvent?.({ type: "review.ready", review });
    emit({ type: "execution.completed", status });
    return {
      prompt: options.prompt,
      plan: graph.tasks,
      status,
      tasks,
      review,
    };
  }

  function launchReadyTasks(): void {
    if (overallController.signal.aborted) return;
    for (const task of graph.tasks) {
      if (running.size >= maxParallel) return;
      const result = taskResults.get(task.id);
      if (!result || result.status !== "queued") continue;
      if (cancelledTasks.has(task.id)) continue;
      if (!dependenciesCompleted(task)) continue;
      const work = runTask(task);
      running.set(task.id, work);
      void work;
    }
  }

  async function runTask(task: CollaborationTask): Promise<void> {
    const startedAt = Date.now();
    const attemptsAllowed = task.maxAttempts ?? retryLimit + 1;
    let attempt = taskResults.get(task.id)?.attempts ?? 0;
    const controller = new AbortController();
    taskControllers.set(task.id, controller);
    const onOverallAbort = (): void => controller.abort(overallController.signal.reason);
    if (overallController.signal.aborted) {
      controller.abort(overallController.signal.reason);
    } else {
      overallController.signal.addEventListener("abort", onOverallAbort, { once: true });
    }

    try {
      while (attempt < attemptsAllowed) {
        if (cancelledTasks.has(task.id) || overallController.signal.aborted) {
          markCancelled(task, cancelledTasks.get(task.id) ?? "collaboration cancelled", attempt, startedAt);
          return;
        }
        attempt += 1;
        let workspace: CollaborationWorkspace | undefined;
        try {
          workspace = await options.workspaceProvider.create(task, {
            signal: controller.signal,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (controller.signal.aborted || cancelledTasks.has(task.id)) {
            markCancelled(task, cancelledTasks.get(task.id) ?? message, attempt, startedAt);
            return;
          }
          if (attempt < attemptsAllowed) {
            taskResults.set(task.id, {
              ...createQueuedResult(task),
              status: "retrying",
              attempts: attempt,
              durationMs: Math.max(0, Date.now() - startedAt),
              error: truncate(message),
            });
            emit({
              type: "task.retrying",
              taskId: task.id,
              attempt,
              error: truncate(message),
            });
            taskResults.set(task.id, createQueuedResult(task, attempt));
            continue;
          }
          const failed: CollaborationTaskResult = {
            ...createQueuedResult(task),
            status: "failed",
            attempts: attempt,
            durationMs: Math.max(0, Date.now() - startedAt),
            error: truncate(message),
          };
          taskResults.set(task.id, failed);
          emit({ type: "task.failed", taskId: task.id, result: failed });
          return;
        }
        taskResults.set(task.id, {
          ...createQueuedResult(task),
          status: "running",
          attempts: attempt,
          durationMs: Math.max(0, Date.now() - startedAt),
          workspace,
        });
        emit({
          type: "task.started",
          taskId: task.id,
          attempt,
          workspace,
        });

        try {
          const memory = options.createMemory?.(task) ?? new InMemoryMemory();
          const roleBinding = roleByTaskId.get(task.id);
          const scopedTools = taskTools.get(task.id);
          const workerTools = roleBinding?.tools === undefined
            ? scopedTools
            : intersectTaskTools(scopedTools ?? options.tools, roleBinding.tools, task.id);
          const loop = new AgentLoop({
            model: roleBinding?.model ?? options.model,
            ...(roleBinding?.instructions === undefined ? {} : { systemPrompt: roleBinding.instructions }),
            tools: workerTools,
            ...(roleBinding?.budget === undefined ? {} : { budget: roleBinding.budget }),
            ...(options.toolSandboxProfile === undefined
              ? {}
              : { toolSandboxProfile: options.toolSandboxProfile }),
            ...(options.onSandboxExpansion === undefined
              ? {}
              : { onSandboxExpansion: options.onSandboxExpansion }),
            maxTurns: roleBinding?.budget?.maxTurns ?? options.maxTurns ?? 8,
            approval: options.approval ?? denyDangerousPolicy(),
          });
          const context = createAgentContext(
            `${options.sessionId}-${safeId(task.id)}-${randomUUID().slice(0, 8)}`,
            memory,
            {
              sessionId: `${options.sessionId}-${safeId(task.id)}`,
              workingDirectory: workspace.path,
              metadata: {
                collaborationTaskId: task.id,
                collaborationRole: task.role ?? "worker",
              },
            },
          );
          const result = await loop.run(
            context,
            buildTaskPrompt(options.prompt, task),
            {
              mode: "normal",
              signal: controller.signal,
              ...(options.attachedContext === undefined
                ? {}
                : { attachedContext: options.attachedContext }),
              runId: `${options.sessionId}-${safeId(task.id)}-${attempt}`,
            },
          );
          if (result.state.status === "error") {
            throw new Error(result.state.lastError ?? "task agent failed");
          }
          const diff = await options.workspaceProvider.inspect(workspace, {
            signal: controller.signal,
          });
          const validation = options.workspaceProvider.validate === undefined
            ? undefined
            : await options.workspaceProvider.validate(workspace, task, {
                signal: controller.signal,
              });
          const completed: CollaborationTaskResult = {
            ...createQueuedResult(task),
            status: "completed",
            attempts: attempt,
            durationMs: Math.max(0, Date.now() - startedAt),
            text: await latestAssistantText(memory),
            workspace,
            diff,
            ...(validation === undefined ? {} : { validation }),
          };
          taskResults.set(task.id, completed);
          emit({ type: "task.completed", taskId: task.id, result: completed });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (controller.signal.aborted || cancelledTasks.has(task.id)) {
            await disposeAfterCancellation(workspace);
            markCancelled(task, cancelledTasks.get(task.id) ?? message, attempt, startedAt);
            return;
          }
          await disposeAfterFailure(workspace);
          if (attempt < attemptsAllowed) {
            taskResults.set(task.id, {
              ...createQueuedResult(task),
              status: "retrying",
              attempts: attempt,
              durationMs: Math.max(0, Date.now() - startedAt),
              error: truncate(message),
            });
            emit({
              type: "task.retrying",
              taskId: task.id,
              attempt,
              error: truncate(message),
            });
            taskResults.set(task.id, createQueuedResult(task, attempt));
            continue;
          }
          const failed: CollaborationTaskResult = {
            ...createQueuedResult(task),
            status: "failed",
            attempts: attempt,
            durationMs: Math.max(0, Date.now() - startedAt),
            error: truncate(message),
          };
          taskResults.set(task.id, failed);
          emit({ type: "task.failed", taskId: task.id, result: failed });
          return;
        }
      }
    } finally {
      overallController.signal.removeEventListener("abort", onOverallAbort);
      taskControllers.delete(task.id);
      running.delete(task.id);
    }
  }

  function markBlockedTasks(): void {
    for (const task of graph.tasks) {
      const result = taskResults.get(task.id);
      if (!result || isTerminal(result.status) || result.status === "running") continue;
      const failedDependency = (task.dependsOn ?? []).find((dependency) => {
        const dependencyResult = taskResults.get(dependency);
        return dependencyResult?.status === "failed" ||
          dependencyResult?.status === "blocked" ||
          dependencyResult?.status === "cancelled";
      });
      if (failedDependency) {
        markBlocked(task, `dependency failed: ${failedDependency}`);
      }
    }
  }

  function markBlocked(task: CollaborationTask, detail: string): void {
    const current = taskResults.get(task.id);
    if (current && isTerminal(current.status)) return;
    const blocked: CollaborationTaskResult = {
      ...createQueuedResult(task),
      status: "blocked",
      error: truncate(detail),
    };
    taskResults.set(task.id, blocked);
    emit({ type: "task.blocked", taskId: task.id, detail: truncate(detail) });
  }

  function markCancelled(
    task: CollaborationTask,
    detail: string,
    attempts = taskResults.get(task.id)?.attempts ?? 0,
    startedAt?: number,
  ): void {
    const current = taskResults.get(task.id);
    if (current?.status === "cancelled") return;
    const cancelled: CollaborationTaskResult = {
      ...createQueuedResult(task),
      status: "cancelled",
      attempts,
      durationMs: startedAt === undefined
        ? current?.durationMs ?? 0
        : Math.max(0, Date.now() - startedAt),
      error: truncate(detail),
      ...(current?.workspace === undefined ? {} : { workspace: current.workspace }),
    };
    taskResults.set(task.id, cancelled);
    emit({ type: "task.cancelled", taskId: task.id, detail: truncate(detail) });
  }

  function dependenciesCompleted(task: CollaborationTask): boolean {
    return (task.dependsOn ?? []).every(
      (dependency) => taskResults.get(dependency)?.status === "completed",
    );
  }

  function buildReview(tasks: readonly CollaborationTaskResult[]): CollaborationReview {
    const changedFiles = new Set<string>();
    let additions = 0;
    let deletions = 0;
    const conflicts = new Set<string>();
    for (const task of tasks) {
      for (const file of task.diff?.changedFiles ?? []) changedFiles.add(file);
      additions += task.diff?.additions ?? 0;
      deletions += task.diff?.deletions ?? 0;
      for (const conflict of task.diff?.conflicts ?? []) conflicts.add(conflict);
    }
    const mergeable = tasks.every((task) => task.status === "completed") &&
      conflicts.size === 0;
    return {
      status: mergeable ? "ready" : "blocked",
      mergeable,
      tasks,
      changedFiles: [...changedFiles].sort(),
      additions,
      deletions,
      conflicts: [...conflicts].sort(),
    };
  }

  function emit(event: CollaborationExecutionEvent): void {
    onEvent?.(event);
  }

  async function disposeAfterFailure(workspace: CollaborationWorkspace): Promise<void> {
    try {
      await options.workspaceProvider.dispose(workspace);
    } catch {
      // Cleanup failure is retained as task failure metadata, not allowed to
      // mask the model/tool error that caused the task to fail.
    }
  }

  async function disposeAfterCancellation(workspace: CollaborationWorkspace): Promise<void> {
    try {
      await options.workspaceProvider.dispose(workspace);
    } catch {
      // Best-effort cleanup on cancellation.
    }
  }
}

export async function runCollaborativeExecution(
  prompt: string,
  options: Omit<CollaborativeExecutionOptions, "prompt">,
): Promise<CollaborationExecutionResult> {
  return createCollaborativeExecution({ ...options, prompt }).promise;
}

function indexCollaborationRoleBindings(
  roles: readonly CollaborationRole[],
): ReadonlyMap<string, CollaborationRole> {
  const bindings = new Map<string, CollaborationRole>();
  for (const role of roles) {
    if (!/^[a-z][a-z0-9_-]{0,47}$/u.test(role.id) || role.id !== role.id.trim()) {
      throw new Error("collaboration role binding has an invalid id");
    }
    if (bindings.has(role.id)) {
      throw new Error(`collaboration role binding duplicates role: ${role.id}`);
    }
    if (typeof role.instructions !== "string" || role.instructions.trim() === "" || role.instructions.length > MAX_TEXT_CHARS) {
      throw new Error(`collaboration role ${role.id} has invalid instructions`);
    }
    bindings.set(role.id, role);
  }
  return bindings;
}

function intersectTaskTools(
  taskTools: ToolCollection | undefined,
  roleTools: ToolCollection,
  taskId: string,
): ToolCollection {
  if (taskTools === undefined) return roleTools;
  const roleNames = new Set(roleTools.list().map((tool) => tool.name));
  const names = taskTools.list()
    .map((tool) => tool.name)
    .filter((name) => roleNames.has(name));
  return createTaskToolCollection(taskTools, names, taskId);
}

function createTaskToolCollection(
  tools: ToolCollection | undefined,
  allowlist: readonly string[],
  taskId: string,
): ToolCollection {
  if (!Array.isArray(allowlist)) {
    throw new Error(`tool allowlist for task "${taskId}" must be an array`);
  }
  if (allowlist.length > MAX_COLLABORATION_TASK_TOOLS) {
    throw new Error(
      `tool allowlist for task "${taskId}" exceeds ${MAX_COLLABORATION_TASK_TOOLS} entries`,
    );
  }

  const available = new Map((tools?.list() ?? []).map((tool) => [tool.name, tool]));
  const selected = new Map<string, NonNullable<ReturnType<ToolCollection["get"]>>>();
  for (const candidate of allowlist as readonly unknown[]) {
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.trim() !== candidate) {
      throw new Error(`tool allowlist for task "${taskId}" contains an invalid tool name`);
    }
    if (selected.has(candidate)) {
      throw new Error(`tool allowlist for task "${taskId}" contains a duplicate tool name`);
    }
    const listedTool = available.get(candidate);
    const registeredTool = tools?.get(candidate);
    if (listedTool === undefined || registeredTool === undefined) {
      throw new Error(`tool allowlist for task "${taskId}" references an unavailable tool`);
    }
    selected.set(candidate, registeredTool);
  }

  return {
    list: () => [...selected.values()],
    get: (name) => selected.get(name),
    metadata: (name) => selected.has(name) ? tools?.metadata?.(name) : undefined,
  };
}

function normalizeTask(task: CollaborationTask): CollaborationTask {
  const id = task.id.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,47}$/u.test(id)) {
    throw new Error(`invalid collaboration task id: ${task.id}`);
  }
  const title = task.title.trim();
  if (title === "") throw new Error(`collaboration task ${id} requires a title`);
  const instructions = task.instructions.trim();
  if (instructions === "") {
    throw new Error(`collaboration task ${id} requires instructions`);
  }
  const dependencies = [...new Set((task.dependsOn ?? []).map((value) => value.trim().toLowerCase()))];
  const maxAttempts = task.maxAttempts;
  if (
    maxAttempts !== undefined &&
    (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5)
  ) {
    throw new Error(`collaboration task ${id} maxAttempts must be between 1 and 5`);
  }
  return {
    id,
    title: truncate(title, 160),
    instructions: truncate(instructions, MAX_TEXT_CHARS),
    ...(task.role?.trim() ? { role: truncate(task.role.trim(), 80) } : {}),
    ...(dependencies.length > 0 ? { dependsOn: dependencies } : {}),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  };
}

function createQueuedResult(task: CollaborationTask, attempts = 0): CollaborationTaskResult {
  return {
    id: task.id,
    title: task.title,
    ...(task.role === undefined ? {} : { role: task.role }),
    dependsOn: [...(task.dependsOn ?? [])],
    status: "queued",
    attempts,
    durationMs: 0,
    text: "",
  };
}

function buildTaskPrompt(prompt: string, task: CollaborationTask): string {
  return [
    `COLLABORATIVE EXECUTION REQUEST`,
    `Original request: ${truncate(prompt, MAX_TEXT_CHARS)}`,
    `TASK ID: ${task.id}`,
    `TASK TITLE: ${task.title}`,
    `TASK ROLE: ${task.role ?? "worker"}`,
    `TASK DEPENDENCIES: ${(task.dependsOn ?? []).join(", ") || "none"}`,
    "",
    task.instructions,
    "",
    "Work only inside the provided task workspace. Make the requested changes, run focused checks when useful, and finish with a concise summary of changes and checks.",
  ].join("\n");
}

async function latestAssistantText(memory: AgentMemory): Promise<string> {
  const entries = await memory.entries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.role === "assistant" &&
      entry.content.trim() !== "" &&
      !entry.content.trimStart().startsWith("[error]")
    ) {
      return truncate(entry.content, MAX_TEXT_CHARS);
    }
  }
  return "";
}

function normalizePositive(
  value: number | undefined,
  fallback: number,
  name: string,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Math.min(value, max);
}

function isTerminal(status: CollaborationTaskStatus | undefined): boolean {
  return status === "completed" ||
    status === "failed" ||
    status === "blocked" ||
    status === "cancelled";
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractJson(value: string): string | undefined {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const firstObject = trimmed.indexOf("{");
  const firstArray = trimmed.indexOf("[");
  const starts = [firstObject, firstArray].filter((index) => index >= 0);
  const start = starts.length === 0 ? -1 : Math.min(...starts);
  if (start < 0) return undefined;
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (end <= start) return undefined;
  return trimmed.slice(start, end + 1);
}

function sanitizeDetail(value: string): string {
  return truncate(value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() || "cancelled", 240);
}

function truncate(value: string, limit = MAX_SUMMARY_CHARS): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}
