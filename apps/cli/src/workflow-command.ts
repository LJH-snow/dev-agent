import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { FilesystemTool, type FilesystemMutationInput } from "@dev-agent/tools";
import {
  applyPlan,
  createPlan,
  formatPlanResult,
  type PlanDocument,
  type PlanResult,
} from "./plan-command.js";

const MAX_WORKFLOW_INPUT_BYTES = 16 * 1024 * 1024; // 16 MiB

async function assertWorkflowInputSize(path: string, maxBytes: number): Promise<void> {
  const fileStat = await stat(path);
  if (fileStat.size > maxBytes) {
    throw new WorkflowInputError(
      `The workflow input file exceeds the ${maxBytes / (1024 * 1024)} MiB read limit.`,
      "invalid_input_size"
    );
  }
}
import {
  executeReviewCommand,
  formatReviewResult,
  type ReviewResult,
} from "./review-command.js";
import { createEventEmitter, EXIT_CODES } from "./non-interactive.js";

export type WorkflowCommandKind = "review" | "plan" | "apply";

export interface WorkflowCommandOptions {
  readonly command: WorkflowCommandKind;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly sessionId: string;
  readonly jsonOutput: boolean;
  readonly eventStream: boolean;
}

export interface WorkflowCommandExecution {
  readonly exitCode: number;
  readonly output: string;
  readonly result?: ReviewResult | PlanResult;
}

export async function executeWorkflowCommand(
  options: WorkflowCommandOptions
): Promise<WorkflowCommandExecution> {
  const emitter = options.eventStream
    ? createEventEmitter({ cwd: options.workingDirectory })
    : undefined;
  const events: string[] = [];
  const emit = (type: string, payload: unknown) => {
    if (emitter) events.push(emitter.emitJsonEvent(type, payload));
  };
  emit("workflow.started", { command: options.command });

  let execution: WorkflowCommandExecution;
  try {
    switch (options.command) {
      case "review":
        execution = await executeReview(options);
        break;
      case "plan":
        execution = await executePlan(options);
        break;
      case "apply":
        execution = await executeApply(options);
        break;
    }
  } catch (error) {
    if (error instanceof WorkflowInputError) {
      const payload = { error: { code: error.code, message: error.message } };
      execution = {
        exitCode: error.code === "invalid_json" || error.code === "invalid_changes" || error.code === "invalid_input_size"
          ? EXIT_CODES.config_error
          : EXIT_CODES.execution_error,
        output: options.jsonOutput
          ? `${JSON.stringify(payload, null, 2)}\n`
          : `${error.code}: ${error.message}\n`,
      };
    } else {
      execution = {
        exitCode: EXIT_CODES.execution_error,
        output: options.jsonOutput
          ? `${JSON.stringify({ error: { code: "WORKFLOW_COMMAND_FAILED", message: "The workflow command failed." } }, null, 2)}\n`
          : "WORKFLOW_COMMAND_FAILED: The workflow command failed.\n",
      };
    }
  }

  emit("workflow.completed", {
    command: options.command,
    exitCode: execution.exitCode,
    result: execution.result,
  });
  return {
    ...execution,
    output: emitter ? `${events.join("\n")}\n` : execution.output,
  };
}

async function executeReview(options: WorkflowCommandOptions): Promise<WorkflowCommandExecution> {
  const review = await executeReviewCommand({
    cwd: options.workingDirectory,
    base: flagValue(options.args, "--base"),
    head: flagValue(options.args, "--head"),
  });
  const exitCode = review.status === "error" || review.status === "limited"
    ? EXIT_CODES.execution_error
    : EXIT_CODES.success;
  return {
    exitCode,
    output: options.jsonOutput
      ? `${formatReviewResult(review)}\n`
      : formatReviewHuman(review),
    result: review,
  };
}

async function executePlan(options: WorkflowCommandOptions): Promise<WorkflowCommandExecution> {
  const changesPath = requiredFlag(options.args, "--changes-file");
  if (!changesPath) return usageFailure(options, "plan requires --changes-file.");
  const changes = await readChanges(resolve(options.workingDirectory, changesPath));
  const planned = await createPlan({
    filesystem: new FilesystemTool(),
    sessionId: options.sessionId,
    workingDirectory: options.workingDirectory,
    changes,
  });
  if (planned.ok) {
    const planPath = flagValue(options.args, "--plan-file");
    if (planPath && planned.plan) {
      await writePlan(resolve(options.workingDirectory, planPath), planned.plan);
    }
  }
  return planExecution(options, planned);
}

async function executeApply(options: WorkflowCommandOptions): Promise<WorkflowCommandExecution> {
  const planPath = requiredFlag(options.args, "--plan-file");
  const changesPath = requiredFlag(options.args, "--changes-file");
  if (!planPath || !changesPath) return usageFailure(options, "apply requires --plan-file and --changes-file.");
  const resolvedPlan = resolve(options.workingDirectory, planPath);
  const resolvedChanges = resolve(options.workingDirectory, changesPath);
  await assertWorkflowInputSize(resolvedPlan, MAX_WORKFLOW_INPUT_BYTES);
  await assertWorkflowInputSize(resolvedChanges, MAX_WORKFLOW_INPUT_BYTES);
  const planInput = await readFile(resolvedPlan, "utf8");
  const changes = await readChanges(resolvedChanges);
  const applied = await applyPlan({
    filesystem: new FilesystemTool(),
    plan: planInput,
    changes,
    sessionId: options.sessionId,
    workingDirectory: options.workingDirectory,
  });
  return planExecution(options, applied);
}

function planExecution(options: WorkflowCommandOptions, result: PlanResult): WorkflowCommandExecution {
  const exitCode = result.ok ? EXIT_CODES.success : planErrorExitCode(result.error.code);
  return {
    exitCode,
    output: options.jsonOutput
      ? formatPlanResult(result)
      : formatPlanHuman(result),
    result,
  };
}

function usageFailure(options: WorkflowCommandOptions, message: string): WorkflowCommandExecution {
  const payload = { error: { code: "USAGE_ERROR", message } };
  return {
    exitCode: EXIT_CODES.usage_error,
    output: options.jsonOutput ? `${JSON.stringify(payload, null, 2)}\n` : `${message}\n`,
  };
}

function planErrorExitCode(code: string): number {
  return code === "invalid_json" || code === "invalid_plan" ? EXIT_CODES.config_error : EXIT_CODES.execution_error;
}

async function readChanges(path: string): Promise<readonly FilesystemMutationInput[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new WorkflowInputError("The changes file is not valid JSON.", "invalid_json");
  }
  if (!Array.isArray(parsed)) {
    throw new WorkflowInputError("The changes file must contain an array.", "invalid_changes");
  }
  return parsed as readonly FilesystemMutationInput[];
}

async function writePlan(path: string, plan: PlanDocument): Promise<void> {
  const content = `${JSON.stringify(plan, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

function formatReviewHuman(review: ReviewResult): string {
  const summary = review.summary;
  const reason = summary.reason ? ` (${summary.reason})` : "";
  return `Review ${review.status}: ${summary.changedFiles} files, +${summary.additions}/-${summary.deletions}${reason}\n`;
}

function formatPlanHuman(result: PlanResult): string {
  if (!result.ok) return `${result.error.code}: ${result.error.message}\n`;
  const verb = result.command === "plan" ? "Plan created" : "Plan applied";
  return `${verb}: ${result.review?.files.length ?? result.files?.length ?? 0} files, +${result.additions ?? result.review?.additions ?? 0}/-${result.deletions ?? result.review?.deletions ?? 0}\n`;
}

function requiredFlag(args: readonly string[], flag: string): string | undefined {
  const value = flagValue(args, flag)?.trim();
  return value || undefined;
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

class WorkflowInputError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "WorkflowInputError";
    this.code = code;
  }
}
