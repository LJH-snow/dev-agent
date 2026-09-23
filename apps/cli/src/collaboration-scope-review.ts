import {
  createCollaborationTaskGraph,
  fingerprintCollaborationTaskGraph,
  type CollaborationTask,
  type ReviewedCollaborationToolScopes,
} from "@dev-agent/agent-core";
import {
  parseCollaborationToolSelection,
  type CollaborationToolChoice,
} from "./collaboration-authorization.js";
import { redactSensitiveText, sanitizeTerminalText } from "./tui-renderer.js";

const MAX_REVIEWED_TASKS = 8;
const MAX_AVAILABLE_TOOLS = 256;
const MAX_TOOLS_PER_TASK = 256;
const MAX_TOOL_NAME_CHARS = 128;
const MAX_SCOPE_ANSWER_CHARS = 32_768;
const MAX_INVALID_SELECTIONS = 5;
const MAX_REVIEW_PROMPT_CHARS = 128 * 1024;
const MAX_RETRY_DIAGNOSTIC_CHARS = 256;

export type ScopeReviewAsk = (
  prompt: string,
  signal?: AbortSignal,
  mode?: "text" | "confirmation",
) => Promise<string>;

export type CollaborationScopeReviewResult =
  | {
      readonly status: "confirmed";
      /** Immutable exact normalized plan to pass to Agent Core. */
      readonly tasks: readonly CollaborationTask[];
      /** User choices indexed by ordered task slot and tied to the plan hash. */
      readonly reviewedToolScopes: ReviewedCollaborationToolScopes;
    }
  | { readonly status: "cancelled" };

export class CollaborationScopeReviewCancelledError extends Error {
  constructor() {
    super("collaborative tool-scope review was cancelled before any task workspace was created");
    this.name = "CollaborationScopeReviewCancelledError";
  }
}

/**
 * Collects a user-authorized tool list for every task in one immutable,
 * normalized plan. Planner IDs are display labels only; scope entries bind to
 * ordered plan slots and the complete normalized-plan fingerprint.
 */
export async function reviewCollaborationTaskToolScopes(options: {
  readonly tasks: readonly CollaborationTask[];
  readonly availableToolNames: readonly string[];
  readonly ask: ScopeReviewAsk;
  readonly signal?: AbortSignal;
}): Promise<CollaborationScopeReviewResult> {
  const graph = createCollaborationTaskGraph(options.tasks);
  const tasks = freezeTaskSnapshot(graph.tasks);
  if (tasks.length > MAX_REVIEWED_TASKS) {
    throw new Error(`tool-scope review supports at most ${MAX_REVIEWED_TASKS} tasks`);
  }

  const toolNames = validateAvailableTools(options.availableToolNames);
  const knownTools = new Set(toolNames);
  const planFingerprint = fingerprintCollaborationTaskGraph(tasks);
  const scopesByTaskIndex: Array<readonly string[]> = [];

  // Fail before soliciting any grants if the exact full-plan confirmation would
  // exceed the bounded interactive review surface. Never truncate task data.
  const choicePrompts = tasks.map((task, index) =>
    formatTaskScopePrompt(task, index, tasks, toolNames),
  );
  const maximumSummary = formatScopeConfirmation(
    tasks,
    tasks.map(() => toolNames),
    planFingerprint,
  );
  const initialPromptChars = choicePrompts.reduce((total, prompt) => total + prompt.length, 0);
  // An invalid answer can cause up to four additional prompts for that task.
  // Include the repeated full task details and a bounded diagnostic allowance
  // so the aggregate interactive surface cannot grow beyond the cap.
  const retryCount = MAX_INVALID_SELECTIONS - 1;
  const retryReserve = retryCount * (
    initialPromptChars + tasks.length * MAX_RETRY_DIAGNOSTIC_CHARS
  );
  const totalPromptChars = initialPromptChars + maximumSummary.length + retryReserve;
  if (totalPromptChars > MAX_REVIEW_PROMPT_CHARS) {
    throw new Error(
      "normalized plan and available tool list exceed the safe review limit; no task workspace was created",
    );
  }

  for (const [index, task] of tasks.entries()) {
    let invalidSelectionCount = 0;
    let validationMessage: string | undefined;
    for (;;) {
      throwIfAborted(options.signal);
      const answer = await askWithAbort(
        options.ask,
        validationMessage === undefined
          ? choicePrompts[index]!
          : formatTaskScopePrompt(task, index, tasks, toolNames, validationMessage),
        options.signal,
        "text",
      );
      const parsed = parseToolScopeAnswer(answer, toolNames, knownTools);
      if (parsed.status === "cancelled") {
        return { status: "cancelled" };
      }
      if (parsed.status === "invalid") {
        invalidSelectionCount += 1;
        if (invalidSelectionCount >= MAX_INVALID_SELECTIONS) {
          throw new Error("too many invalid tool-scope selections; no task workspace was created");
        }
        validationMessage = parsed.message;
        continue;
      }
      scopesByTaskIndex.push(Object.freeze([...parsed.toolNames]));
      break;
    }
  }

  const confirmation = await askWithAbort(
    options.ask,
    formatScopeConfirmation(tasks, scopesByTaskIndex, planFingerprint),
    options.signal,
    "confirmation",
  );
  const normalizedConfirmation = confirmation.trim().toLowerCase();
  if (normalizedConfirmation !== "y" && normalizedConfirmation !== "yes") {
    return { status: "cancelled" };
  }

  return {
    status: "confirmed",
    tasks,
    reviewedToolScopes: Object.freeze({
      planFingerprint,
      scopesByTaskIndex: Object.freeze([...scopesByTaskIndex]),
    }),
  };
}

function freezeTaskSnapshot(tasks: readonly CollaborationTask[]): readonly CollaborationTask[] {
  return Object.freeze(tasks.map((task) => Object.freeze({
    ...task,
    ...(task.dependsOn === undefined
      ? {}
      : { dependsOn: Object.freeze([...task.dependsOn]) }),
  })));
}

function validateAvailableTools(names: readonly string[]): readonly string[] {
  if (!Array.isArray(names) || names.length > MAX_AVAILABLE_TOOLS) {
    throw new Error(
      `tool-scope review supports at most ${MAX_AVAILABLE_TOOLS} available tools; configure a smaller collaboration.toolAllowlist`,
    );
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > MAX_TOOL_NAME_CHARS ||
      name.trim() !== name ||
      name.includes(",") ||
      /[\r\n]/u.test(name) ||
      safeDisplay(name) !== name
    ) {
      throw new Error("tool-scope review received a tool name that cannot be safely selected and displayed");
    }
    if (seen.has(name)) {
      throw new Error("tool-scope review received duplicate active tool names");
    }
    seen.add(name);
  }
  return Object.freeze([...names]);
}

function parseToolScopeAnswer(
  answer: string,
  availableToolNames: readonly string[],
  knownTools: ReadonlySet<string>,
):
  | { readonly status: "valid"; readonly toolNames: readonly string[] }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "cancelled" } {
  if (answer.length > MAX_SCOPE_ANSWER_CHARS) {
    return { status: "invalid", message: "Selection is too long." };
  }
  const value = answer.trim();
  if (value === "" || value.toLowerCase() === "cancel") {
    return { status: "cancelled" };
  }
  if (value.toLowerCase() === "all") {
    return { status: "valid", toolNames: availableToolNames };
  }
  const parsed = parseCollaborationToolSelection(
    answer,
    availableToolNames.map((name): CollaborationToolChoice => ({
      name,
      description: "",
      risk: "read-only",
      confirmation: "never",
    })),
  );
  if (parsed.kind === "cancel") return { status: "cancelled" };
  if (parsed.kind === "invalid") {
    const message = parsed.message.includes("listed more than once")
      ? "Duplicate tool name."
      : parsed.message.includes("not available")
        ? "Tool not available in this ceiling."
        : parsed.message.replace(/\s+/gu, " ").slice(0, MAX_RETRY_DIAGNOSTIC_CHARS);
    return { status: "invalid", message };
  }
  if (parsed.toolNames.length > MAX_TOOLS_PER_TASK) {
    return {
      status: "invalid",
      message: `Choose no more than ${MAX_TOOLS_PER_TASK} tools for one task.`,
    };
  }
  if (parsed.toolNames.some((name) => !knownTools.has(name))) {
    return { status: "invalid", message: "Tool not available in this ceiling." };
  }
  return { status: "valid", toolNames: Object.freeze([...parsed.toolNames]) };
}

function formatTaskScopePrompt(
  task: CollaborationTask,
  taskIndex: number,
  tasks: readonly CollaborationTask[],
  availableToolNames: readonly string[],
  validationMessage?: string,
): string {
  const taskDetails = formatTaskDetails(task, taskIndex, tasks);
  return [
    `TEAM TASK TOOL SCOPE REVIEW ${taskIndex + 1}/${tasks.length}`,
    taskDetails,
    `Available tools: ${formatToolNames(availableToolNames) || "(none)"}`,
    'Choose "all", "none", or comma-separated exact tool names. Empty input or "cancel" cancels the team run.',
    ...(validationMessage === undefined ? [] : [`Invalid selection: ${validationMessage}`]),
    "Tool scope: ",
  ].join("\n");
}

function formatScopeConfirmation(
  tasks: readonly CollaborationTask[],
  scopesByTaskIndex: readonly (readonly string[])[],
  planFingerprint: string,
): string {
  const slotById = new Map(tasks.map((task, index) => [task.id, index + 1]));
  const rows = tasks.map((task, index) => {
    const scope = scopesByTaskIndex[index] ?? [];
    const dependencySlots = (task.dependsOn ?? [])
      .map((id) => slotById.get(id))
      .filter((slot): slot is number => slot !== undefined);
    const dependencies = dependencySlots.length === 0
      ? "none"
      : dependencySlots.map((slot) => `#${slot}`).join(", ");
    return [
      `#${index + 1} | ID (display only): ${safeLine(task.id)} | Title: ${safeLine(task.title)}`,
      `  Role: ${task.role === undefined ? "(default)" : safeLine(task.role)} | Depends on slots: ${dependencies} | Max attempts override: ${task.maxAttempts ?? "(default)"}`,
      `  Granted tools: ${formatToolNames(scope) || "(no tools)"}`,
    ].join("\n");
  });
  const dependencyNote = tasks.some((task) => task.dependsOn?.length)
    ? "The complete dependency graph is shown by numbered slots in this exact order. Instruction text was shown in sanitized, redacted form during each task's scope prompt."
    : "Dependencies: none; all tasks are independent. Instruction text was shown in sanitized, redacted form during each task's scope prompt.";
  return [
    "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)",
    `Plan fingerprint: ${planFingerprint}`,
    "Task IDs are display labels only. Tool scopes are bound to the ordered numbered slots and this exact plan fingerprint.",
    dependencyNote,
    ...rows,
    "Confirm this exact ordered plan and every tool scope, then start workers? [y/N] (No creates no task workspaces): ",
  ].join("\n");
}

function formatTaskDetails(
  task: CollaborationTask,
  taskIndex: number,
  tasks: readonly CollaborationTask[],
): string {
  const slotById = new Map(tasks.map((candidate, index) => [candidate.id, index + 1]));
  const dependencySlots = (task.dependsOn ?? [])
    .map((id) => slotById.get(id))
    .filter((slot): slot is number => slot !== undefined);
  const dependencies = dependencySlots.length === 0
    ? "none"
    : dependencySlots.map((slot) => `slot ${slot}`).join(", ");
  const instructions = safeDisplay(task.instructions)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return [
    `Plan slot: ${taskIndex + 1}`,
    `Task ID (display only): ${safeLine(task.id)}`,
    `Title: ${safeLine(task.title)}`,
    `Role: ${task.role === undefined ? "(default)" : safeLine(task.role)}`,
    `Depends on: ${dependencies}`,
    `Max attempts override: ${task.maxAttempts === undefined ? "(default)" : task.maxAttempts}`,
    "Instructions:",
    instructions,
  ].join("\n");
}

function formatToolNames(names: readonly string[]): string {
  return names.map((name) => JSON.stringify(name)).join(", ");
}

function safeLine(value: string): string {
  return safeDisplay(value).replace(/[\r\n\t]+/gu, " ").trim();
}

function safeDisplay(value: string): string {
  return redactSensitiveText(sanitizeTerminalText(value)).replace(/\r\n?/gu, "\n");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("collaborative tool-scope review was interrupted");
  }
}

async function askWithAbort(
  ask: ScopeReviewAsk,
  prompt: string,
  signal: AbortSignal | undefined,
  mode: "text" | "confirmation",
): Promise<string> {
  throwIfAborted(signal);
  try {
    const answer = await ask(prompt, signal, mode);
    throwIfAborted(signal);
    return answer;
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    throw error;
  }
}
