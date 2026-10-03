import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

import type {
  AgentContext,
  PendingChangeSetReview,
  PlanReview,
} from "@dev-agent/agent-core";
import { redactSensitiveText, sanitizeTerminalText } from "./tui-renderer.js";

const MAX_PENDING_REVIEW_PROMPT_CHARS = 8_000;
const MAX_PENDING_REVIEW_DIFF_CHARS = 64 * 1024;

export interface PendingAutoFixReviewState {
  readonly prompt: string;
  readonly context: AgentContext;
  readonly review: PlanReview;
  readonly runtimeAvailable: boolean;
}

export function createPendingAutoFixReviewRecord(
  context: AgentContext,
  prompt: string,
  review: PlanReview,
): PendingChangeSetReview {
  return {
    kind: "autofix",
    sessionId: context.sessionId,
    workspaceId: workspaceId(context.workingDirectory),
    prompt: boundedReviewText(prompt, MAX_PENDING_REVIEW_PROMPT_CHARS),
    review: {
      ...review,
      files: review.files.map((file) => ({
        ...file,
        path: toWorkspaceRelativePath(file.path, context.workingDirectory),
        diff: boundedReviewText(file.diff, MAX_PENDING_REVIEW_DIFF_CHARS, true),
      })),
    },
    createdAt: review.createdAt,
  };
}

export function restorePendingAutoFixReview(
  context: AgentContext,
  record: PendingChangeSetReview,
  runtimeAvailable: boolean,
): PendingAutoFixReviewState | undefined {
  if (
    record.kind !== "autofix" ||
    record.sessionId !== context.sessionId ||
    record.workspaceId !== workspaceId(context.workingDirectory)
  ) {
    return undefined;
  }

  return {
    prompt: record.prompt,
    context,
    runtimeAvailable,
    review: {
      ...record.review,
      files: record.review.files.map((file) => ({
        ...file,
        path: resolve(context.workingDirectory, file.path),
      })),
    },
  };
}

export function workspaceId(workingDirectory: string): string {
  return createHash("sha256").update(resolve(workingDirectory)).digest("hex");
}

function toWorkspaceRelativePath(path: string, workingDirectory: string): string {
  const normalizedInput = path.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//u.test(normalizedInput) || normalizedInput.startsWith("//")) {
    throw new Error("pending review path is outside the workspace");
  }
  const root = resolve(workingDirectory);
  const target = resolve(root, path);
  const relativePath = relative(root, target).replaceAll("\\", "/");
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    throw new Error("pending review path is outside the workspace");
  }
  return relativePath;
}

function boundedReviewText(value: string, maxChars: number, allowEmpty = false): string {
  const sanitized = removeAbsolutePaths(redactSensitiveText(sanitizeTerminalText(value))).slice(0, maxChars);
  if (!allowEmpty && sanitized.length === 0) {
    throw new Error("pending review text is empty");
  }
  return sanitized;
}

function removeAbsolutePaths(value: string): string {
  return value
    .replace(/(^|[\s(\[=:'"])(\/(?:[^\s/]+\/)+[^\s"'<>]+)/gmu, "$1[path]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/gu, "[path]");
}
