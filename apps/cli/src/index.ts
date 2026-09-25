#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { opendir, rename, rm, stat } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import React from "react";
import { render as renderInk } from "ink";
import {
  createTaskStatusBridge,
  scheduleInteractiveTask,
  type InteractiveTaskStatusBridge,
} from "./task-status-bridge.js";

import {
  AgentLoop,
  AgentToolRegistry,
  compileApprovalConfig,
  normalizeApprovalKey,
  createApprovalPolicy,
  createAgentContext,
  createBlockedValidationResult,
  createEvidenceAuditExport,
  createEvidenceAuditPreview,
  EVIDENCE_AUDIT_LIMIT_ERROR_CODE,
  EvidenceAuditLimitError,
  validateEvidenceAuditLimits,
  selectEvidenceForAudit,
  createValidationAttemptId,
  FileMemory,
  FileMemoryCheckpointStore,
  ExtensionRegistry,
  SkillRegistry,
  composePrompt,
  DEFAULT_CLI_PROMPT_MODULES,
  AgentHookRegistry,
  AgentRunTrace,
  AgentTaskScheduler,
  type AgentTaskExecutionContext,
  createCollaborativeExecution,
  createCollaborationTaskGraph,
  planCollaborativeTasks,
  runCollaborativePlan as runCollaborativePlanWorkflow,
  runValidationAttempt,
  type AgentContext,
  type AgentMemory,
  type CheckpointStore,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ChangeSetReview,
  type EvidenceAuditFilters,
  type EvidenceAuditLimits,
  type EvidencePruneOptions,
  type EvidencePruneResult,
  type EvidenceSummary,
  type CompiledApprovalConfig,
  type ValidationAdapter,
  type ValidationResult,
  type SessionMetadata,
  type AgentLoopBudget,
  type AgentTraceSnapshot,
  type CollaborationExecutionEvent,
  type CollaborationExecutionHandle,
  type CollaborationExecutionResult,
  type CollaborationMergeResult,
  type CollaborationReview,
  type CollaborationTask,
  type PlanReview,
  type CollaborativePlanResult,
  type SandboxExpansionDecision,
  type SandboxExpansionRequest,
} from "@dev-agent/agent-core";
import {
  assertWorkingDirectory,
  createExecutor,
  getExecutorMode,
  isSandboxExecutor,
} from "@dev-agent/executor";
import {
  createMcpServer,
  McpServerSession,
  McpStdioClient,
  type McpClient,
  type McpClientConfig,
  type McpServerResource,
  type McpSessionSnapshot,
} from "@dev-agent/mcp";
import { colors, colorize } from "./colors.js";
import { resolveTuiRenderer, shouldUseRichUi } from "./tui-mode.js";
import { LiveAssistantRenderer } from "./tui-stream.js";
import {
  TuiSessionModel,
  type TuiRunState,
  type UsageSummary,
} from "./tui-session.js";
import {
  DEFAULT_COMMAND_HINTS,
  redactSensitiveText,
  renderApprovalMessage,
  renderAssistantMessage,
  renderCommandHints,
  renderRuntimeStatus,
  renderToolCard,
  renderToolCall,
  renderToolResult,
  renderValidationMessage,
  renderWelcome,
  sanitizeTerminalText,
} from "./tui-renderer.js";
import {
  loadConfig,
  parseApprovalMode,
  resolveCollaborationToolAllowlist,
  resolveConfigPath,
  resolveInkTheme,
  resolveApprovalMode,
  resolveMaxContextChars,
  resolveMaxTurns,
  resolveModel,
  resolveProviderId,
  resolveRustBinaryPath,
  resolveSummarizeContext,
  resolveSummaryMaxChars,
  resolveValidationPolicy,
  type ApprovalMode,
  type CliConfig,
} from "./config.js";
import { buildMcpSystemPromptSupplement } from "./mcp-system-prompt.js";
import type { McpResourceLine, McpPromptLine } from "./mcp-system-prompt.js";
import { printDoctorReport, probeRustBinary, runDoctor } from "./doctor.js";
import { executeConfigCommand, formatConfigCommandResult } from "./config-command.js";
import { initializeProject } from "./project-init.js";
import {
  executeRuntimeCommand,
  formatRuntimeCommandResult,
  resolveManagedRuntimeBinary,
  resolveManagedRuntimeStatus,
} from "./runtime-command.js";
import { resolveExecutorSelection, type ExecutorPreference } from "./runtime-selection.js";
import { executeWorkflowCommand } from "./workflow-command.js";
import { createNonInteractiveController, EXIT_CODES } from "./non-interactive.js";
import { runAcpServer } from "./acp-server.js";
import { InkCliApp } from "./ink/app.js";
import {
  CollaborationScopeReviewCancelledError,
  reviewCollaborationTaskToolScopes,
} from "./collaboration-scope-review.js";
import { InkRuntimeStore } from "./ink/runtime-store.js";
import {
  INK_THEME_NAMES,
  parseInkThemeCommand,
} from "./ink/theme.js";
import type { InkThemeName } from "./ink/theme-types.js";
import {
  createInkRenderOutput,
  normalizeInkTerminalSize,
} from "./ink/terminal-size.js";
import { InkUiController } from "./ink-ui.js";
import {
  buildApprovedPlanContext,
  latestAssistantPlanText,
} from "./plan-mode.js";
import {
  getSetupCredentialHint,
  getSetupDefaultModel,
  parseSetupProvider,
  writeSetupConfig,
} from "./setup-command.js";
import { persistInkTheme } from "./theme-preferences.js";
import { executeProviderCommand, type ProviderCommand } from "./provider-command.js";
import { formatModelSelectionMetadata, resolveModelSelection, type ModelSelection, type ModelSelectionResult } from "./model-profiles.js";
import { FallbackModelProvider } from "./fallback-provider.js";
import { GitCollaborationWorkspaceProvider } from "./collaboration-worktree.js";
import { resolveSpecialistRoles } from "./specialist-roles.js";
import {
  BackgroundJobManager,
  BackgroundJobStore,
  resolveBackgroundJobWorkingDirectory,
} from "./background-jobs.js";
import {
  formatBackgroundJobCommandResult,
  parseBackgroundJobCommand,
} from "./background-job-command.js";
import { executeMcpCommand, type McpManagementResult, type McpProbe } from "./mcp-command.js";
import {
  executeMcpConfigCommand,
  type McpConfigAction,
  type McpConfigCommandResult,
} from "./mcp-config-command.js";
import type { McpCommandAction } from "./mcp-command.js";
import { listMcpTemplates } from "./mcp-templates.js";
import { parseMcpInteractiveCommand } from "./mcp-interactive-command.js";
import { indexDirectory, refreshIndexDirectory, type IndexProgress } from "./index-command.js";
import {
  executeSkillCommand,
  formatSkillCommandResult,
  renderActiveSkillPrompt,
  type ActiveSkillState,
} from "./skill-command.js";
import {
  executeCheckpointCommand,
  isCheckpointCommand,
  type CheckpointCommandResult,
} from "./checkpoint-command.js";
import {
  resolvePromptContext,
  type ResolvedPromptContext,
} from "./context-attachments.js";
import { ProjectContextManager } from "./project-context.js";
import { diagnoseSlowStage, formatSlowStageDiagnosis, summarizeRunTimings } from "./run-timing-summary.js";
import {
  executeExtensionCommand,
  formatExtensionCommandResult,
} from "./extension-command.js";
import {
  executeTaskCommand,
  formatTaskCommandResult,
} from "./task-command.js";
import {
  formatSessionSearch,
  formatSessionHistory,
  parseSessionHistoryCommand,
  parseSessionSearchCommand,
} from "./session-history.js";
import {
  parseSessionExportCommand,
  writeSessionExport,
} from "./session-export.js";
import {
  listStoredSessions,
  searchStoredSessions,
  type StoredSession,
} from "./session-registry.js";
import {
  formatStoredSessionRow,
  parseSessionResumeCommand,
} from "./session-resume.js";
import { clearIndex, getIndexStatus } from "@dev-agent/code-intelligence";
import { benchmarkModel, type SpeedBenchmarkResult } from "./speed-benchmark.js";
import { resolvePromptToolAccess } from "./prompt-tool-policy.js";
import { parseBenchmarkCommand, parseSpeedModeCommand } from "./speed-mode-command.js";
import {
  parseAutoFixCommand,
  runAutoFixLoop,
  type AutoFixRepairRun,
} from "./auto-fix-command.js";
import {
  executeGitWorkflowCommand,
  isGitWorkflowCommand,
  type GitWorkflowResult,
} from "./github-workflow-command.js";
import {
  executeProjectMemoryCommand,
  isProjectMemoryCommand,
  ProjectMemoryStore,
} from "./project-memory.js";
import {
  AdaptiveModelProvider,
  executeModelRoutingCommand,
  ModelRoutingController,
  resolveModelRoutingConfig,
} from "./model-routing.js";
import { SessionModelBudget } from "./model-budget.js";
import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
  estimateCost,
  type ChatUsage,
  type ModelProvider,
  type ModelSpeedMode,
  ModelSpeedModeController,
  SpeedModeModelProvider,
  describeSpeedModeSupport,
  type PriceTable,
} from "@dev-agent/model";
import {
  createDefaultTools,
  createBuiltInToolSandboxProfile,
  expandBuiltInToolSandboxProfile,
  createValidationRunner,
  deriveValidationPlan,
  FilesystemTool,
  type ValidationPolicy,
} from "@dev-agent/tools";

const packageMetadata = createRequire(import.meta.url)("../package.json") as { version?: string };
const version = packageMetadata.version ?? "0.0.0";
const DEFAULT_ONCE_CONTEXT_CHARS = 4000;
const DEFAULT_ONCE_TOOL_OUTPUT_CHARS = 6000;
const DEFAULT_ONCE_MAX_REPEATED_TOOL_FAILURES = 2;
const MAX_SESSION_LIST_ENTRIES = 256;
export const MAX_APPROVAL_INPUT_BYTES = 4 * 1024;
const CLI_USAGE = [
  "Usage: dev-agent [options] [prompt]",
  "",
  "Commands:",
  "  review [options]                 Review working-tree or base/head metadata",
  "  plan [options]                   Create a metadata-only workflow plan",
  "  apply [options]                  Apply a reviewed workflow plan",
  "  config validate|show [options]   Validate or show effective config",
  "  setup [options]                  Configure the default provider and model",
  "  mcp list|status|validate|test|health",
  "                                   Inspect configured MCP servers",
  "  mcp add|remove|enable|disable [options]",
  "                                   Manage named MCP server entries",
  "  mcp templates                    List MCP server templates",
  "  runtime status|install|path|remove",
  "  index status|refresh|clear       Manage the persisted code index",
  "  init [options]                   Initialize project-scoped state",
  "",
  "Common options:",
  "  --cwd <path>                     Use a different working directory",
  "  --project-state                  Store config and sessions in the project",
  "  --session <id>                  Continue the named session",
  "  --resume <id>                   Resume an existing session",
  "  --json                           Emit machine-readable output",
  "  --acp                           Serve the agent through ACP v1 over stdio",
  "  --a2a                           Serve the agent through A2A v1 over HTTP",
  "  --host <host>                   A2A bind host (default: 127.0.0.1)",
  "  --port <port>                   A2A bind port (default: 4320)",
  "  --tools                          List available tools without a provider",
  "  --doctor                         Check the local runtime environment",
  "  --check-update                   Check npm for a newer CLI version (with --doctor)",
  "  -v, --version                    Print the CLI version",
  "  -h, --help                       Show this help",
].join("\n");

/** Flags that would turn a preview invocation into another operation. */
const PREVIEW_EXCLUSIVE_FLAGS = [
  "--version",
  "-v",
  "--tools",
  "--metadata",
  "--session-list",
  "--cleanup-evidence",
  "--export-evidence",
  "--doctor",
  "--check-update",
  "--mcp-server",
  "--acp",
  "--a2a",
  "--reset-memory",
  "--compact",
  "--session-delete",
  "--session-rename",
  "--index",
  "--exclude",
  "--rust-executor",
  "--check-rust",
  "--approval",
  "--once",
] as const;

/**
 * How many values each flag consumes.
 *
 * The CLI parses with `indexOf`, so anything it does not recognise used to be
 * ignored silently: `--nope` fell through to interactive mode, `--once --json`
 * sent the literal string `--json` to the model, and `--session --once hi`
 * consumed `--once` as the session id (creating `once.json` on disk). This
 * table is what lets the validator below turn those into errors.
 */
const CLI_FLAGS: Readonly<Record<string, "none" | "one" | "two" | "optional">> = {
  "--version": "none",
  "-v": "none",
  "--help": "none",
  "-h": "none",
  "--tools": "none",
  "--metadata": "none",
  "--session-list": "none",
  "--cleanup-evidence": "none",
  "--export-evidence": "none",
  "--preview-evidence": "none",
  "--change-set-id": "one",
  "--validation-id": "one",
  "--status": "one",
  "--remove-rolled-back": "none",
  "--max-validations": "one",
  "--max-change-sets": "one",
  "--audit-max-validations": "one",
  "--audit-max-change-sets": "one",
  "--audit-max-files": "one",
  "--audit-max-bytes": "one",
  "--doctor": "none",
  "--check-update": "none",
  "--mcp-server": "none",
  "--acp": "none",
  "--a2a": "none",
  "--host": "one",
  "--port": "one",
  "--reset-memory": "none",
  "--no-stream": "none",
  "--json": "none",
  "--once": "one",
  "--session": "one",
  "--resume": "one",
  "--session-delete": "one",
  "--index": "one",
  "--index-file": "one",
  "--exclude": "one",
  "--cwd": "one",
  "--config": "one",
  "--name": "one",
  "--command": "one",
  "--arg": "one",
  "--env": "one",
  "--timeout-ms": "one",
  "--template": "one",
  "--project-state": "none",
  "--rust-executor": "one",
  "--executor": "one",
  "--runtime-version": "one",
  "--runtime-release": "one",
  "--runtime-dir": "one",
  "--target": "one",
  "--provider": "one",
  "--model": "one",
  "--profile": "one",
  "--alias": "one",
  "--max-turns": "one",
  "--max-tokens": "one",
  "--max-duration-ms": "one",
  "--max-output-chars": "one",
  "--base": "one",
  "--head": "one",
  "--changes-file": "one",
  "--plan-file": "one",
  "--non-interactive": "none",
  "--event-stream": "none",
  "--approval": "one",
  "--session-rename": "two",
  "--compact": "optional",
  "--check-rust": "optional",
  "--gitignore": "none",
  "--dry-run": "none",
  "--confirm": "none",
};

/**
 * Rejects arguments the flag table does not account for, plus values that look
 * like another flag. Returns a message to print, or undefined when the command
 * line is well formed.
 */
type ExplicitCliCommand =
  | { readonly kind: "init" }
  | { readonly kind: "setup" }
  | { readonly kind: "config"; readonly action: "validate" | "show" }
  | { readonly kind: "runtime"; readonly action: "status" | "install" | "path" | "remove" }
  | { readonly kind: "workflow"; readonly action: "review" | "plan" | "apply" }
  | { readonly kind: "provider"; readonly resource: "providers" | "models"; readonly action: "list" | "status" | "test" | "current" }
  | {
      readonly kind: "mcp";
      readonly action: McpCommandAction | McpConfigAction | "templates";
    }
  | { readonly kind: "index"; readonly action: "status" | "refresh" | "clear" };

function parseExplicitCliCommandAt(
  args: readonly string[],
  offset: number
): ExplicitCliCommand | undefined {
  const first = args[offset];
  const second = args[offset + 1];
  if (first === "init") {
    return { kind: "init" };
  }
  if (first === "setup") {
    return { kind: "setup" };
  }
  if (first === "config" && (second === "validate" || second === "show")) {
    return { kind: "config", action: second };
  }
  if (
    first === "runtime" &&
    (second === "status" ||
      second === "install" ||
      second === "path" ||
      second === "remove")
  ) {
    return { kind: "runtime", action: second };
  }
  if (first === "review" || first === "plan" || first === "apply") {
    return { kind: "workflow", action: first };
  }
  if (
    first === "providers" &&
    (second === "list" || second === "status" || second === "test")
  ) {
    return { kind: "provider", resource: "providers", action: second };
  }
  if (first === "models" && (second === "list" || second === "current")) {
    return { kind: "provider", resource: "models", action: second };
  }
  if (
    first === "mcp" &&
    (second === "list" ||
      second === "status" ||
      second === "validate" ||
      second === "test" ||
      second === "health" ||
      second === "add" ||
      second === "remove" ||
      second === "enable" ||
      second === "disable" ||
      second === "templates")
  ) {
    return { kind: "mcp", action: second };
  }
  if (
    first === "index" &&
    (second === "status" || second === "refresh" || second === "clear")
  ) {
    return { kind: "index", action: second };
  }
  return undefined;
}

function parseExplicitCliCommand(args: readonly string[]): ExplicitCliCommand | undefined {
  return parseExplicitCliCommandAt(args, 0);
}

function findExplicitCommandStart(args: readonly string[]): number | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (parseExplicitCliCommandAt(args, index) !== undefined) {
      return index;
    }
    const arity = CLI_FLAGS[args[index] ?? ""];
    if (arity === "two") {
      index += 2;
    } else if (arity === "one") {
      index += 1;
    } else if (arity === "optional") {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        index += 1;
      }
    }
  }
  return undefined;
}

function normalizeExplicitCommandArgs(args: readonly string[]): readonly string[] {
  const commandStart = findExplicitCommandStart(args);
  return commandStart === undefined || commandStart === 0
    ? args
    : [...args.slice(commandStart), ...args.slice(0, commandStart)];
}

function explicitCommandPrefixLength(args: readonly string[]): number {
  const command = parseExplicitCliCommand(args);
  if (command?.kind === "init") {
    return 1;
  }
  if (command?.kind === "setup") {
    return 1;
  }
  if (command?.kind === "config" || command?.kind === "runtime") {
    return 2;
  }
  if (command?.kind === "workflow") {
    return 1;
  }
  if (command?.kind === "provider" || command?.kind === "mcp" || command?.kind === "index") {
    return 2;
  }
  return 0;
}

export function validateCliArgs(args: readonly string[]): string | undefined {
  const commandPrefixLength = explicitCommandPrefixLength(args);
  for (let i = commandPrefixLength; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("-")) {
      return `Unexpected argument '${arg}'.`;
    }
    if ((arg === "--gitignore" || arg === "--dry-run") && commandPrefixLength === 0) {
      return `Unknown option '${arg}'.`;
    }

    const arity = CLI_FLAGS[arg];
    if (arity === undefined) {
      return `Unknown option '${arg}'.`;
    }
    if (arity === "none") {
      continue;
    }

    // A value may not start with `-`: that is how `--session --once` slipped
    // through before. Directory names that start with a dash still work as
    // `./-dir`.
    const wanted = arity === "two" ? 2 : 1;
    let found = 0;
    while (found < wanted) {
      const next = args[i + 1 + found];
      // MCP commands pass through arbitrary child-process arguments. A
      // repeated `--arg -y` or `--arg --root` is a value, not a CLI flag,
      // unless it is one of our own recognized flags (which still indicates a
      // missing value).
      if (
        found === 0 &&
        wanted === 1 &&
        arg === "--arg" &&
        next !== undefined &&
        next.startsWith("-") &&
        CLI_FLAGS[next] === undefined
      ) {
        found += 1;
        continue;
      }
      if (next === undefined || next.startsWith("-")) {
        break;
      }
      found += 1;
    }

    if (arity === "optional") {
      i += found;
      continue;
    }
    if (found < wanted) {
      return wanted === 2
        ? `${arg} requires two values.`
        : `${arg} requires a value.`;
    }
    i += wanted;
  }
  return undefined;
}

function validatePreviewCliCombination(
  args: readonly string[],
  previewEvidence: boolean
): string | undefined {
  if (!previewEvidence) {
    return undefined;
  }
  const conflictingFlag = PREVIEW_EXCLUSIVE_FLAGS.find((flag) => args.includes(flag));
  return conflictingFlag === undefined
    ? undefined
    : `--preview-evidence cannot be combined with ${conflictingFlag}`;
}

function validateA2aCliCombination(args: readonly string[]): string | undefined {
  const a2a = args.includes("--a2a");
  const hostOrPort = args.includes("--host") || args.includes("--port");
  if (hostOrPort && !a2a) {
    return "--host and --port require --a2a.";
  }
  if (!a2a) {
    return undefined;
  }
  const conflictingFlag = ["--acp", "--json", "--once", "--mcp-server", "--tools"].find(
    (flag) => args.includes(flag)
  );
  return conflictingFlag === undefined
    ? undefined
    : `--a2a cannot be combined with ${conflictingFlag}.`;
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function flagValues(args: readonly string[], flag: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] !== undefined) {
      values.push(args[index + 1]!);
      index += 1;
    }
  }
  return values;
}

function parseA2aPort(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }
  return port;
}

function parseExecutorPreference(value: string | undefined): ExecutorPreference | undefined {
  if (value === undefined) return undefined;
  if (value === "local" || value === "rust-sandbox") return value;
  throw new Error("--executor must be one of: local, rust-sandbox.");
}

function validateExplicitCommandFlags(
  command: ExplicitCliCommand,
  args: readonly string[]
): string | undefined {
  const allowed =
    command.kind === "init"
      ? new Set(["--cwd", "--project-state", "--gitignore", "--dry-run", "--json"])
      : command.kind === "setup"
        ? new Set(["--cwd", "--project-state", "--config", "--provider", "--model", "--json", "--non-interactive"])
      : command.kind === "config"
        ? new Set(["--cwd", "--project-state", "--config", "--json"])
        : command.kind === "runtime"
          ? new Set(["--runtime-version", "--runtime-release", "--runtime-dir", "--target", "--json"])
          : command.action === "review"
            ? new Set(["--cwd", "--base", "--head", "--json", "--non-interactive", "--event-stream"])
            : command.kind === "workflow"
              ? new Set(["--cwd", "--session", "--changes-file", "--plan-file", "--json", "--non-interactive", "--event-stream"])
              : command.kind === "provider"
                ? new Set(["--cwd", "--project-state", "--config", "--provider", "--model", "--profile", "--alias", "--json", "--non-interactive"])
                : command.kind === "mcp"
                  ? command.action === "add"
                    ? new Set([
                        "--cwd",
                        "--project-state",
                        "--config",
                        "--json",
                        "--name",
                        "--command",
                        "--arg",
                        "--env",
                        "--timeout-ms",
                        "--template",
                      ])
                    : command.action === "remove" ||
                        command.action === "enable" ||
                        command.action === "disable"
                      ? new Set(["--cwd", "--project-state", "--config", "--json", "--name"])
                      : command.action === "templates"
                        ? new Set(["--cwd", "--project-state", "--json"])
                        : new Set(["--cwd", "--project-state", "--config", "--json", "--non-interactive"])
                  : new Set(["--cwd", "--index-file", "--exclude", "--json", "--confirm", "--dry-run"]);
  const prefixLength = explicitCommandPrefixLength(args);
  for (let index = prefixLength; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("-") && !allowed.has(arg)) {
      const commandName =
        command.kind === "init"
          ? "init"
          : command.kind === "setup"
            ? "setup"
          : command.kind === "config"
            ? `config ${command.action}`
            : command.kind === "runtime"
              ? `runtime ${command.action}`
              : command.kind === "provider"
                ? `${command.resource} ${command.action}`
                : command.kind === "mcp"
                  ? `mcp ${command.action}`
                  : command.kind === "index"
                    ? `index ${command.action}`
                    : command.action;
      return `${arg} is not supported by ${commandName}.`;
    }
    const arity = CLI_FLAGS[arg];
    if (arity === "one") {
      index += 1;
    } else if (arity === "two") {
      index += 2;
    } else if (arity === "optional") {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        index += 1;
      }
    }
  }
  return undefined;
}

async function runExplicitCliCommand(
  command: ExplicitCliCommand,
  args: readonly string[],
  jsonOutput: boolean,
  jsonErrorOutput: boolean,
  startupSignal?: AbortSignal
): Promise<void> {
  const commandError = validateExplicitCommandFlags(command, args);
  if (commandError) {
    emitCliError(commandError, jsonErrorOutput);
    process.exitCode = 1;
    return;
  }

  const cwdFlag = flagValue(args, "--cwd");
  const workingDirectory = resolveWorkingDirectory(cwdFlag);
  try {
    assertWorkingDirectory(workingDirectory);
  } catch (error) {
    emitCliError(error instanceof Error ? error.message : String(error), jsonErrorOutput);
    process.exitCode = 1;
    return;
  }

  if (command.kind === "setup") {
    const projectState = args.includes("--project-state");
    const configPath = resolveConfigPath(
      flagValue(args, "--config"),
      process.env,
      homedir(),
      workingDirectory,
      projectState,
    );
    try {
      const existing = loadConfig(configPath, process.env, workingDirectory, projectState);
      const configuredProvider =
        typeof existing.defaultProvider === "string" && existing.defaultProvider.trim() !== ""
          ? existing.defaultProvider.trim()
          : "ollama";
      const providerInput = flagValue(args, "--provider");
      const shouldPrompt = !jsonOutput &&
        !args.includes("--non-interactive") &&
        process.stdin.isTTY === true;
      const providerAnswer = shouldPrompt && providerInput === undefined
        ? await readLineFromStdin(
            `Provider [ollama/openai/anthropic/gemini] (${safeTerminalText(configuredProvider)}): `,
          )
        : "";
      const provider = parseSetupProvider(
        (providerInput ?? providerAnswer.trim() ?? configuredProvider) || configuredProvider,
      );
      const configuredModel =
        provider === configuredProvider &&
        typeof existing.defaultModel === "string" &&
        existing.defaultModel.trim() !== ""
          ? existing.defaultModel.trim()
          : getSetupDefaultModel(provider);
      const modelInput = flagValue(args, "--model");
      const modelAnswer = shouldPrompt && modelInput === undefined
        ? await readLineFromStdin(`Model (${safeTerminalText(configuredModel)}): `)
        : "";
      const model = (modelInput ?? modelAnswer.trim() ?? configuredModel).trim() || configuredModel;
      const result = await writeSetupConfig(configPath, { provider, model });
      const payload = {
        command: "setup",
        scope: projectState ? "project" : "user",
        provider: result.provider,
        model: result.model,
        created: result.created,
        credentialHint: getSetupCredentialHint(result.provider),
      };
      if (jsonOutput) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Setup saved (${payload.scope} configuration).`);
        console.log(`Provider: ${safeTerminalText(payload.provider)}`);
        console.log(`Model: ${safeTerminalText(payload.model)}`);
        console.log(safeTerminalText(payload.credentialHint));
        console.log("Restart dev-agent to use the new selection.");
      }
    } catch (error) {
      emitCliError(error instanceof Error ? error.message : String(error), jsonErrorOutput);
      process.exitCode = 1;
    }
    return;
  }

  if (command.kind === "runtime") {
    const execution = await executeRuntimeCommand({ action: command.action, args });
    const output = formatRuntimeCommandResult(execution, jsonOutput);
    if (execution.exitCode === 0) {
      console.log(output);
    } else {
      // JSON errors stay on stdout to preserve the CLI's existing --json
      // contract; human-readable failures use stderr.
      if (jsonOutput) console.log(output);
      else console.error(output);
      process.exitCode = execution.exitCode;
    }
    return;
  }

  if (command.kind === "provider") {
    const projectState = args.includes("--project-state");
    const configPath = resolveConfigPath(
      flagValue(args, "--config"),
      process.env,
      homedir(),
      workingDirectory,
      projectState
    );
    const config = loadConfig(configPath, process.env, workingDirectory, projectState);
    const providerCommand: ProviderCommand = {
      resource: command.resource,
      action: command.action as ProviderCommand["action"],
      ...(flagValue(args, "--provider") === undefined
        ? {}
        : { provider: flagValue(args, "--provider") }),
    } as ProviderCommand;
    const result = await executeProviderCommand(providerCommand, {
      config,
      env: process.env,
      ...(command.resource === "providers" && command.action === "test"
        ? { fetch: globalThis.fetch }
        : {}),
    });
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printProviderCommandResult(result);
    }
    const exitCode = providerCommandExitCode(result);
    if (exitCode !== EXIT_CODES.success) process.exitCode = exitCode;
    return;
  }

  if (command.kind === "mcp") {
    const projectState = args.includes("--project-state");
    const configPath = resolveConfigPath(
      flagValue(args, "--config"),
      process.env,
      homedir(),
      workingDirectory,
      projectState
    );
    if (
      command.action === "add" ||
      command.action === "remove" ||
      command.action === "enable" ||
      command.action === "disable"
    ) {
      try {
        const timeoutInput = flagValue(args, "--timeout-ms");
        let timeoutMs: number | undefined;
        if (timeoutInput !== undefined) {
          if (!/^\d+$/.test(timeoutInput)) {
            throw new Error("--timeout-ms must be a positive integer in milliseconds.");
          }
          timeoutMs = Number(timeoutInput);
          if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
            throw new Error("--timeout-ms must be a positive integer in milliseconds.");
          }
        }
        const result = await executeMcpConfigCommand({
          action: command.action,
          configPath,
          name: flagValue(args, "--name") ?? "",
          ...(command.action === "add"
              ? {
                  command: flagValue(args, "--command"),
                  template: flagValue(args, "--template"),
                  args: flagValues(args, "--arg"),
                environment: flagValues(args, "--env"),
                ...(timeoutMs === undefined ? {} : { timeoutMs }),
              }
            : {}),
        });
        if (jsonOutput) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printMcpConfigCommandResult(result);
        }
        if (result.status === "not_found") {
          process.exitCode = EXIT_CODES.config_error;
        }
      } catch (error) {
        emitCliError(error instanceof Error ? error.message : String(error), jsonErrorOutput);
        process.exitCode = EXIT_CODES.config_error;
      }
      return;
    }
    if (command.action === "templates") {
      if (jsonOutput) {
        console.log(JSON.stringify({
          command: "mcp templates",
          templates: listMcpTemplates(),
        }, null, 2));
      } else {
        printMcpTemplates(listMcpTemplates());
      }
      return;
    }
    const config = loadConfig(configPath, process.env, workingDirectory, projectState);
    const managementConfig = { mcpServers: readMcpManagementEntries(config) };
    const result = await executeMcpCommand(command.action, {
      config: managementConfig,
      ...(command.action === "status" || command.action === "test"
        ? { connector: createMcpManagementProbe(workingDirectory) }
        : {}),
    });
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printMcpCommandResult(result);
    }
    const exitCode = mcpCommandExitCode(result);
    if (exitCode !== EXIT_CODES.success) process.exitCode = exitCode;
    return;
  }

  if (command.kind === "index") {
    const indexFile = resolveIndexFilePath(workingDirectory, flagValue(args, "--index-file"));
    try {
      if (command.action === "status") {
        const result = await getIndexStatus({ indexPath: indexFile });
        if (jsonOutput) {
          console.log(JSON.stringify({ command: "index status", ...result }, null, 2));
        } else {
          printIndexStatus(result);
        }
        if (!result.usable && result.status !== "missing") process.exitCode = EXIT_CODES.config_error;
        return;
      }

      if (command.action === "clear") {
        const result = await clearIndex({
          indexPath: indexFile,
          confirm: args.includes("--confirm"),
          dryRun: args.includes("--dry-run"),
        });
        if (jsonOutput) {
          console.log(JSON.stringify({ command: "index clear", ...result }, null, 2));
        } else {
          printIndexClear(result);
        }
        if (result.status === "blocked" || result.status === "error") {
          process.exitCode = result.status === "blocked" ? EXIT_CODES.policy_denied : EXIT_CODES.execution_error;
        }
        return;
      }

      const excludePaths = args
        .flatMap((arg, index) => (arg === "--exclude" ? [args[index + 1]] : []))
        .filter((path): path is string => path !== undefined)
        .map((path) => resolve(workingDirectory, path));
      const controller = new AbortController();
      const signal = startupSignal ?? controller.signal;
      let progressLine = false;
      const onSigint = () => controller.abort();
      const clearProgressLine = (): void => {
        if (progressLine) {
          process.stderr.write("\r\x1b[2K");
          progressLine = false;
        }
      };
      const onProgress = (progress: IndexProgress): void => {
        if (
          jsonOutput ||
          !process.stderr.isTTY ||
          progress.phase !== "processing" ||
          progress.total === 0
        ) {
          return;
        }
        process.stderr.write(`\rIndexing ${progress.completed}/${progress.total} files...`);
        progressLine = true;
      };
      if (startupSignal === undefined) {
        process.once("SIGINT", onSigint);
      }
      try {
        const result = await refreshIndexDirectory(
          workingDirectory,
          undefined,
          excludePaths,
          indexFile,
          { signal, onProgress }
        );
        if (result.status === "cancelled") {
          clearProgressLine();
          const cancellation = {
            command: "index refresh",
            status: "cancelled",
            cancelled: true,
            phase: result.progress.phase,
            completed: result.progress.completed,
            total: result.progress.total,
            active: result.progress.active,
            reused: result.progress.reused,
            rescanned: result.progress.rescanned,
          };
          if (jsonOutput) {
            console.log(JSON.stringify(cancellation, null, 2));
          } else {
            console.error(
              `Index refresh cancelled after ${result.progress.completed}/${result.progress.total} files.`
            );
          }
          process.exitCode = 130;
          return;
        }
        clearProgressLine();
        const report = result.report;
        const publicReport = {
          command: "index refresh",
          written: report.written,
          files: report.files,
          symbols: report.symbols,
          reused: report.reused,
          cacheHits: report.cacheHits,
          cacheMisses: report.cacheMisses,
          cacheHitRate: report.cacheHitRate,
          languages: report.languages,
          skipped: report.skipped,
          warnings: report.warnings,
          excluded: report.excluded,
          errors: report.errors,
          updatedAt: report.updatedAt,
        };
        if (jsonOutput) {
          console.log(JSON.stringify(publicReport, null, 2));
        } else {
          console.log(`Indexed ${report.files} files / ${report.symbols} symbols (${report.reused} reused).`);
          console.log(`Cache hit rate: ${(report.cacheHitRate * 100).toFixed(1)}%; errors: ${report.errors}; updated: ${safeTerminalText(report.updatedAt)}`);
          console.log(
            report.written
              ? "Index written."
              : "Index not written: serialized index exceeds the 16 MiB limit; the previous index was preserved."
          );
        }
      } finally {
        clearProgressLine();
        if (startupSignal === undefined) {
          process.removeListener("SIGINT", onSigint);
        }
      }
    } catch (error) {
      emitCliError(error instanceof Error ? error.message : String(error), jsonErrorOutput);
      process.exitCode = EXIT_CODES.execution_error;
    }
    return;
  }

  if (command.kind === "workflow") {
    const sessionValue = flagValue(args, "--session");
    const sessionId = normalizeSessionId(sessionValue ?? "default");
    const execution = await executeWorkflowCommand({
      command: command.action,
      args,
      workingDirectory,
      sessionId,
      jsonOutput,
      eventStream: args.includes("--event-stream"),
    });
    process.stdout.write(execution.output);
    if (execution.exitCode !== EXIT_CODES.success) {
      process.exitCode = execution.exitCode;
    }
    return;
  }

  if (command.kind === "init") {
    try {
      const result = await initializeProject({
        workingDirectory,
        addGitignore: args.includes("--gitignore"),
        dryRun: args.includes("--dry-run"),
      });
      const entryStatus = (path: string) => result.entries.find((entry) => entry.path === path)?.status;
      const summarizeEntry = (path: string) => {
        const status = entryStatus(path);
        return {
          created: status === "created" && !result.dryRun,
          existing: status === "existing",
          changed: status === "changed" && !result.dryRun,
          skipped: status === "skipped",
          wouldCreate: status === "created" && result.dryRun,
          wouldChange: status === "changed" && result.dryRun,
        };
      };
      const payload = {
        command: "init",
        projectState: true,
        dryRun: result.dryRun,
        config: summarizeEntry(result.configPath),
        sessions: summarizeEntry(result.sessionsDirectory),
        gitignore: summarizeEntry(result.gitignorePath),
        created: result.created.length,
        existing: result.existing.length,
        changed: result.changed.length,
        skipped: result.skipped.length,
      };
      if (jsonOutput) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Initialized project state in ${safeTerminalText(workingDirectory)}.`);
        console.log(`Created: ${result.created.length}; existing: ${result.existing.length}; changed: ${result.changed.length}.`);
        if (result.skipped.length > 0) {
          console.log(`Skipped: ${result.skipped.length}.`);
        }
      }
    } catch (error) {
      emitCliError(error instanceof Error ? error.message : String(error), jsonErrorOutput);
      process.exitCode = 1;
    }
    return;
  }

  const projectState = args.includes("--project-state");
  const configPath = resolveConfigPath(
    flagValue(args, "--config"),
    process.env,
    homedir(),
    workingDirectory,
    projectState
  );
  const execution = await executeConfigCommand({
    command: command.action,
    configPath,
  });
  if (jsonOutput) {
    console.log(JSON.stringify(execution.result, null, 2));
  } else {
    console.log(formatConfigCommandResult(execution.result));
  }
  if (execution.exitCode !== 0) {
    process.exitCode = execution.exitCode;
  }
}

export interface CliMainOptions {
  readonly startupSignal?: AbortSignal;
  /** Private detached-worker context; never populated from normal CLI arguments. */
  readonly jobAttachedContext?: string;
}

export async function main(argv: string[], options: CliMainOptions = {}): Promise<void> {
  const rawArgs = argv.slice(2);
  if (rawArgs.includes("--internal-job-worker")) {
    if (rawArgs.length !== 2 || rawArgs[0] !== "--internal-job-worker") {
      emitCliError("Invalid internal background-worker invocation.", false);
      process.exitCode = EXIT_CODES.usage_error;
      return;
    }
    await runInternalBackgroundJobWorker(rawArgs[1]!, options.startupSignal);
    return;
  }
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    console.log(CLI_USAGE);
    return;
  }
  const args = normalizeExplicitCommandArgs(rawArgs);
  const jsonOutput = args.includes("--json");
  const previewEvidence = args.includes("--preview-evidence");
  const exportEvidence = args.includes("--export-evidence");
  const jsonErrorOutput = shouldEmitJsonErrorDocument(args);
  const argError = validateCliArgs(args);
  if (argError) {
    emitCliError(argError, jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  if (args.includes("--check-update") && !args.includes("--doctor")) {
    emitCliError("--check-update requires --doctor.", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const previewCombinationError = validatePreviewCliCombination(args, previewEvidence);
  if (previewCombinationError) {
    emitCliError(previewCombinationError, jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const a2aCombinationError = validateA2aCliCombination(args);
  if (a2aCombinationError) {
    emitCliError(a2aCombinationError, jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const explicitCommand = parseExplicitCliCommand(args);
  if (explicitCommand !== undefined) {
    await runExplicitCliCommand(
      explicitCommand,
      args,
      jsonOutput,
      jsonErrorOutput,
      options.startupSignal
    );
    return;
  }
  if (args.includes("--event-stream")) {
    emitCliError("--event-stream is supported only by review, plan, and apply.", jsonErrorOutput);
    process.exitCode = EXIT_CODES.usage_error;
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`dev-agent ${version}`);
    return;
  }

  const onceIndex = args.indexOf("--once");
  const oncePrompt = onceIndex >= 0 ? args[onceIndex + 1] : undefined;
  if (onceIndex >= 0 && !oncePrompt) {
    emitCliError("--once requires a prompt argument", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }

  const sessionIndex = args.indexOf("--session");
  const sessionId = sessionIndex >= 0 ? args[sessionIndex + 1] : undefined;
  if (sessionIndex >= 0 && !sessionId) {
    emitCliError("--session requires a session id", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const resumeIndex = args.indexOf("--resume");
  const resumeId = resumeIndex >= 0 ? args[resumeIndex + 1] : undefined;
  if (resumeIndex >= 0 && !resumeId) {
    emitCliError("--resume requires a session id", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  if (sessionId !== undefined && resumeId !== undefined) {
    emitCliError(
      "--resume cannot be combined with --session; choose one session id",
      jsonErrorOutput,
    );
    process.exitCode = 1;
    return;
  }
  if (
    resumeId !== undefined &&
    normalizeSessionId(resumeId) !== resumeId.trim().toLowerCase()
  ) {
    emitCliError(
      "--resume requires a safe session id containing only letters, numbers, '_' or '-'",
      jsonErrorOutput,
    );
    process.exitCode = 1;
    return;
  }
  const resetMemory = args.includes("--reset-memory");
  const noStream = args.includes("--no-stream");
  const nonInteractive = args.includes("--non-interactive");
  const cleanupEvidence = args.includes("--cleanup-evidence");
  const cleanupOptionsResult = parseCliEvidenceCleanupOptions(args, cleanupEvidence);
  if ("error" in cleanupOptionsResult) {
    emitCliError(cleanupOptionsResult.error, jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const auditOptionsResult = parseCliEvidenceAuditOptions(
    args,
    exportEvidence || previewEvidence,
    exportEvidence
  );
  if ("error" in auditOptionsResult) {
    emitCliError(auditOptionsResult.error, jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  if (cleanupEvidence && exportEvidence) {
    emitCliError(
      "--cleanup-evidence and --export-evidence cannot be used together",
      jsonErrorOutput
    );
    process.exitCode = 1;
    return;
  }
  if (previewEvidence && (cleanupEvidence || exportEvidence)) {
    emitCliError(
      "--preview-evidence cannot be combined with --cleanup-evidence or --export-evidence",
      jsonErrorOutput
    );
    process.exitCode = 1;
    return;
  }
  const sessionDeleteIndex = args.indexOf("--session-delete");
  const sessionDeleteId = sessionDeleteIndex >= 0 ? args[sessionDeleteIndex + 1] : undefined;
  if (sessionDeleteIndex >= 0 && sessionDeleteId === undefined) {
    emitCliError("--session-delete requires a session id", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const renameIndex = args.indexOf("--session-rename");
  const renameFrom = renameIndex >= 0 ? args[renameIndex + 1] : undefined;
  const renameTo = renameIndex >= 0 ? args[renameIndex + 2] : undefined;
  if (renameIndex >= 0 && (renameFrom === undefined || renameTo === undefined)) {
    emitCliError(
      "--session-rename requires both the current and the new session id",
      jsonErrorOutput
    );
    process.exitCode = 1;
    return;
  }
  const indexIndex = args.indexOf("--index");
  const indexPath = indexIndex >= 0 ? args[indexIndex + 1] : undefined;
  if (indexIndex >= 0 && indexPath === undefined) {
    emitCliError("--index requires a directory path", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const excludePaths = args
    .flatMap((arg, index) => (arg === "--exclude" ? [args[index + 1]] : []))
    .filter((path): path is string => path !== undefined);
  const cwdIndex = args.indexOf("--cwd");
  const cwdFlag = cwdIndex >= 0 ? args[cwdIndex + 1] : undefined;
  if (cwdIndex >= 0 && !cwdFlag?.trim()) {
    emitCliError("--cwd requires a directory path", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const a2aHost = flagValue(args, "--host");
  if (a2aHost !== undefined && a2aHost.trim() === "") {
    emitCliError("--host requires a host name or address", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  let a2aPort: number | undefined;
  try {
    a2aPort = parseA2aPort(flagValue(args, "--port"));
  } catch (error) {
    emitCliError(error instanceof Error ? error.message : String(error), jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const configIndex = args.indexOf("--config");
  const configFlag = configIndex >= 0 ? args[configIndex + 1] : undefined;
  if (configIndex >= 0 && !configFlag?.trim()) {
    emitCliError("--config requires a file path", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const projectState = args.includes("--project-state");
  const selectedSessionId = resumeId ?? sessionId ?? "default";
  const normalizedSessionId = normalizeSessionId(selectedSessionId);
  const workingDirectory = resolveWorkingDirectory(cwdFlag);
  assertWorkingDirectory(workingDirectory);
  if (resumeId !== undefined) {
    const resumePath = memoryFilePath(normalizedSessionId, workingDirectory, projectState);
    if (!existsSync(resumePath)) {
      emitCliError(`Session ${normalizedSessionId} was not found.`, jsonErrorOutput);
      process.exitCode = 1;
      return;
    }
  }
  if (excludePaths.length > 0 && indexPath === undefined) {
    emitCliError("--exclude requires --index", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const configPath = resolveConfigPath(
    configFlag,
    process.env,
    homedir(),
    workingDirectory,
    projectState
  );
  const executorIndex = args.indexOf("--executor");
  const executorFlagValue = executorIndex >= 0 ? args[executorIndex + 1] : undefined;
  let executorPreference: ExecutorPreference | undefined;
  try {
    executorPreference = parseExecutorPreference(executorFlagValue);
  } catch (error) {
    emitCliError(error instanceof Error ? error.message : String(error), jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const hasManagedRuntimeFlag = [
    "--runtime-version",
    "--runtime-release",
    "--runtime-dir",
    "--target",
  ].some((flag) =>
    args.includes(flag)
  );
  if (hasManagedRuntimeFlag && executorPreference !== "rust-sandbox") {
    emitCliError(
      "--runtime-version, --runtime-dir, and --target require --executor rust-sandbox outside runtime commands.",
      jsonErrorOutput
    );
    process.exitCode = 1;
    return;
  }
  const rustIndex = args.indexOf("--rust-executor");
  const rustFlag = rustIndex >= 0 ? args[rustIndex + 1] : undefined;
  if (rustIndex >= 0 && !rustFlag) {
    emitCliError(
      "--rust-executor requires a path to the dev-agent-executor binary",
      jsonErrorOutput
    );
    process.exitCode = 1;
    return;
  }
  const rustCheckIndex = args.indexOf("--check-rust");
  const rustCheckFlag = rustCheckIndex >= 0 ? args[rustCheckIndex + 1] : undefined;
  if (executorPreference === "local" && args.includes("--check-rust")) {
    emitCliError("--check-rust cannot be combined with --executor local.", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  // An explicit flag wins; otherwise DEV_AGENT_RUST_BINARY applies to real runs
  // too, not just --check-rust. Managed runtime selection is explicit and
  // fail-closed: it never installs or silently falls back to local execution.
  const legacyRustBinaryPath = resolveRustBinaryPath(rustFlag ?? rustCheckFlag);
  let rustBinaryPath: string | undefined;
  let runtimeSelectionSource: "explicit-path" | "runtime" | "environment" | "default-local" =
    "default-local";
  try {
    const managedRuntimeBinary =
      executorPreference === "rust-sandbox" && legacyRustBinaryPath === undefined
        ? await resolveManagedRuntimeBinary(args)
        : undefined;
    const selection = resolveExecutorSelection({
      executor: executorPreference,
      rustBinaryPath:
        executorPreference === "local" && rustFlag === undefined ? undefined : legacyRustBinaryPath,
      rustBinarySource:
        rustFlag !== undefined ? "flag" : process.env.DEV_AGENT_RUST_BINARY ? "environment" : undefined,
      runtimeBinary: managedRuntimeBinary,
    });
    if (selection.mode === "rust-sandbox") {
      runtimeSelectionSource = selection.source === "flag" ? "runtime" : selection.source;
    }
    rustBinaryPath = selection.mode === "rust-sandbox" ? selection.rustBinaryPath : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitCliError(message, jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  if (args.includes("--check-rust")) {
    await checkRust(rustBinaryPath);
    return;
  }

  const approvalIndex = args.indexOf("--approval");
  const approvalFlag = approvalIndex >= 0 ? args[approvalIndex + 1] : undefined;
  if (approvalIndex >= 0 && approvalFlag === undefined) {
    emitCliError(
      "--approval requires one of: allow, deny-dangerous, ask, review-writes",
      jsonErrorOutput
    );
    process.exitCode = 1;
    return;
  }
  const approvalFlagMode = approvalFlag === undefined ? undefined : parseApprovalMode(approvalFlag);
  if (approvalFlag !== undefined && approvalFlagMode === undefined) {
    emitCliError(
      `Unknown approval mode '${approvalFlag}'. Use allow, deny-dangerous, ask, or review-writes.`,
      jsonErrorOutput
    );
    process.exitCode = 1;
    return;
  }

  if (args.includes("--mcp-server")) {
    // Expose the built-in tools over MCP instead of running the agent. No model
    // provider is needed, and stdout carries only JSON-RPC frames.
    const config = loadConfig(configPath, process.env, workingDirectory, projectState);
    await runMcpServer({
      sessionId: normalizedSessionId,
      workingDirectory,
      projectState,
      rustBinaryPath,
      approvalMode: approvalFlagMode ?? resolveApprovalMode(config),
      approvalConfig: compileApprovalConfig(config.approval),
    });
    return;
  }

  if (args.includes("--doctor")) {
    const config = loadConfig(configPath, process.env, workingDirectory, projectState);
    const report = await runDoctor({
      providerId: resolveProviderId(config),
      rustBinaryPath,
      sessionDir: sessionDir(workingDirectory, projectState),
      configPath,
      checkUpdate: args.includes("--check-update"),
      cliVersion: version,
      projectState,
      configSource: configFlag || process.env.DEV_AGENT_CONFIG_FILE
        ? "explicit"
        : projectState
          ? "project"
          : "user",
      runtimeSource: executorPreference === "local" ? "default-local" : runtimeSelectionSource,
      managedRuntimeStatus:
        executorPreference === "local" ? undefined : resolveManagedRuntimeStatus(args),
    });
    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printDoctorReport(report);
    }
    if (report.summary.fail > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (sessionDeleteId !== undefined) {
    const id = normalizeSessionId(sessionDeleteId);
    let deleted = false;
    try {
      await rm(join(sessionDir(workingDirectory, projectState), `${id}.json`));
      deleted = true;
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw error;
      }
    }
    if (jsonOutput) {
      console.log(JSON.stringify({ sessionId: id, deleted }, null, 2));
    } else {
      console.log(deleted ? `Deleted session ${id}.` : `Session ${id} not found.`);
    }
    return;
  }

  if (renameFrom !== undefined && renameTo !== undefined) {
    const from = normalizeSessionId(renameFrom);
    const to = normalizeSessionId(renameTo);
    const source = join(sessionDir(workingDirectory, projectState), `${from}.json`);
    const target = join(sessionDir(workingDirectory, projectState), `${to}.json`);

    if (from !== to && existsSync(target)) {
      emitCliError(`Session ${to} already exists.`, jsonErrorOutput);
      process.exitCode = 1;
      return;
    }

    let renamed = false;
    if (from === to) {
      // Renaming a session to its own name is a no-op, not a missing session:
      // the old code fell through to "not found" even though the file was
      // there, which reads as data loss.
      if (!existsSync(source)) {
        emitCliError(`Session ${from} not found.`, jsonErrorOutput);
        process.exitCode = 1;
        return;
      }
    } else {
      try {
        await rename(source, target);
        renamed = true;
      } catch (error) {
        if (!(isNodeError(error) && error.code === "ENOENT")) {
          throw error;
        }
      }
    }

    if (jsonOutput) {
      console.log(JSON.stringify({ from, to, renamed }, null, 2));
    } else {
      console.log(
        renamed
          ? `Renamed session ${from} to ${to}.`
          : from === to
            ? `Session ${from} already has that name.`
            : `Session ${from} not found.`
      );
    }
    return;
  }

  if (indexPath !== undefined) {
    const indexRoot = resolve(workingDirectory, indexPath);
    const resolvedExcludes = excludePaths.map((path) => resolve(workingDirectory, path));
    const report = await indexDirectory(indexRoot, undefined, resolvedExcludes);
    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const languages = Object.entries(report.languages)
        .map(([language, count]) => `${language}: ${count}`)
        .join(", ");
      console.log(
        `Indexed ${report.files} files / ${report.symbols} symbols (${report.reused} reused)`
      );
      if (languages) {
        console.log(`Languages: ${languages}`);
      }
      if (report.excluded > 0) {
        console.log(`Excluded ${report.excluded} paths`);
      }
      for (const warning of report.warnings) {
        console.warn(
          `Warning: skipped directory ${safeTerminalText(warning.path)} (${warning.code})`
        );
      }
      console.log(
        report.written
          ? `Index written to ${safeTerminalText(report.indexPath)}`
          : "Index not written: serialized index exceeds the 16 MiB limit; the previous index was preserved."
      );
    }
    return;
  }

  if (previewEvidence) {
    const memory = createMemory(normalizedSessionId, workingDirectory, projectState);
    try {
      const validations = await memory.validations();
      const changeSets = await memory.changeSets();
      const evidenceSummary = await memory.evidenceSummary();
      const evidence = selectEvidenceForAudit(
        validations,
        changeSets,
        auditOptionsResult.filters
      );
      const preview = createEvidenceAuditPreview(
        normalizedSessionId,
        evidence.validations,
        evidence.changeSets,
        evidenceSummary
      );
      // Preview is intentionally JSON even without --json so callers can
      // inspect the fixed metadata contract before selecting export limits.
      console.log(JSON.stringify(preview, null, 2));
    } catch {
      // Do not echo persisted evidence errors, paths, or provider details.
      console.error("Evidence preview failed");
      process.exitCode = 1;
    }
    return;
  }

  if (exportEvidence) {
    const memory = createMemory(normalizedSessionId, workingDirectory, projectState);
    try {
      const validations = await memory.validations();
      const changeSets = await memory.changeSets();
      const evidenceSummary = await memory.evidenceSummary();
      const evidence = selectEvidenceForAudit(
        validations,
        changeSets,
        auditOptionsResult.filters
      );
      const audit = createEvidenceAuditExport(
        normalizedSessionId,
        evidence.validations,
        evidence.changeSets,
        evidenceSummary,
        auditOptionsResult.limits === undefined
          ? {}
          : { limits: auditOptionsResult.limits }
      );
      // This command is intentionally JSON even without --json so callers can
      // redirect it directly to an audit artifact.
      console.log(JSON.stringify(audit, null, 2));
    } catch (error) {
      if (error instanceof EvidenceAuditLimitError) {
        console.error(
          JSON.stringify({
            error: "evidence audit limit exceeded",
            code: EVIDENCE_AUDIT_LIMIT_ERROR_CODE,
            kind: error.kind,
            limit: error.limit,
            actual: error.actual,
          })
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.error(safeTerminalText(`Evidence export failed: ${message}`));
      }
      process.exitCode = 1;
    }
    return;
  }

  if (cleanupEvidence) {
    const memory = createMemory(normalizedSessionId, workingDirectory, projectState);
    try {
      const result = await memory.pruneEvidence(cleanupOptionsResult.options);
      const evidenceSummary = await memory.evidenceSummary();
      printEvidenceCleanupResult(
        normalizedSessionId,
        result,
        evidenceSummary,
        jsonOutput
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (jsonOutput) {
        console.log(JSON.stringify({ error: message, sessionId: normalizedSessionId }, null, 2));
      } else {
        console.error(safeTerminalText(`Evidence cleanup failed: ${message}`));
      }
      process.exitCode = 1;
    }
    return;
  }

  const providerFreeCommand =
    args.includes("--tools") ||
    args.includes("--metadata") ||
    args.includes("--session-list") ||
    args.includes("--session-delete") ||
    args.includes("--session-rename") ||
    args.includes("--compact") ||
    args.includes("--index") ||
    args.includes("--doctor") ||
    args.includes("--check-rust") ||
    args.includes("--mcp-server") ||
    args.includes("--cleanup-evidence") ||
    args.includes("--export-evidence") ||
    args.includes("--preview-evidence") ||
    args.includes("--a2a");
  if (nonInteractive && oncePrompt === undefined && !providerFreeCommand) {
    const decision = createNonInteractiveController({ interactive: false }).guard({ kind: "input" });
    const payload = {
      error: {
        code: "needs_input",
        reason: decision.allowed ? undefined : decision.reason,
        message: "--non-interactive requires --once or a provider-free command.",
      },
    };
    if (jsonErrorOutput) console.log(JSON.stringify(payload, null, 2));
    else console.error(payload.error.message);
    process.exitCode = decision.allowed ? EXIT_CODES.execution_error : decision.exitCode;
    return;
  }

  const mcpSessions: McpServerSession[] = [];
  let executor: ReturnType<typeof createExecutor> | undefined;
  let collaborationWorkspaces: GitCollaborationWorkspaceProvider | undefined;
  try {
    const config = loadConfig(configPath, process.env, workingDirectory, projectState);
    const resolvedConfigPath = resolveConfigPath(
      configPath,
      process.env,
      homedir(),
      workingDirectory,
      projectState,
    );
    const approvalMode = approvalFlagMode ?? resolveApprovalMode(config);
    const collaborationScope = resolveCollaborationToolAllowlist(config);
    if (!collaborationScope.valid) {
      emitCliError(collaborationScope.message, jsonErrorOutput);
      process.exitCode = EXIT_CODES.execution_error;
      return;
    }
    const collaborationToolAllowlist = collaborationScope.toolAllowlist;
    if (nonInteractive && oncePrompt !== undefined && (approvalMode === "ask" || approvalMode === "review-writes")) {
      const decision = createNonInteractiveController({ interactive: false }).guard({ kind: "approval" });
      const payload = {
        error: {
          code: "policy_denied",
          reason: decision.allowed ? undefined : decision.reason,
          message: "The selected approval mode requires interactive input.",
        },
      };
      if (jsonErrorOutput) console.log(JSON.stringify(payload, null, 2));
      else console.error(payload.error.message);
      process.exitCode = decision.allowed ? EXIT_CODES.execution_error : decision.exitCode;
      return;
    }
    const questionBox: QuestionBox = {};
    const tuiSession = new TuiSessionModel();
    executor = createExecutor({ rustBinaryPath });
    const activeCollaborationWorkspaces = new GitCollaborationWorkspaceProvider({
      rootDirectory: workingDirectory,
      executor,
    });
    collaborationWorkspaces = activeCollaborationWorkspaces;
    const tools = new AgentToolRegistry();
    for (const tool of createDefaultTools(executor)) {
      tools.register(tool);
    }
    const filesystem = tools.get("filesystem");
    const validation = createCliValidationAdapter(executor, resolveValidationPolicy(config));
    const approval = buildApprovalPolicy(
      approvalMode,
      questionBox,
      config,
      filesystem instanceof FilesystemTool ? filesystem : undefined
    );

    let mcpSupplement = "";
    if (args.includes("--tools") || !providerFreeCommand || args.includes("--a2a")) {
      mcpSupplement = await registerMcpTools(
        tools,
        mcpSessions,
        {
          sessionId: normalizedSessionId,
          workingDirectory,
        },
        config,
        (updated) => {
          mcpSupplement = updated;
        }
      );
    }

    if (args.includes("--tools")) {
      if (jsonOutput) {
        console.log(
          JSON.stringify(
            tools.list().map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              metadata: tools.metadata(tool.name),
            })),
            null,
            2
          )
        );
        return;
      }
      for (const tool of tools.list()) {
        console.log(
          `${safeTerminalText(tool.name)}: ${safeTerminalText(tool.description)} ` +
            `[${safeTerminalText(tools.metadata(tool.name)?.risk ?? "read-only")}, ` +
            `${safeTerminalText(tools.metadata(tool.name)?.confirmation ?? "never")}]`
        );
      }
      return;
    }

    if (args.includes("--metadata")) {
      const memory = createMemory(normalizedSessionId, workingDirectory, projectState);
      const filePath = memoryFilePath(normalizedSessionId, workingDirectory, projectState);
      const meta = await memory.getMetadata();
      if (!meta && (await isInvalidMemoryFile(filePath, memory))) {
        if (jsonOutput) {
          console.log(
            JSON.stringify({ error: "invalid memory file", path: filePath }, null, 2)
          );
        } else {
          console.error(
            safeTerminalText(
              `Invalid memory file: ${filePath}. Use --reset-memory or --session-delete ${normalizedSessionId} to recover.`
            )
          );
        }
        process.exitCode = 1;
        return;
      }
      const evidenceSummary = await memory.evidenceSummary();
      if (jsonOutput) {
        console.log(
          JSON.stringify(
            meta === null || meta === undefined
              ? meta ?? null
              : { ...meta, evidenceSummary },
            null,
            2
          )
        );
        return;
      }
      if (meta) {
        console.log(`Session: ${safeTerminalText(meta.sessionId)}`);
        console.log(`Created: ${safeTerminalText(meta.createdAt)}`);
        console.log(`Last active: ${safeTerminalText(meta.lastActiveAt)}`);
        console.log(`Entries: ${meta.entryCount}`);
        if (meta.usage) {
          console.log(
            `Usage: prompt=${meta.usage.promptTokens} completion=${meta.usage.completionTokens} total=${meta.usage.totalTokens}`
          );
        }
        printEvidenceSummary(evidenceSummary);
      } else {
        console.log("No session metadata found.");
      }
      return;
    }

    if (args.includes("--session-list")) {
      await listSessions(jsonOutput, workingDirectory, projectState);
      return;
    }

    const compactIndex = args.indexOf("--compact");
    if (compactIndex >= 0) {
      const keepTurns = Number.parseInt(args[compactIndex + 1] ?? "5", 10);
      if (!Number.isInteger(keepTurns) || keepTurns < 1) {
        emitCliError("--compact requires a positive integer argument", jsonErrorOutput);
        process.exitCode = 1;
        return;
      }
      const memory = createMemory(normalizedSessionId, workingDirectory, projectState);
      const removed = await memory.compact(keepTurns);
      if (jsonOutput) {
        console.log(JSON.stringify({ removed, keptTurns: keepTurns }, null, 2));
        return;
      }
      console.log(`Compacted session memory: removed ${removed} entries, keeping ${keepTurns} recent turns.`);
      return;
    }

    // Provider construction is intentionally delayed until after provider-free
    // commands. This lets commands such as --tools and --metadata inspect a
    // project even when its configured provider has no credentials locally.
    let modelSelection: ModelSelectionResult;
    try {
      modelSelection = resolveModelSelection({
        config: config as unknown as { readonly [key: string]: unknown },
        provider: flagValue(args, "--provider"),
        model: flagValue(args, "--model"),
        profile: flagValue(args, "--profile"),
        alias: flagValue(args, "--alias"),
        env: process.env,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model selection failed.";
      const legacyProvider = flagValue(args, "--provider") ?? process.env.DEV_AGENT_MODEL_PROVIDER ?? config.defaultProvider;
      const startupMessage = message === "Model provider is not supported." && legacyProvider
        ? `Unsupported model provider '${legacyProvider}'. Phase 1 supports ollama, openai, anthropic, and gemini.`
        : message;
      emitCliError(startupMessage, jsonErrorOutput);
      // Preserve the legacy startup failure code for the normal agent path.
      // Explicit provider/config commands use stable typed exit codes.
      process.exitCode = 1;
      return;
    }
    let activeModelSelection = modelSelection;
    const speedMode = new ModelSpeedModeController();
    const modelRoutingConfig = resolveModelRoutingConfig(config.routing);
    const modelRouting = new ModelRoutingController(speedMode);
    if (modelRoutingConfig.mode === "manual") modelRouting.setManualMode(speedMode.mode);
    const baseProvider = createProvider(
      config,
      modelSelection,
      (next) => {
        activeModelSelection = next;
      },
      speedMode,
    );
    const adaptiveProvider = new AdaptiveModelProvider({
      controller: modelRouting,
      initial: baseProvider,
      getProvider: (mode, policy, previous) => {
        if (policy === "auto") speedMode.setMode(mode);
        return previous;
      },
    });
    const modelBudget = new SessionModelBudget(modelRoutingConfig.budget, config.pricing);
    const provider = modelBudget.wrap(adaptiveProvider);
    const projectContext = new ProjectContextManager({ workingDirectory });
    await projectContext.refresh();
    const createConfiguredSpecialistRoles = () => resolveSpecialistRoles({
      configured: config.collaboration?.roles,
      tools,
      toolCeiling: collaborationToolAllowlist,
      createModel: ({ provider: roleProvider, model: roleModel }) => {
        const selectedProvider = (roleProvider ?? activeModelSelection.selection.provider) as ModelSelection["provider"];
        const selectedModel = roleModel ?? (roleProvider === undefined
          ? activeModelSelection.selection.model
          : undefined);
        return modelBudget.wrap(new SpeedModeModelProvider(
          createConcreteModelProvider(config, {
            provider: selectedProvider,
            ...(selectedModel === undefined ? {} : { model: selectedModel }),
          }),
          speedMode,
        ));
      },
    });
    if (args.includes("--a2a")) {
      const { runA2aServer } = await import("./a2a-server.js");
      await runA2aServer({
        name: "dev-agent",
        version,
        provider,
        tools,
        executor,
        validation,
        approvalMode,
        approvalConfig: compileApprovalConfig(config.approval),
        mcpSupplement,
        maxTurns: resolveMaxTurns(config, 8),
        budget: resolveAgentLoopBudget(config, args),
        contextBudget: buildContextBudget(config, false),
        createMemory: (sessionId, sessionWorkingDirectory) =>
          createMemory(sessionId, sessionWorkingDirectory, projectState),
        restoreChangeSets: restorePersistedChangeSets,
        workingDirectory,
        projectContext,
        host: a2aHost,
        port: a2aPort,
      });
      return;
    }
    if (args.includes("--acp")) {
      await runAcpServer({
        name: "dev-agent",
        version,
        provider,
        tools,
        executor,
        validation,
        approvalMode,
        approvalConfig: compileApprovalConfig(config.approval),
        mcpSupplement,
        maxTurns: resolveMaxTurns(config, 8),
        budget: resolveAgentLoopBudget(config, args),
        contextBudget: buildContextBudget(config, false),
        createMemory: (sessionId, sessionWorkingDirectory) =>
          createMemory(sessionId, sessionWorkingDirectory, projectState),
        restoreChangeSets: restorePersistedChangeSets,
        projectContext,
      });
      return;
    }
    const streamingEnabled =
      !noStream && !jsonOutput && typeof provider.streamChat === "function";
    const tuiRenderer = resolveTuiRenderer({
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
      once: oncePrompt !== undefined,
      json: jsonOutput,
      mcpServer: args.includes("--mcp-server"),
      env: process.env,
    });
    const richUi = tuiRenderer !== "none";
    const inkUi = tuiRenderer === "ink";
    const inkStore = inkUi ? new InkRuntimeStore() : undefined;
    const inkController = inkUi ? new InkUiController() : undefined;
    if (inkController) {
      inkController.setTheme(resolveInkTheme(config, process.env));
    }
    if (!jsonOutput && !richUi) {
      console.log(
        `[runtime] provider=${safeTerminalText(provider.id)} model=${safeTerminalText(provider.model)} streaming=${
          streamingEnabled ? "enabled" : "disabled"
        }`
      );
    }

    const memory = createMemory(normalizedSessionId, workingDirectory, projectState);
    if (resetMemory) {
      await memory.clear();
    }
    const checkpointStore = new FileMemoryCheckpointStore(memory);
    const createCliContext = (session: string): AgentContext =>
      createAgentContext("cli", createMemory(session, workingDirectory, projectState), {
        sessionId: session,
        workingDirectory,
        metadata: {
          cliVersion: version,
          provider: provider.id,
          model: provider.model,
          modelSelection: formatModelSelectionMetadata(modelSelection),
        },
      });
    const context = createAgentContext("cli", memory, {
      sessionId: normalizedSessionId,
      workingDirectory,
      metadata: {
        cliVersion: version,
        provider: provider.id,
        model: provider.model,
        modelSelection: formatModelSelectionMetadata(modelSelection),
      },
    });
    if (filesystem instanceof FilesystemTool) {
      await restorePersistedChangeSets(filesystem, context);
    }
    const openSession = async (session: string): Promise<AgentContext> => {
      const next = createCliContext(session);
      if (filesystem instanceof FilesystemTool) {
        await restorePersistedChangeSets(filesystem, next);
      }
      return next;
    };
    const createRerunValidation = (
      activeContext: AgentContext,
    ): ValidationRerunner | undefined =>
      filesystem instanceof FilesystemTool
        ? (changeSetId: string, signal?: AbortSignal) =>
            runExplicitValidation(filesystem, validation, activeContext, changeSetId, signal)
        : undefined;
    const rerunValidation = createRerunValidation(context);
    // Token streaming would interleave with the JSON document.
    const streaming = new StreamingRun({
      enabled: streamingEnabled && !inkUi,
      richUi: false,
      width: resolveTerminalWidth(),
      session: tuiSession,
    });
    const reviews: ReviewRecord[] = [];
    const validations: ValidationResult[] = [];
    const activeSkillState: ActiveSkillState = {};
    const hooks = new AgentHookRegistry();
    const trace = new AgentRunTrace(hooks);
    const tasks = new AgentTaskScheduler({ concurrency: 1 });
    const taskStatusBridge = createTaskStatusBridge();
    const backgroundJobs = new BackgroundJobManager({
      jobsDirectory: join(homedir(), ".dev-agent", "jobs"),
      workingDirectory,
      configPath: resolvedConfigPath,
      provider: activeModelSelection.selection.provider,
      ...(activeModelSelection.selection.model === undefined
        ? {}
        : { model: activeModelSelection.selection.model }),
      projectState,
      entrypoint: resolve(process.argv[1] ?? fileURLToPath(import.meta.url)),
      approvalMode,
    });
    let latestPlanReview: PlanReview | undefined;
    const toolSandboxProfile = isSandboxExecutor(executor)
      ? (_toolName: string, toolContext: AgentContext) =>
          createBuiltInToolSandboxProfile(_toolName, toolContext.workingDirectory)
      : undefined;
    const onSandboxExpansion = (request: SandboxExpansionRequest) =>
      requestCliSandboxExpansion(request, questionBox);
    const loop = new AgentLoop({
      model: provider,
      tools,
      hooks,
      streamModelResponses: streamingEnabled,
      toolSandboxProfile,
      onSandboxExpansion,
      eventSink: (event) => {
        trace.recordRuntimeEvent(event);
        if (inkStore) {
          inkStore.apply(event);
        }
      },
      onApprovalStatus: (status) => {
        if (status === "waiting") {
          taskStatusBridge.waiting();
        } else {
          taskStatusBridge.running();
        }
      },
      onPlanReview: (review) => {
        latestPlanReview = review;
      },
      systemPromptProvider: () =>
        composePrompt([
          ...DEFAULT_CLI_PROMPT_MODULES,
          ...projectContext.promptModules(),
          { id: "active-skill", content: renderActiveSkillPrompt(activeSkillState) },
          { id: "mcp", content: mcpSupplement },
        ]),
      maxTurns: resolveMaxTurns(config, 8),
      maxRepeatedToolFailures:
        oncePrompt === undefined ? undefined : DEFAULT_ONCE_MAX_REPEATED_TOOL_FAILURES,
      finalizeOnMaxTurns: oncePrompt !== undefined,
      budget: resolveAgentLoopBudget(config, args),
      contextBudget: buildContextBudget(config, oncePrompt !== undefined),
      toolDefaults:
        oncePrompt === undefined
          ? undefined
          : { maxOutputChars: DEFAULT_ONCE_TOOL_OUTPUT_CHARS },
      approval,
      onApproval: (request, outcome) => {
        if (request.review) {
          reviews.push({
            changeSetId: request.review.changeSetId,
            decision: outcome.decision,
            files: [...request.review.files],
            additions: request.review.additions,
            deletions: request.review.deletions,
          });
        }
        const review = request.review;
        const detail = review
          ? `${review.files.length} file(s), +${review.additions}/-${review.deletions}`
          : outcome.reason ?? "tool call decision recorded";
        streaming.approvalResolved(request.toolName, outcome.decision, detail);
        // Nothing may interleave with the JSON document on stdout.
        if (!jsonOutput && richUi && !inkUi) {
          streaming.withComposerHidden(() => {
            process.stdout.write(
              `${renderApprovalMessage(request.toolName, outcome.decision, detail, {
                width: resolveTerminalWidth(),
              })}\n`
            );
          });
        } else if (!jsonOutput && !inkUi && outcome.decision === "deny") {
          const line = `[denied] ${safeTerminalText(request.toolName)} ${safeTerminalText(
            outcome.reason ?? ""
          )}`.trimEnd();
          process.stdout.write(`${richUi ? colorize(line, "yellow") : line}\n`);
        }
      },
      onValidation: (result) => {
        validations.push(result);
        streaming.validationResult(result.status, result.summary);
        if (!jsonOutput && !inkUi) {
          if (richUi) {
            streaming.withComposerHidden(() => {
              printValidationResult(result, true, resolveTerminalWidth());
            });
          } else {
            printValidationResult(result, false, resolveTerminalWidth());
          }
        }
      },
      validation,
      onTurn: (turn) => {
        if (!jsonOutput && !inkUi) {
          if (richUi) {
            streaming.commitLive();
            streaming.withComposerHidden(() => {
              process.stdout.write(`\n${colorize(`Turn ${turn}`, "dim")}\n`);
            });
          } else {
            if (streaming.isEnabled() && streaming.hasStreamed()) {
              process.stdout.write("\n");
            }
            process.stdout.write(`[turn ${turn}]\n`);
          }
        }
      },
      onToolProgress: (progress) => {
        streaming.toolProgress(progress.name, `${progress.progress}${progress.total === undefined ? "" : `/${progress.total}`}`);
        if (!jsonOutput && !inkUi) {
          if (richUi) {
            return;
          }
          const total = progress.total === undefined ? "" : `/${progress.total}`;
          const line = `[tool-progress] ${safeTerminalText(progress.name)} ${progress.progress}${total}`;
          process.stdout.write(
            `${line}\n`
          );
        }
      },
      ...streaming.callbacks(),
    });

    if (oncePrompt) {
      const prepared = await prepareInteractivePrompt(oncePrompt, workingDirectory);
      const attachedContext = [prepared.context, options.jobAttachedContext]
        .filter((value): value is string => value !== undefined && value.trim() !== "")
        .join("\n\n") || undefined;
      const result = await runPrompt(
        loop,
        context,
        streaming,
        prepared.prompt,
        jsonOutput,
        {
          model: () => provider.model,
          pricing: config.pricing,
          selection: () => activeModelSelection,
          trace,
          speedMode: () => speedMode.mode,
          projectContext,
        },
        reviews,
        validations,
        options.startupSignal,
        attachedContext === undefined ? {} : { attachedContext },
      );
      if (result.state.status === "error") {
        process.exitCode = 1;
      }
      return;
    }

    const skillRegistry = await SkillRegistry.load({ workingDirectory });
    const extensionRegistry = await ExtensionRegistry.load({ workingDirectory });
    const projectMemory = new ProjectMemoryStore({
      filePath: projectMemoryFilePath(workingDirectory, projectState),
    });
    await interactive(loop, context, streaming, questionBox, {
      rich: richUi,
      ink:
        inkStore === undefined || inkController === undefined
          ? undefined
          : {
              store: inkStore,
              controller: inkController,
              persistTheme: (theme) => persistInkTheme(resolvedConfigPath, theme),
            },
      provider: provider.id,
      model: provider.model,
      streaming: streamingEnabled,
      mcpCount: mcpSessions.length,
      executor: getExecutorMode(executor),
      session: tuiSession,
      sessionId: normalizedSessionId,
      sessionDirectory: sessionDir(workingDirectory, projectState),
      workingDirectory,
      width: resolveTerminalWidth(),
      skills: skillRegistry,
      extensions: extensionRegistry,
      activeSkill: activeSkillState,
      trace,
      speedMode,
      modelRouting,
      modelBudget,
      projectContext,
      benchmark: (prompt) => benchmarkModel(provider, prompt),
      tasks,
      taskStatusBridge,
      backgroundJobs,
      checkpointStore,
      createCheckpointStore: (activeContext) =>
        new FileMemoryCheckpointStore(activeContext.memory),
      openSession,
      createRerunValidation,
      runGitWorkflow: (command, confirm, signal) =>
        executeGitWorkflowCommand(command, {
          cwd: workingDirectory,
          runner: (executable, args, runOptions) =>
            executor!.run(executable, args, {
              cwd: runOptions?.cwd ?? workingDirectory,
              signal: runOptions?.signal,
              timeoutMs: runOptions?.timeoutMs,
              maxOutputBytes: runOptions?.maxOutputBytes,
            }),
          confirm,
          signal,
        }),
      projectMemory,
      runCollaborativePlan: (prompt, activeContext, options) => {
        const roles = createConfiguredSpecialistRoles();
        return runCollaborativePlanWorkflow(prompt, {
          model: provider,
          tools,
          roles,
          workingDirectory: activeContext.workingDirectory,
          sessionId: activeContext.sessionId,
          signal: options?.signal,
          attachedContext: joinPromptContext(
            projectContext.promptModules().map((module) => module.content),
            options?.attachedContext,
          ),
          maxTurns: 4,
        });
      },
      startCollaborativeExecution: async (prompt, activeContext, options) => {
        const roleBindings = createConfiguredSpecialistRoles();
        const activeTools = tools.list();
        const activeToolNames = activeTools.map((tool) => tool.name);
        const unavailableCeilingNames = collaborationToolAllowlist?.filter(
          (name) => !activeToolNames.includes(name),
        ) ?? [];
        if (unavailableCeilingNames.length > 0) {
          throw new Error(
            `collaboration.toolAllowlist contains unavailable tools: ${unavailableCeilingNames.map(safeTerminalText).join(", ")}`,
          );
        }
        const plannedTasks = options?.tasks === undefined
          ? await planCollaborativeTasks(prompt, {
              model: provider,
              signal: options?.signal,
            })
          : options.tasks;
        const tasks = createCollaborationTaskGraph(plannedTasks).tasks;
        if (questionBox.ask === undefined || questionBox.askText === undefined) {
          throw new Error("per-task tool-scope review requires interactive input");
        }
        const review = await reviewCollaborationTaskToolScopes({
          tasks,
          availableToolNames: collaborationToolAllowlist ?? activeToolNames,
          ask: (reviewPrompt, signal, mode) => mode === "confirmation"
            ? questionBox.ask!(reviewPrompt, signal)
            : questionBox.askText!(reviewPrompt, signal),
          signal: options?.signal,
        });
        if (review.status !== "confirmed") {
          throw new CollaborationScopeReviewCancelledError();
        }
        return createCollaborativeExecution({
          model: provider,
          tools,
          roleBindings,
          prompt,
          tasks: review.tasks,
          workspaceProvider: activeCollaborationWorkspaces,
          workingDirectory: activeContext.workingDirectory,
          sessionId: activeContext.sessionId,
          toolSandboxProfile,
          onSandboxExpansion,
          reviewedToolScopes: review.reviewedToolScopes,
          ...(collaborationToolAllowlist === undefined
            ? {}
            : { toolScopeCeiling: collaborationToolAllowlist }),
          signal: options?.signal,
          attachedContext: joinPromptContext(
            projectContext.promptModules().map((module) => module.content),
            options?.attachedContext,
          ),
          maxTurns: 4,
          onEvent: options?.onEvent,
        });
      },
      mergeCollaborativeReview: (review, options) =>
        activeCollaborationWorkspaces.merge(review, {
          signal: options?.signal ?? new AbortController().signal,
        }),
      disposeCollaborativeWorkspaces: () => activeCollaborationWorkspaces.disposeAll(),
      consumePlanReview: () => {
        const review = latestPlanReview;
        latestPlanReview = undefined;
        return review;
      },
    }, jsonOutput, {
      model: () => provider.model,
      pricing: config.pricing,
      selection: () => activeModelSelection,
      trace,
      speedMode: () => speedMode.mode,
      projectContext,
    }, reviews, validations, rerunValidation);
  } finally {
    await Promise.all(mcpSessions.map((session) => session.close()));
    await collaborationWorkspaces?.disposeAll().catch(() => undefined);
    await executor?.dispose?.();
  }
}

async function runInternalBackgroundJobWorker(
  id: string,
  startupSignal?: AbortSignal,
): Promise<void> {
  const store = new BackgroundJobStore(join(homedir(), ".dev-agent", "jobs"));
  const record = await store.internalRecord(id);
  const entrypoint = resolve(process.argv[1] ?? fileURLToPath(import.meta.url));
  const manager = new BackgroundJobManager({
    jobsDirectory: store.rootDirectory,
    workingDirectory: record.projectRoot,
    configPath: record.configPath,
    provider: record.provider,
    ...(record.model === undefined ? {} : { model: record.model }),
    projectState: record.projectState,
    entrypoint,
    approvalMode: "deny-dangerous",
  });
  await manager.runWorker(id, {
    ...(startupSignal === undefined ? {} : { signal: startupSignal }),
    run: async (input) => {
      if (!input.record.worktreePath) {
        throw new Error("background job has no validated worktree");
      }
      const args = [
        process.execPath,
        entrypoint,
        "--once",
        input.request.prompt,
        "--cwd",
        resolveBackgroundJobWorkingDirectory(input.record),
        "--session",
        input.record.sessionId,
        "--config",
        input.record.configPath,
        "--provider",
        input.record.provider,
        "--approval",
        "deny-dangerous",
        "--non-interactive",
        "--no-stream",
        "--json",
        ...(input.record.model === undefined ? [] : ["--model", input.record.model]),
        ...(input.record.projectState ? ["--project-state"] : []),
      ];
      process.exitCode = 0;
      await main(args, {
        startupSignal: input.signal,
        ...(input.request.attachedContext === undefined
          ? {}
          : { jobAttachedContext: input.request.attachedContext }),
      });
      return process.exitCode ?? 0;
    },
  });
}

function createMemory(
  sessionId = "default",
  baseDirectory = process.cwd(),
  projectState = false
): FileMemory {
  // Keep this consistent with sessionDir() so sessions written by the CLI are
  // the same ones --session-list and --compact operate on.
  return new FileMemory({
    filePath: memoryFilePath(sessionId, baseDirectory, projectState),
    sessionId,
  });
}

function resolveRuntimePath(value: string | undefined, baseDirectory: string): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return resolve(baseDirectory, value);
}

function memoryFilePath(
  sessionId = "default",
  baseDirectory = process.cwd(),
  projectState = false
): string {
  return (
    resolveRuntimePath(process.env.DEV_AGENT_MEMORY_FILE, baseDirectory) ??
    join(sessionDir(baseDirectory, projectState), `${sessionId}.json`)
  );
}

function projectMemoryFilePath(
  baseDirectory = process.cwd(),
  projectState = false,
): string {
  const configured = resolveRuntimePath(process.env.DEV_AGENT_PROJECT_MEMORY_FILE, baseDirectory);
  if (configured !== undefined) return configured;
  if (projectState) return join(baseDirectory, ".dev-agent", "project-memory.json");
  const projectKey = createHash("sha256")
    .update(resolve(baseDirectory))
    .digest("hex")
    .slice(0, 24);
  return join(homedir(), ".dev-agent", "project-memory", `${projectKey}.json`);
}

/** True when the file exists but cannot be read back as a memory file. */
async function isInvalidMemoryFile(filePath: string, memory: FileMemory): Promise<boolean> {
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    await memory.entries();
    return false;
  } catch {
    return true;
  }
}

/** Throws when a policy denies a call, so MCP answers with `isError: true`. */
async function assertMcpCallAllowed(
  policy: ApprovalPolicy,
  request: ApprovalRequest
): Promise<void> {
  let outcome;
  try {
    outcome = await policy.decide(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[denied by approval policy] ${message}`);
  }

  const decision = typeof outcome === "string" ? outcome : outcome.decision;
  if (decision === "deny") {
    const reason = typeof outcome === "string" ? undefined : outcome.reason;
    throw new Error(`[denied by approval policy] ${reason ?? "the call was denied"}`);
  }
}

async function runMcpServer(options: {
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly projectState: boolean;
  readonly rustBinaryPath?: string;
  readonly approvalMode: ApprovalMode;
  readonly approvalConfig: CompiledApprovalConfig;
}): Promise<void> {
  const executor = createExecutor({ rustBinaryPath: options.rustBinaryPath });
  const tools = createDefaultTools(executor);
  const filesystem = tools.find(
    (tool): tool is FilesystemTool => tool instanceof FilesystemTool
  );
  const memory = createMemory(options.sessionId, options.workingDirectory, options.projectState);
  // MCP has no interactive channel, so the shared policy factory makes `ask`
  // fail closed while retaining the same review preparation boundary.
  const policy = createApprovalPolicy({
    mode: options.approvalMode,
    patterns: options.approvalConfig.patterns,
    allowlist: options.approvalConfig.allowlist,
    prepare: filesystem
      ? (request) =>
          filesystem.prepareChangeSet(request.input, {
            sessionId: request.sessionId,
            workingDirectory: request.workingDirectory,
          })
      : undefined,
  });
  const server = createMcpServer({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (input: unknown, context) => {
        const sessionId = context?.sessionId ?? options.sessionId;
        const workingDirectory = context?.workingDirectory ?? options.workingDirectory;
        if (policy) {
          await assertMcpCallAllowed(policy, {
            toolName: tool.name,
            input,
            sessionId,
            workingDirectory,
          });
        }
        const sandbox = isSandboxExecutor(executor)
          ? createBuiltInToolSandboxProfile(tool.name, workingDirectory)
          : undefined;
        return tool.execute(input, {
          sessionId,
          workingDirectory,
          signal: context?.signal,
          ...(sandbox === undefined ? {} : { sandbox }),
        });
      },
    })),
    resources: [
      {
        uri: "dev-agent://session",
        name: "Session",
        description: "Session id, working directory, timestamps, and memory size.",
        mimeType: "text/plain",
        async read() {
          const entries = await memory.entries();
          const metadata = await memory.getMetadata();
          return [
            `session: ${options.sessionId}`,
            `working directory: ${options.workingDirectory}`,
            `entries: ${entries.length}`,
            `created: ${metadata?.createdAt ?? "unknown"}`,
            `last active: ${metadata?.lastActiveAt ?? "unknown"}`,
          ].join("\n");
        },
      },
      {
        ...createWorkspaceResource(options.workingDirectory),
      },
    ],
    prompts: [
      {
        name: "review-changes",
        description: "Review the uncommitted changes in this workspace.",
        get: () => ({
          description: "Review the working tree.",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: "Review the uncommitted changes in this workspace. Start with git status and git diff, then summarise risks, missing tests, and anything that looks accidental.",
              },
            },
          ],
        }),
      },
      {
        name: "explain-codebase",
        description: "Explain how this codebase is put together.",
        arguments: [
          { name: "focus", description: "Area or module to focus on", required: false },
        ],
        get: (args) => ({
          description: "Explain the codebase structure.",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Explain the structure of this codebase${
                  args?.focus ? ` with a focus on ${args.focus}` : ""
                }. Cover the entry points, the main modules, and how data flows between them.`,
              },
            },
          ],
        }),
      },
    ],
    name: "dev-agent",
    version,
    sessionId: options.sessionId,
    workingDirectory: options.workingDirectory,
  });
  try {
    await server.start();
  } finally {
    await executor.dispose?.();
  }
}

export function createWorkspaceResource(workingDirectory: string): McpServerResource {
  return {
    uri: "dev-agent://workspace",
    name: "Workspace",
    description: "Top-level entries of the working directory.",
    mimeType: "text/plain",
    async read(context) {
      const maxBytes = context?.maxBytes ?? Number.POSITIVE_INFINITY;
      const header = `working directory: ${workingDirectory}`;
      let boundedHeader = header;
      while (Buffer.byteLength(boundedHeader, "utf8") > maxBytes && boundedHeader.length > 0) {
        boundedHeader = boundedHeader.slice(0, -1);
      }
      let text = boundedHeader;
      if (Buffer.byteLength(text, "utf8") >= maxBytes) {
        return text;
      }

      const lines: string[] = [];
      const directory = await opendir(workingDirectory);
      for await (const entry of directory) {
        const line = `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`;
        const nextLines = [...lines, line].sort((left, right) => left.localeCompare(right));
        const candidate = [boundedHeader, ...nextLines].join("\n");
        if (Buffer.byteLength(candidate, "utf8") > maxBytes) {
          break;
        }
        lines.splice(0, lines.length, ...nextLines);
        text = candidate;
      }
      return text;
    },
  };
}

function buildContextBudget(
  config: CliConfig,
  once = false
): { maxChars?: number; summarize?: boolean; summaryMaxChars?: number } | undefined {
  const maxChars = resolveMaxContextChars(config);
  const summarize = resolveSummarizeContext(config);
  const summaryMaxChars = resolveSummaryMaxChars(config);
  if (once && maxChars === undefined && !summarize) {
    return { maxChars: DEFAULT_ONCE_CONTEXT_CHARS };
  }
  if (maxChars === undefined && !summarize) {
    return undefined;
  }
  return { maxChars, summarize, summaryMaxChars };
}

/** Filled in by the interactive loop so approval prompts share its reader. */
interface QuestionBox {
  ask?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  askText?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  onApprovalRequest?: (tool: string, detail: string, diff?: string) => void;
  onApprovalResolved?: (tool: string, decision: "allow" | "deny", detail: string) => void;
}

interface ReviewRecord {
  readonly changeSetId: string;
  readonly decision: "allow" | "deny";
  readonly files: ChangeSetReview["files"];
  readonly additions: number;
  readonly deletions: number;
}

function buildApprovalPolicy(
  mode: ApprovalMode,
  questionBox: QuestionBox,
  config: CliConfig = {},
  filesystem?: FilesystemTool
): ApprovalPolicy | undefined {
  const { patterns, allowlist } = compileApprovalConfig(config.approval);
  const prepare = filesystem
    ? (request: ApprovalRequest) =>
        filesystem.prepareChangeSet(request.input, {
          sessionId: request.sessionId,
          workingDirectory: request.workingDirectory,
        })
    : undefined;

  if (mode === "review-writes") {
    const sessionAllowed = new Set<string>();
    const requestApproval = (request: ApprovalRequest, reason?: string) =>
      requestReviewedCall(request, reason, questionBox, sessionAllowed);
    return createApprovalPolicy({
      mode,
      patterns,
      allowlist,
      prepare,
      requestApproval,
    });
  }

  if (mode !== "ask") {
    return createApprovalPolicy({ mode, patterns, allowlist });
  }

  const sessionAllowed = new Set<string>();
  const requestApproval = async (request: ApprovalRequest, reason?: string) => {
    const key = normalizeApprovalKey(request);
    if (key && sessionAllowed.has(key)) {
      return { decision: "allow" as const };
    }

    const question = `${safeTerminalText(reason ?? "dangerous call")}\nRun ${safeTerminalText(
      request.toolName
    )} anyway? [y/N/a] `;
    questionBox.onApprovalRequest?.(request.toolName, reason ?? "dangerous call");
    const answer = questionBox.ask
      ? await questionBox.ask(question)
      : await readLineFromStdin(question);
    const normalized = answer.trim().toLowerCase();

    if (normalized.startsWith("a") && key) {
      // Remembered for this process only; never written to disk.
      sessionAllowed.add(key);
      return { decision: "allow" as const };
    }

    return normalized.startsWith("y")
      ? { decision: "allow" as const }
      : { decision: "deny" as const, reason: `${reason ?? "dangerous call"} (declined)` };
  };
  return createApprovalPolicy({
    mode,
    patterns,
    allowlist,
    requestApproval,
  });
}

async function requestCliSandboxExpansion(
  request: SandboxExpansionRequest,
  questionBox: QuestionBox,
): Promise<SandboxExpansionDecision> {
  const expanded = expandBuiltInToolSandboxProfile(request.profile, request.error.capability);
  if (expanded === undefined) {
    return {
      decision: "deny",
      reason: `sandbox expansion for ${request.error.capability} is unavailable`,
    };
  }
  if (questionBox.ask === undefined) {
    return {
      decision: "deny",
      reason: "sandbox expansion requires interactive approval",
    };
  }

  const detail =
    `Sandbox denied ${request.error.capability} access for ${request.toolName}. ` +
    "The retry would enable network access while keeping the existing workspace boundary.";
  questionBox.onApprovalRequest?.(request.toolName, detail);
  try {
    const answer = await questionBox.ask(
      `${detail}\nRetry with the expanded sandbox? [y/N] `
    );
    if (answer.trim().toLowerCase().startsWith("y")) {
      questionBox.onApprovalResolved?.(
        request.toolName,
        "allow",
        "sandbox expansion approved",
      );
      return { decision: "allow", profile: expanded };
    }
    questionBox.onApprovalResolved?.(
      request.toolName,
      "deny",
      "sandbox expansion declined",
    );
    return { decision: "deny", reason: "sandbox expansion declined" };
  } catch (error) {
    const reason = `sandbox expansion approval failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    questionBox.onApprovalResolved?.(request.toolName, "deny", reason);
    return {
      decision: "deny",
      reason,
    };
  }
}

async function requestReviewedCall(
  request: ApprovalRequest,
  reason: string | undefined,
  questionBox: QuestionBox,
  sessionAllowed: Set<string>
): Promise<{ decision: "allow" | "deny"; reason?: string }> {
  const isReview = request.review !== undefined;
  const key = isReview ? undefined : normalizeApprovalKey(request);
  if (key && sessionAllowed.has(key)) {
    return { decision: "allow" };
  }
  const prompt = isReview
    ? formatChangeSetPrompt(request)
    : `${safeTerminalText(reason ?? "dangerous call")}\nRun ${safeTerminalText(
        request.toolName
      )} anyway? [y/N/a] `;
  const reviewDiff = request.review?.files
    .map((file) => file.diff ? safeTerminalText(file.diff) : "")
    .filter((diff) => diff.length > 0)
    .join("\n");
  questionBox.onApprovalRequest?.(
    request.toolName,
    reason ?? (isReview ? "filesystem change review" : "dangerous call"),
    reviewDiff || undefined
  );
  const answer = questionBox.ask
    ? await questionBox.ask(prompt)
    : await readLineFromStdin(prompt);
  const normalized = answer.trim().toLowerCase();

  if (!isReview && normalized.startsWith("a") && key) {
    // Remember dangerous approvals for this process only; reviewed writes are
    // intentionally confirmed per change set.
    sessionAllowed.add(key);
    return { decision: "allow" };
  }
  return normalized.startsWith("y")
    ? { decision: "allow" }
    : {
        decision: "deny",
        reason: isReview
          ? `filesystem ${String(reviewAction(request))} review declined`
          : `${reason ?? "dangerous call"} (declined)`,
      };
}

function reviewAction(request: ApprovalRequest): string {
  if (typeof request.input === "object" && request.input !== null) {
    const action = (request.input as Record<string, unknown>).action;
    if (typeof action === "string") {
      return action;
    }
  }
  return "write";
}

function formatChangeSetPrompt(request: ApprovalRequest): string {
  const review = request.review;
  if (!review) {
    return `Review ${safeTerminalText(request.toolName)} before running? [y/N] `;
  }
  const files = review.files
    .map((file) => {
      const diff = file.diff
        ? `\n${safeTerminalText(file.diff)}`
        : "\n(no textual changes; hash/existence still checked)";
      return `${safeTerminalText(file.path)} (+${file.additions}/-${file.deletions})${diff}`;
    })
    .join("\n");
  return [
    `Change set ${safeTerminalText(review.changeSetId)}: ${review.files.length} file(s), +${review.additions}/-${review.deletions}`,
    files,
    "Apply this change? [y/N] ",
  ].join("\n");
}

/** Reads one confirmation line; EOF and read failures count as "no". */
function readLineFromStdin(question: string): Promise<string> {
  process.stderr.write(question);
  return new Promise((resolve) => {
    let buffer = "";
    let bufferBytes = 0;
    const decoder = new StringDecoder("utf8");
    const cleanup = (destroyInput = false): void => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
      if (destroyInput && !process.stdin.isTTY) {
        process.stdin.destroy();
      }
    };
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const newline = bytes.indexOf(0x0a);
      const lineBytes = newline >= 0 ? bytes.subarray(0, newline) : bytes;
      if (bufferBytes + lineBytes.byteLength > MAX_APPROVAL_INPUT_BYTES) {
        cleanup(true);
        resolve("");
        return;
      }
      buffer += decoder.write(lineBytes);
      bufferBytes += lineBytes.byteLength;
      if (newline >= 0) {
        buffer += decoder.end();
        cleanup();
        resolve(buffer);
      }
    };
    const onEnd = (): void => {
      buffer += decoder.end();
      cleanup();
      resolve(buffer);
    };
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    // Buffered input (for example a piped "y\n") is delivered on resume; EOF
    // resolves with whatever arrived first.
    process.stdin.resume();
  });
}

function sessionDir(baseDirectory = process.cwd(), projectState = false): string {
  return (
    resolveRuntimePath(process.env.DEV_AGENT_SESSION_DIR, baseDirectory) ??
    (projectState
      ? join(baseDirectory, ".dev-agent", "sessions")
      : join(homedir(), ".dev-agent", "sessions"))
  );
}

async function listSessions(
  jsonOutput = false,
  baseDirectory = process.cwd(),
  projectState = false
): Promise<void> {
  const directory = sessionDir(baseDirectory, projectState);
  const printEmpty = (): void => {
    console.log(
      jsonOutput
        ? JSON.stringify({ sessions: [], truncated: false, total: 0 })
        : "No sessions found."
    );
  };
  const candidates: SessionListCandidate[] = [];
  let total = 0;
  try {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (!entry.name.endsWith(".json")) {
        continue;
      }
      total += 1;
      let candidate: SessionListCandidate;
      try {
        const info = await stat(join(directory, entry.name));
        candidate = {
          file: entry.name,
          size: info.size,
          modified: info.mtime,
          metadataReadable: true,
        };
      } catch {
        candidate = {
          file: entry.name,
          size: 0,
          modified: new Date(0),
          metadataReadable: false,
        };
      }
      insertNewestSessionCandidate(candidates, candidate);
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      printEmpty();
      return;
    }
    throw error;
  }

  if (candidates.length === 0) {
    printEmpty();
    return;
  }

  const rows: SessionListRow[] = [];
  for (const candidate of candidates) {
    if (!candidate.metadataReadable) {
      rows.push(candidate);
      continue;
    }
    try {
      const filePath = join(directory, candidate.file);
      const memory = new FileMemory({ filePath });
      const metadata = await memory.getMetadata();
      const evidenceSummary = await memory.evidenceSummary();
      rows.push({
        file: candidate.file,
        size: candidate.size,
        modified: candidate.modified,
        usage: metadata?.usage,
        evidenceSummary,
      });
    } catch {
      rows.push(candidate);
    }
  }

  rows.sort(compareSessionListRows);
  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          sessions: rows.map((row) => ({
            file: row.file,
            size: row.size,
            modifiedAt: row.modified.toISOString(),
            usage: row.usage ?? null,
            evidenceSummary: row.evidenceSummary ?? null,
          })),
          truncated: total > rows.length,
          total,
        },
        null,
        2
      )
    );
    return;
  }
  console.log(`Sessions (${rows.length}) in ${safeTerminalText(directory)}:`);
  for (const row of rows) {
    const file = safeTerminalText(row.file);
    const tokens = row.usage ? `  ${row.usage.totalTokens} tokens` : "";
    const evidence = row.evidenceSummary
      ? `  evidence=${row.evidenceSummary.validations}/${row.evidenceSummary.changeSets} protected=${row.evidenceSummary.protectedChangeSets}`
      : "";
    console.log(
      `  ${file.padEnd(32)} ${String(row.size).padStart(10)} bytes${tokens}${evidence}  ${row.modified.toISOString()}`
    );
  }
}

interface SessionListRow {
  file: string;
  size: number;
  modified: Date;
  usage?: ChatUsage;
  evidenceSummary?: EvidenceSummary;
}

interface SessionListCandidate extends SessionListRow {
  metadataReadable: boolean;
}

function compareSessionListRows(left: SessionListRow, right: SessionListRow): number {
  const modified = right.modified.getTime() - left.modified.getTime();
  if (modified !== 0) {
    return modified;
  }
  if (left.file < right.file) {
    return -1;
  }
  if (left.file > right.file) {
    return 1;
  }
  return 0;
}

function insertNewestSessionCandidate(
  candidates: SessionListCandidate[],
  candidate: SessionListCandidate
): void {
  const insertionIndex = candidates.findIndex(
    (existing) => compareSessionListRows(candidate, existing) < 0
  );
  if (insertionIndex < 0) {
    if (candidates.length < MAX_SESSION_LIST_ENTRIES) {
      candidates.push(candidate);
    }
    return;
  }
  candidates.splice(insertionIndex, 0, candidate);
  if (candidates.length > MAX_SESSION_LIST_ENTRIES) {
    candidates.pop();
  }
}

async function checkRust(rustBinaryPath: string | undefined): Promise<void> {
  const path = rustBinaryPath ?? process.env.DEV_AGENT_RUST_BINARY;
  if (!path) {
    console.error(
      "No Rust binary path provided. Use --rust-executor <path> or set DEV_AGENT_RUST_BINARY."
    );
    process.exitCode = 1;
    return;
  }

  const { existsSync } = await import("node:fs");
  if (!existsSync(path)) {
    console.error(safeTerminalText(`Rust executor binary not found at ${path}`));
    process.exitCode = 1;
    return;
  }

  try {
    const healthCheck = await probeRustBinary(path);
    console.log(`Rust executor binary: ${safeTerminalText(path)}`);
    console.log(`Runtime version: ${safeTerminalText(healthCheck.runtimeVersion)}`);
    console.log(`Capabilities: ${safeTerminalText(healthCheck.capabilities.join(", "))}`);
  } catch (error) {
    console.error(safeTerminalText(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? "default" : normalized;
}

export function resolveWorkingDirectory(
  flagValue?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  currentDirectory = process.cwd()
): string {
  const selected =
    flagValue ??
    env.DEV_AGENT_WORKING_DIRECTORY ??
    env.INIT_CWD ??
    currentDirectory;
  return resolve(selected);
}

function resolveTerminalWidth(): number {
  const width = process.stdout.columns;
  return width !== undefined && Number.isFinite(width) && width >= 20
    ? Math.floor(width)
    : 80;
}

function normalizeInteractiveCommand(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) {
    return `:${trimmed.slice(1)}`;
  }
  return trimmed;
}

interface InteractiveUiOptions {
  readonly rich: boolean;
  readonly ink?: InkInteractiveUi;
  readonly provider: string;
  readonly model: string;
  readonly streaming: boolean;
  readonly mcpCount?: number;
  readonly executor?: string;
  readonly session?: TuiSessionModel;
  readonly sessionId: string;
  readonly sessionDirectory: string;
  readonly workingDirectory: string;
  readonly width: number;
  readonly skills: SkillRegistry;
  readonly extensions: ExtensionRegistry;
  readonly activeSkill: ActiveSkillState;
  readonly trace: AgentRunTrace;
  readonly speedMode: ModelSpeedModeController;
  readonly modelRouting: ModelRoutingController;
  readonly modelBudget: SessionModelBudget;
  readonly projectContext: ProjectContextManager;
  readonly benchmark: (prompt: string) => Promise<SpeedBenchmarkResult>;
  readonly tasks: AgentTaskScheduler;
  readonly taskStatusBridge: InteractiveTaskStatusBridge;
  readonly backgroundJobs?: BackgroundJobManager;
  readonly checkpointStore?: CheckpointStore;
  readonly createCheckpointStore?: (context: AgentContext) => CheckpointStore;
  readonly openSession?: (sessionId: string) => Promise<AgentContext>;
  readonly createRerunValidation?: (
    context: AgentContext,
  ) => ValidationRerunner | undefined;
  readonly runGitWorkflow?: (
    command: string,
    confirm: (prompt: string) => Promise<boolean>,
    signal?: AbortSignal,
  ) => Promise<GitWorkflowResult>;
  readonly projectMemory?: ProjectMemoryStore;
  readonly consumePlanReview?: () => PlanReview | undefined;
  readonly runCollaborativePlan?: (
    prompt: string,
    context: AgentContext,
    options?: {
      readonly signal?: AbortSignal;
      readonly attachedContext?: string;
    },
  ) => Promise<CollaborativePlanResult>;
  readonly startCollaborativeExecution?: (
    prompt: string,
    context: AgentContext,
    options?: {
      readonly signal?: AbortSignal;
      readonly attachedContext?: string;
      readonly tasks?: readonly CollaborationTask[];
      readonly onEvent?: (event: CollaborationExecutionEvent) => void;
    },
  ) => Promise<CollaborationExecutionHandle>;
  readonly mergeCollaborativeReview?: (
    review: CollaborationReview,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<CollaborationMergeResult>;
  readonly disposeCollaborativeWorkspaces?: () => Promise<void>;
}

interface InkInteractiveUi {
  readonly store: InkRuntimeStore;
  readonly controller: InkUiController;
  readonly persistTheme?: (theme: InkThemeName) => Promise<void>;
}

interface PendingPlan {
  readonly prompt: string;
  readonly attachedContext?: string;
  readonly planText?: string;
  readonly review?: PlanReview;
}

interface PromptRunOptions {
  readonly mode?: "normal" | "plan";
  readonly attachedContext?: string;
  readonly toolAccess?: "all" | "none";
}

interface PromptRunTimingContext {
  readonly submittedAtMs: number;
  readonly queuedAtMs: number;
}

function skillCommandMessage(
  command: string,
  ui: InteractiveUiOptions,
): string | undefined {
  const result = executeSkillCommand(command, ui.skills, ui.activeSkill);
  return result.handled ? safeTerminalText(formatSkillCommandResult(result)) : undefined;
}

function extensionCommandMessage(
  command: string,
  ui: InteractiveUiOptions,
): string | undefined {
  const result = executeExtensionCommand(command, ui.extensions);
  return result.handled
    ? safeTerminalText(formatExtensionCommandResult(result))
    : undefined;
}

function planRequestFromCommand(command: string): string | undefined {
  if (command === ":plan") return "";
  if (command.startsWith(":plan ")) {
    return command.slice(":plan ".length).trim();
  }
  return undefined;
}

function teamRequestFromCommand(command: string): string | undefined {
  if (command === ":team") return "";
  if (command.startsWith(":team ")) {
    return command.slice(":team ".length).trim();
  }
  return undefined;
}

type TeamCommand =
  | { readonly kind: "execute"; readonly request: string }
  | { readonly kind: "plan"; readonly request: string }
  | { readonly kind: "apply" }
  | { readonly kind: "cancel"; readonly taskId?: string }
  | { readonly kind: "retry"; readonly taskId: string };

export function parseTeamCommand(command: string): TeamCommand | undefined {
  const request = teamRequestFromCommand(command);
  if (request === undefined) return undefined;
  if (request === "") return { kind: "execute", request: "" };
  const [subcommand, ...rest] = request.split(/\s+/);
  switch (subcommand?.toLowerCase()) {
    case "plan":
      return { kind: "plan", request: rest.join(" ").trim() };
    case "apply":
      return { kind: "apply" };
    case "cancel":
      return rest.length === 0
        ? { kind: "cancel" }
        : { kind: "cancel", taskId: rest[0] };
    case "retry":
      return rest[0] === undefined
        ? { kind: "retry", taskId: "" }
        : { kind: "retry", taskId: rest[0] };
    default:
      return { kind: "execute", request };
  }
}

function isApplyCommand(command: string): boolean {
  return command === ":apply";
}

function formatContextNotice(result: ResolvedPromptContext): string | undefined {
  const lines: string[] = [];
  if (result.attachments.length > 0) {
    lines.push(
      `Attached context: ${result.attachments.map((item) => `@${item.reference}`).join(", ")}`,
    );
  }
  if (result.unresolved.length > 0) {
    lines.push(
      `Context not found: ${result.unresolved.map((reference) => `@${reference}`).join(", ")}`,
    );
  }
  return lines.length === 0 ? undefined : lines.join("\n");
}

async function prepareInteractivePrompt(
  prompt: string,
  workingDirectory: string,
): Promise<ResolvedPromptContext> {
  return resolvePromptContext(prompt, { workingDirectory });
}

async function capturePendingPlan(
  context: AgentContext,
  prompt: string,
  attachedContext: string | undefined,
  review: PlanReview | undefined,
): Promise<PendingPlan> {
  const entries = await context.memory.entries();
  const planText = latestAssistantPlanText(entries);
  return {
    prompt,
    ...(attachedContext === undefined ? {} : { attachedContext }),
    ...(planText === undefined ? {} : { planText }),
    ...(review === undefined ? {} : { review }),
  };
}

function joinPromptContext(
  policyModules: readonly string[],
  attachedReference: string | undefined,
): string | undefined {
  const blocks = [...policyModules, attachedReference]
    .filter((value): value is string => value !== undefined && value.trim().length > 0);
  return blocks.length === 0 ? undefined : blocks.join("\n\n");
}

function approvedPlanContext(plan: PendingPlan): string | undefined {
  const approved = plan.planText === undefined
    ? undefined
    : buildApprovedPlanContext(plan.planText);
  const blocks = [plan.attachedContext, approved].filter(
    (value): value is string => value !== undefined && value.trim().length > 0,
  );
  return blocks.length === 0 ? undefined : blocks.join("\n\n");
}

function formatPlanReviewForTerminal(review: PlanReview): string {
  const lines = [
    `PLAN READY · ${review.files.length} file(s) +${review.additions}/-${review.deletions}`,
    `Change set: ${safeTerminalText(review.changeSetId)}`,
  ];
  for (const file of review.files) {
    lines.push(
      `${safeTerminalText(file.path)} (+${file.additions}/-${file.deletions})`,
      file.diff.trim().length > 0
        ? safeTerminalText(file.diff)
        : "(no textual changes; existence/hash checks still apply)",
    );
  }
  lines.push(":apply to execute · Esc to keep");
  return lines.join("\n").slice(0, 16_000);
}

function formatCollaborativePlanResult(result: CollaborativePlanResult): string {
  const roleLines = result.roles.map((role) => {
    const status = role.status === "done" ? "done" : `error: ${role.error ?? "failed"}`;
    return `- ${safeTerminalText(role.id)} · ${status} · ${role.durationMs}ms`;
  });
  return [
    "TEAM PLAN · specialist review",
    ...roleLines,
    "",
    safeTerminalText(result.synthesis),
  ].join("\n");
}

function formatCollaborativeExecutionResult(
  result: CollaborationExecutionResult,
): string {
  const taskLines = result.tasks.map((task) => {
    const error = task.error === undefined ? "" : ` · ${safeTerminalText(task.error)}`;
    return `- ${safeTerminalText(task.id)} · ${task.status} · attempt ${task.attempts} · ${task.durationMs}ms${error}`;
  });
  const review = result.review;
  return [
    `TEAM EXECUTION · ${result.status.toUpperCase()}`,
    ...taskLines,
    "",
    `Review: ${review.status} · ${review.changedFiles.length} file(s) +${review.additions}/-${review.deletions}`,
    review.conflicts.length === 0
      ? "Conflicts: none"
      : `Conflicts: ${review.conflicts.map((conflict) => safeTerminalText(conflict)).join(", ")}`,
    review.mergeable ? ":team apply to merge the reviewed result." : ":team retry <taskId> or resolve the conflicts.",
  ].join("\n");
}

async function gitWorkflowCommandMessage(
  rawCommand: string,
  ui: InteractiveUiOptions,
  questionBox: QuestionBox,
  signal?: AbortSignal,
): Promise<string> {
  if (!ui.runGitWorkflow) {
    return "GitHub workflow is unavailable in this session.";
  }
  const result = await ui.runGitWorkflow(
    rawCommand,
    async (prompt) => {
      const answer = questionBox.ask
        ? await questionBox.ask(`${prompt} [y/N] `, signal)
        : "";
      return answer.trim().toLowerCase().startsWith("y");
    },
    signal,
  );
  return safeTerminalText(result.message);
}

async function projectMemoryCommandMessage(
  rawCommand: string,
  ui: InteractiveUiOptions,
  questionBox: QuestionBox,
  signal?: AbortSignal,
): Promise<string> {
  if (!ui.projectMemory) {
    return "Project memory is unavailable in this session.";
  }
  const result = await executeProjectMemoryCommand(rawCommand, {
    store: ui.projectMemory,
    confirm: async (prompt) => {
      const answer = questionBox.ask
        ? await questionBox.ask(`${prompt} [y/N] `, signal)
        : "";
      return answer.trim().toLowerCase().startsWith("y");
    },
  });
  return safeTerminalText(result.message);
}

async function backgroundJobCommandMessage(
  rawCommand: string,
  ui: InteractiveUiOptions,
): Promise<string | undefined> {
  const command = parseBackgroundJobCommand(rawCommand);
  if (!command.handled) return undefined;
  const manager = ui.backgroundJobs;
  if (!manager) return "Background jobs are unavailable in this session.";
  try {
    switch (command.action) {
      case "list":
        return formatBackgroundJobCommandResult(command, await manager.list());
      case "inspect":
        return formatBackgroundJobCommandResult(command, [], await manager.inspect(command.id));
      case "start":
        return formatBackgroundJobCommandResult(command, [], await manager.start(command.prompt));
      case "cancel":
        return formatBackgroundJobCommandResult(command, [], await manager.cancel(command.id));
      case "resume":
        return formatBackgroundJobCommandResult(command, [], await manager.resume(command.id));
      case "usage":
        return formatBackgroundJobCommandResult(command);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return safeTerminalText(`Background job command failed: ${message}`);
  }
}

function taskCommandMessage(
  command: string,
  ui: InteractiveUiOptions,
): string | undefined {
  const result = executeTaskCommand(command, ui.tasks);
  return result.handled
    ? safeTerminalText(formatTaskCommandResult(result))
    : undefined;
}

async function checkpointCommandResult(
  command: string,
  ui: InteractiveUiOptions,
  context?: AgentContext,
): Promise<CheckpointCommandResult | undefined> {
  if (!isCheckpointCommand(command)) {
    return undefined;
  }
  const checkpointStore = context !== undefined && ui.createCheckpointStore !== undefined
    ? ui.createCheckpointStore(context)
    : ui.checkpointStore;
  if (!checkpointStore) {
    return {
      handled: true,
      message: "Checkpoint commands are unavailable for this session.",
    };
  }
  try {
    return await executeCheckpointCommand(command, checkpointStore);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      handled: true,
      message: safeTerminalText(`Checkpoint command failed: ${message}`),
    };
  }
}

async function sessionHistoryCommandMessage(
  command: string,
  memory: AgentMemory,
): Promise<string | undefined> {
  const parsed = parseSessionHistoryCommand(command);
  if (!parsed.handled) {
    return undefined;
  }
  if (parsed.error) {
    return parsed.error;
  }
  try {
    const entries = await memory.entries();
    return formatSessionHistory(entries, { limit: parsed.limit });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return safeTerminalText(`History unavailable: ${message}`);
  }
}

async function sessionSearchCommandMessage(
  command: string,
  memory: AgentMemory,
): Promise<string | undefined> {
  const parsed = parseSessionSearchCommand(command);
  if (!parsed.handled) {
    return undefined;
  }
  if (parsed.error || parsed.query === undefined) {
    return parsed.error ?? "Usage: :search <query>";
  }
  try {
    const entries = await memory.entries();
    return formatSessionSearch(entries, parsed.query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return safeTerminalText(`History search unavailable: ${message}`);
  }
}

async function sessionExportCommandMessage(
  command: string,
  memory: AgentMemory,
  workingDirectory: string,
  sessionId: string,
): Promise<string | undefined> {
  const parsed = parseSessionExportCommand(command);
  if (!parsed.handled) {
    return undefined;
  }
  if (parsed.error || parsed.format === undefined) {
    return parsed.error ?? "Usage: :export [markdown|json]";
  }
  try {
    const entries = await memory.entries();
    const outputPath = await writeSessionExport(entries, {
      workingDirectory,
      sessionId,
      format: parsed.format,
    });
    const displayPath = relative(workingDirectory, outputPath)
      .replaceAll("\\", "/");
    return `Exported session to ${displayPath || ".dev-agent/exports"}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return safeTerminalText(`Session export failed: ${message}`);
  }
}

type SessionPickerLookup =
  | { readonly handled: false }
  | {
      readonly handled: true;
      readonly query?: string;
      readonly sessions: readonly StoredSession[];
      readonly error?: string;
    };

async function sessionPickerLookup(
  command: string,
  ui: InteractiveUiOptions,
): Promise<SessionPickerLookup> {
  const parsed = parseSessionResumeCommand(command);
  if (!parsed.handled) {
    return { handled: false };
  }
  if (parsed.error) {
    return {
      handled: true,
      sessions: [],
      error: parsed.error,
    };
  }
  try {
    const sessions = await listStoredSessions(ui.sessionDirectory);
    return {
      handled: true,
      ...(parsed.query === undefined ? {} : { query: parsed.query }),
      sessions: searchStoredSessions(sessions, parsed.query ?? ""),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      handled: true,
      sessions: [],
      error: safeTerminalText(`Sessions unavailable: ${message}`),
    };
  }
}

function formatSessionPickerList(
  sessions: readonly StoredSession[],
  query?: string,
): string {
  if (sessions.length === 0) {
    return query === undefined
      ? "No sessions found."
      : `No sessions matched "${safeTerminalText(query)}".`;
  }
  const title = query === undefined
    ? `Sessions (${sessions.length}):`
    : `Sessions matching "${safeTerminalText(query)}" (${sessions.length}):`;
  return [
    title,
    ...sessions.map(
      (session, index) => `${index + 1}. ${formatStoredSessionRow(session)}`,
    ),
    "Use :resume <session-id> to continue a session.",
  ].join("\n");
}

function sessionResumeCandidate(
  query: string | undefined,
  sessions: readonly StoredSession[],
): StoredSession | undefined {
  if (query === undefined) {
    return undefined;
  }
  const exact = sessions.find((session) => session.id === normalizeSessionId(query));
  return exact ?? (sessions.length === 1 ? sessions[0] : undefined);
}

function historyViewFromMessage(message: string): {
  readonly title: string;
  readonly rows: readonly string[];
} {
  const lines = message.split("\n");
  return {
    title: lines[0] ?? message,
    rows: lines.slice(1),
  };
}

async function interactive(
  loop: AgentLoop,
  context: AgentContext,
  streaming: StreamingRun,
  questionBox: QuestionBox,
  ui: InteractiveUiOptions,
  jsonOutput = false,
  cost?: UsageCostOptions,
  reviews: readonly ReviewRecord[] = [],
  validations: ValidationResult[] = [],
  rerunValidation?: ValidationRerunner
): Promise<void> {
  if (ui.ink !== undefined) {
    await interactiveInk(
      loop,
      context,
      streaming,
      questionBox,
      ui,
      jsonOutput,
      cost,
      reviews,
      validations,
      rerunValidation,
    );
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let currentSessionId = ui.sessionId;
  // TTY input is handled exclusively by Ink. This branch remains only for
  // non-TTY/pipe input, where readline preserves the machine-friendly
  // line-oriented contract.
  questionBox.onApprovalRequest = (tool, detail, diff) => {
    streaming.approvalRequested(tool, detail, diff);
  };
  questionBox.onApprovalResolved = (tool, decision, detail) => {
    streaming.approvalResolved(tool, decision, detail);
  };

  let interrupted = false;
  let abort: AbortController | undefined;
  let activeTaskId: string | undefined;
  let activeCollaboration: CollaborationExecutionHandle | undefined;
  let latestCollaboration: CollaborationExecutionResult | undefined;
  let latestCollaborationContext: string | undefined;
  // Closing the readline interface does not settle a pending `question()`.
  // Race both the interface close and the interrupt signal so EOF always
  // unwinds the loop instead of leaving a promise waiting on stdin.
  let wakeOnInterrupt: (() => void) | undefined;
  const interrupt = new Promise<void>((resolve) => {
    wakeOnInterrupt = resolve;
  });
  let inputEnded = false;
  const inputClosed = rl
    ? new Promise<void>((resolve) => {
        rl.once("close", () => {
          inputEnded = true;
          resolve();
        });
      })
    : Promise.resolve();
  const askReadline = async (prompt: string, signal?: AbortSignal): Promise<string> => {
    if (inputEnded || signal?.aborted) return "";
    const controller = new AbortController();
    const abortQuestion = (): void => controller.abort();
    signal?.addEventListener("abort", abortQuestion, { once: true });
    rl.once("close", abortQuestion);
    try {
      return await rl.question(prompt, { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) return "";
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortQuestion);
      rl.off("close", abortQuestion);
    }
  };
  questionBox.ask = askReadline;
  questionBox.askText = askReadline;
  const onSigint = () => {
    interrupted = true;
    ui.session?.dispatch({ type: "turn-interrupted", reason: "SIGINT" });
    process.stdout.write("\n(interrupted)\n");
    // Cancel whatever is in flight. Without this Ctrl-C only printed a line
    // and the running request kept going.
    if (activeTaskId !== undefined) {
      ui.tasks.cancel(activeTaskId, "SIGINT");
    }
    activeCollaboration?.cancel("SIGINT");
    abort?.abort();
    rl.close();
    // 130 is the conventional exit code for "terminated by SIGINT".
    if (!ui.rich) {
      process.exitCode = 130;
    } else {
      process.exitCode = 0;
    }
    wakeOnInterrupt?.();
  };
  process.on("SIGINT", onSigint);

  const printHeader = (): void => {
    if (!ui.rich) {
      // Publish readiness only after the handler is installed. stdout is piped
      // in callers, so the banner can be observed before a later listener
      // setup.
      console.log(
        "dev-agent CLI. Type 'exit' or 'quit' to stop. Use ':route' for automatic model routing, ':trace' for the latest run summary, ':validate <changeSetId>' to rerun trusted checks, ':autofix [1-3]' to repair the latest validation failure, or ':cleanup [--remove-rolled-back] [--max-validations N] [--max-change-sets N]'."
      );
      return;
    }

    console.log(
      renderWelcome({
        provider: ui.provider,
        model: ui.model,
        streaming: ui.streaming,
        mcpCount: ui.mcpCount,
        executor: ui.executor,
        runState: ui.session?.snapshot().state ?? "ready",
        sessionId: currentSessionId,
        workingDirectory: ui.workingDirectory,
        width: ui.width,
      })
    );
    console.log();
    console.log(renderCommandHints(DEFAULT_COMMAND_HINTS, { width: ui.width }));
    console.log();
  };

  printHeader();

  // Each prompt continues from the previous run's context, so `turns` and
  // `usage` accumulate across the session instead of restarting every time.
  let current = context;
  let pendingPlan: PendingPlan | undefined;
  const scheduleTask = <T>(
    options: {
      run: (task: AgentTaskExecutionContext) => Promise<T> | T;
    },
  ): Promise<T> =>
    scheduleInteractiveTask(ui.tasks, ui.taskStatusBridge, options.run);

  const runAutoFixCommand = async (attempts: number): Promise<void> => {
    let repairContext = current;
    const autoFixAbort = new AbortController();
    abort = autoFixAbort;
    const printMessage = (message: string): void => {
      const render = (): void => console.log(safeTerminalText(message));
      if (ui.rich) streaming.withComposerHidden(render);
      else render();
    };
    const recordExplicitValidation = (result: ValidationResult): void => {
      validations.push(result);
      if (jsonOutput) {
        const printJson = async (): Promise<void> => {
          const changeSets = (await repairContext.memory.changeSets?.()) ?? [];
          const evidenceSummary = await repairContext.memory.evidenceSummary?.();
          console.log(
            JSON.stringify(
              {
                validation: result,
                changeSets: [...changeSets],
                ...(evidenceSummary === undefined ? {} : { evidenceSummary }),
              },
              null,
              2,
            ),
          );
        };
        void printJson();
        return;
      }
      const printValidation = (): void => {
        printValidationResult(result, true, ui.width);
      };
      if (ui.rich) streaming.withComposerHidden(printValidation);
      else printValidationResult(result, false, ui.width);
    };

    try {
      const hasRerunValidation =
        ui.createRerunValidation !== undefined || rerunValidation !== undefined;
      const result = await runAutoFixLoop({
        context: repairContext,
        validations,
        maxAttempts: attempts,
        signal: autoFixAbort.signal,
        loadPersistedValidations: async () =>
          (await repairContext.memory.validations?.()) ?? [],
        ...(hasRerunValidation
          ? {
              rerunValidation: async (changeSetId: string, signal?: AbortSignal) => {
                const activeRerunValidation =
                  ui.createRerunValidation?.(repairContext) ?? rerunValidation;
                if (!activeRerunValidation) {
                  throw new Error("trusted validation rerun is unavailable");
                }
                return activeRerunValidation(changeSetId, signal);
              },
            }
          : {}),
        onProgress: printMessage,
        onValidation: recordExplicitValidation,
        runRepair: async (repairPrompt): Promise<AutoFixRepairRun> => {
          const timingContext = {
            submittedAtMs: performance.now(),
            queuedAtMs: performance.now(),
          };
          const scheduled = scheduleTask({
            run: ({ signal }) =>
              runPrompt(
                loop,
                repairContext,
                streaming,
                repairPrompt,
                jsonOutput,
                cost,
                reviews,
                validations,
                signal,
                {},
                timingContext,
              ),
          });
          const taskId = ui.tasks.list().at(-1)?.id;
          activeTaskId = taskId;
          try {
            const next = await scheduled;
            repairContext = next;
            return next.state.status === "error"
              ? {
                  context: next,
                  error: next.state.lastError ?? "agent repair run failed",
                }
              : { context: next };
          } catch (error) {
            const cancelled = interrupted || autoFixAbort.signal.aborted ||
              (taskId !== undefined && ui.tasks.get(taskId)?.status === "cancelled");
            return {
              context: repairContext,
              ...(cancelled
                ? { cancelled: true }
                : { error: error instanceof Error ? error.message : String(error) }),
            };
          } finally {
            if (activeTaskId === taskId) activeTaskId = undefined;
          }
        },
      });
      current = result.context;
      printMessage(result.message);
    } catch (error) {
      if (!interrupted) {
        printMessage(`Auto-fix failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (abort === autoFixAbort) abort = undefined;
    }
  };

  const runTeamExecution = async (
    prompt: string,
    attachedContext?: string,
    tasks?: readonly CollaborationTask[],
  ): Promise<CollaborationExecutionResult | undefined> => {
    if (!ui.startCollaborativeExecution) {
      console.log("Collaborative execution is unavailable in this session.");
      return undefined;
    }
    latestCollaborationContext = attachedContext;
    latestCollaboration = undefined;
    const scheduled = scheduleTask({
      run: async ({ signal }) => {
        const handle = await ui.startCollaborativeExecution!(
          prompt,
          current,
          {
            signal,
            attachedContext,
            tasks,
          },
        );
        activeCollaboration = handle;
        try {
          return await handle.promise;
        } finally {
          if (activeCollaboration === handle) {
            activeCollaboration = undefined;
          }
        }
      },
    });
    activeTaskId = ui.tasks.list().at(-1)?.id;
    try {
      const result = await scheduled;
      latestCollaboration = result;
      const printResult = (): void => {
        console.log(formatCollaborativeExecutionResult(result));
      };
      if (ui.rich) {
        streaming.withComposerHidden(printResult);
      } else {
        printResult();
      }
      return result;
    } catch (error) {
      if (!interrupted) {
        const printError = (): void => {
          if (error instanceof CollaborationScopeReviewCancelledError) {
            console.log("Team execution cancelled during tool-scope review; no task workspaces were created.");
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          console.error(safeTerminalText(`Team execution failed: ${message}`));
        };
        if (ui.rich) {
          streaming.withComposerHidden(printError);
        } else {
          printError();
        }
      }
      return undefined;
    } finally {
      activeTaskId = undefined;
    }
  };
  const applyTeamReview = async (): Promise<void> => {
    const result = latestCollaboration;
    if (result === undefined || !result.review.mergeable) {
      console.log("No mergeable team review is waiting.");
      return;
    }
    if (!ui.mergeCollaborativeReview) {
      console.log("Team merge is unavailable in this session.");
      return;
    }
    const answer = await questionBox.ask?.(
      `Merge the reviewed team changes for "${safeTerminalText(result.prompt)}"? [y/N] `,
    ) ?? "";
    if (!answer.trim().toLowerCase().startsWith("y")) {
      console.log("Team review kept. No files were changed.");
      return;
    }
    const scheduled = scheduleTask({
      run: ({ signal }) => ui.mergeCollaborativeReview!(result.review, { signal }),
    });
    activeTaskId = ui.tasks.list().at(-1)?.id;
    try {
      const merge = await scheduled;
      if (merge.status === "merged") {
        latestCollaboration = undefined;
      }
      console.log(`Team merge ${merge.status}: ${safeTerminalText(merge.summary)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(safeTerminalText(`Team merge failed: ${message}`));
    } finally {
      activeTaskId = undefined;
    }
  };

  try {
    for (;;) {
      const inputResult = await Promise.race([
        rl.question("> ").catch(() => ""),
        interrupt.then(() => null),
        inputClosed.then(() => null),
      ]);
      if (interrupted) {
        break;
      }
      if (inputResult === null) {
        process.exitCode = inputEnded || ui.rich ? 0 : 130;
        if (!inputEnded) {
          process.stdout.write("\n(interrupted)\n");
        }
        break;
      }
      const line = inputResult;
      const prompt = line.trim();
      const command = normalizeInteractiveCommand(prompt);
      if (command === ":quit" || command === "exit" || command === "quit") {
        break;
      }
      if (!prompt) {
        continue;
      }
      if (isGitWorkflowCommand(command)) {
        const workflowAbort = new AbortController();
        abort = workflowAbort;
        try {
          const workflowMessage = await gitWorkflowCommandMessage(
            command,
            ui,
            questionBox,
            workflowAbort.signal,
          );
          const printWorkflowMessage = (): void => console.log(workflowMessage);
          if (ui.rich) streaming.withComposerHidden(printWorkflowMessage);
          else printWorkflowMessage();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const printWorkflowError = (): void =>
            console.error(safeTerminalText(`GitHub workflow failed: ${message}`));
          if (ui.rich) streaming.withComposerHidden(printWorkflowError);
          else printWorkflowError();
        } finally {
          if (abort === workflowAbort) abort = undefined;
        }
        continue;
      }
      if (isProjectMemoryCommand(command)) {
        const memoryAbort = new AbortController();
        abort = memoryAbort;
        try {
          const memoryMessage = await projectMemoryCommandMessage(
            command,
            ui,
            questionBox,
            memoryAbort.signal,
          );
          const printMemoryMessage = (): void => console.log(memoryMessage);
          if (ui.rich) streaming.withComposerHidden(printMemoryMessage);
          else printMemoryMessage();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const printMemoryError = (): void =>
            console.error(safeTerminalText(`Project memory failed: ${message}`));
          if (ui.rich) streaming.withComposerHidden(printMemoryError);
          else printMemoryError();
        } finally {
          if (abort === memoryAbort) abort = undefined;
        }
        continue;
      }
      const skillMessage = skillCommandMessage(command, ui);
      if (skillMessage !== undefined) {
        const printSkillMessage = (): void => {
          console.log(skillMessage);
        };
        if (ui.rich) {
          streaming.withComposerHidden(printSkillMessage);
        } else {
          printSkillMessage();
        }
        continue;
      }

      const extensionMessage = extensionCommandMessage(command, ui);
      if (extensionMessage !== undefined) {
        const printExtensionMessage = (): void => {
          console.log(extensionMessage);
        };
        if (ui.rich) {
          streaming.withComposerHidden(printExtensionMessage);
        } else {
          printExtensionMessage();
        }
        continue;
      }

      const backgroundJobMessage = await backgroundJobCommandMessage(command, ui);
      if (backgroundJobMessage !== undefined) {
        const printBackgroundJobMessage = (): void => console.log(backgroundJobMessage);
        if (ui.rich) streaming.withComposerHidden(printBackgroundJobMessage);
        else printBackgroundJobMessage();
        continue;
      }

      const taskMessage = taskCommandMessage(command, ui);
      if (taskMessage !== undefined) {
        const printTaskMessage = (): void => {
          console.log(taskMessage);
        };
        if (ui.rich) {
          streaming.withComposerHidden(printTaskMessage);
        } else {
          printTaskMessage();
        }
        continue;
      }

      const sessionLookup = await sessionPickerLookup(command, ui);
      if (sessionLookup.handled) {
        let sessionMessage = sessionLookup.error;
        if (
          sessionMessage === undefined &&
          (command === ":sessions" || sessionLookup.query === undefined)
        ) {
          sessionMessage = formatSessionPickerList(
            sessionLookup.sessions,
            sessionLookup.query,
          );
        } else if (sessionMessage === undefined) {
          const candidate = sessionResumeCandidate(
            sessionLookup.query,
            sessionLookup.sessions,
          );
          if (candidate === undefined) {
            sessionMessage = formatSessionPickerList(
              sessionLookup.sessions,
              sessionLookup.query,
            );
          } else if (!candidate.readable) {
            sessionMessage = `Session ${safeTerminalText(candidate.id)} is unavailable.`;
          } else if (!ui.openSession) {
            sessionMessage = "Session switching is unavailable in this interface.";
          } else {
            try {
              const next = await ui.openSession(candidate.id);
              current = next;
              currentSessionId = next.sessionId;
              pendingPlan = undefined;
              sessionMessage = `Resumed session ${safeTerminalText(next.sessionId)}.`;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sessionMessage = safeTerminalText(`Session resume failed: ${message}`);
            }
          }
        }
        const printSessions = (): void => {
          if (sessionMessage) {
            console.log(sessionMessage);
          }
        };
        if (ui.rich) {
          streaming.withComposerHidden(printSessions);
        } else {
          printSessions();
        }
        continue;
      }

      const checkpointResult = await checkpointCommandResult(command, ui, current);
      if (checkpointResult?.handled) {
        const printCheckpointMessage = (): void => {
          if (checkpointResult.message) {
            console.log(safeTerminalText(checkpointResult.message));
          }
        };
        if (ui.rich) {
          streaming.withComposerHidden(printCheckpointMessage);
        } else {
          printCheckpointMessage();
        }
        continue;
      }

      const historyMessage = await sessionHistoryCommandMessage(command, current.memory);
      if (historyMessage !== undefined) {
        const printHistory = (): void => {
          console.log(historyMessage);
        };
        if (ui.rich) {
          streaming.withComposerHidden(printHistory);
        } else {
          printHistory();
        }
        continue;
      }

      const searchMessage = await sessionSearchCommandMessage(command, current.memory);
      if (searchMessage !== undefined) {
        const printSearch = (): void => {
          console.log(searchMessage);
        };
        if (ui.rich) {
          streaming.withComposerHidden(printSearch);
        } else {
          printSearch();
        }
        continue;
      }

      const exportMessage = await sessionExportCommandMessage(
        command,
        current.memory,
        ui.workingDirectory,
        currentSessionId,
      );
      if (exportMessage !== undefined) {
        const printExport = (): void => {
          console.log(exportMessage);
        };
        if (ui.rich) {
          streaming.withComposerHidden(printExport);
        } else {
          printExport();
        }
        continue;
      }

      if (command === ":retry") {
        const printRetryNotice = (): void => {
          console.log("Retry is available in the Ink interface.");
        };
        if (ui.rich) {
          streaming.withComposerHidden(printRetryNotice);
        } else {
          printRetryNotice();
        }
        continue;
      }

      const autoFixCommand = parseAutoFixCommand(command);
      if (autoFixCommand.handled) {
        const printAutoFixUsage = (): void => {
          console.log(autoFixCommand.error ?? "Usage: :autofix [1-3]");
        };
        if (autoFixCommand.error !== undefined) {
          if (ui.rich) streaming.withComposerHidden(printAutoFixUsage);
          else printAutoFixUsage();
        } else {
          await runAutoFixCommand(autoFixCommand.attempts ?? 2);
        }
        continue;
      }

      const themeCommand = parseInkThemeCommand(command);
      if (themeCommand.handled) {
        const printTheme = (): void => {
          if (themeCommand.error) {
            console.log(themeCommand.error);
            return;
          }
          if (themeCommand.name === undefined) {
            console.log(`Ink themes: ${INK_THEME_NAMES.join(", ")}.`);
            return;
          }
          console.log(
            `Theme "${themeCommand.name}" is available in the Ink interface.`,
          );
        };
        if (ui.rich) {
          streaming.withComposerHidden(printTheme);
        } else {
          printTheme();
        }
        continue;
      }

      const teamCommand = parseTeamCommand(command);
      if (teamCommand !== undefined) {
        if (teamCommand.kind === "execute") {
          if (!teamCommand.request) {
            console.log("Usage: :team <request> · :team plan <request>");
            continue;
          }
          const prepared = await prepareInteractivePrompt(
            teamCommand.request,
            ui.workingDirectory,
          );
          const contextNotice = formatContextNotice(prepared);
          if (contextNotice) {
            console.log(safeTerminalText(contextNotice));
          }
          await runTeamExecution(prepared.prompt, prepared.context);
          continue;
        }
        if (teamCommand.kind === "plan") {
          if (!teamCommand.request) {
            console.log("Usage: :team plan <request>");
            continue;
          }
          if (!ui.runCollaborativePlan) {
            console.log("Collaborative planning is unavailable in this session.");
            continue;
          }
          const prepared = await prepareInteractivePrompt(
            teamCommand.request,
            ui.workingDirectory,
          );
          const contextNotice = formatContextNotice(prepared);
          if (contextNotice) {
            console.log(safeTerminalText(contextNotice));
          }
          const scheduled = scheduleTask({
            run: ({ signal }) =>
              ui.runCollaborativePlan!(
                prepared.prompt,
                current,
                { signal, attachedContext: prepared.context },
              ),
          });
          activeTaskId = ui.tasks.list().at(-1)?.id;
          try {
            const result = await scheduled;
            console.log(formatCollaborativePlanResult(result));
          } catch (error) {
            if (!interrupted) {
              const message = error instanceof Error ? error.message : String(error);
              console.error(safeTerminalText(`Team plan failed: ${message}`));
            }
          } finally {
            activeTaskId = undefined;
          }
          continue;
        }
        if (teamCommand.kind === "cancel") {
          if (activeCollaboration === undefined) {
            console.log("No team execution is currently running.");
          } else if (teamCommand.taskId === undefined) {
            activeCollaboration.cancel("user cancelled the team execution");
            console.log("Team execution cancellation requested.");
          } else if (
            activeCollaboration.cancelTask(
              teamCommand.taskId,
              "user cancelled the team task",
            )
          ) {
            console.log(`Cancellation requested for team task ${teamCommand.taskId}.`);
          } else {
            console.log(`Team task not found or already finished: ${teamCommand.taskId}`);
          }
          continue;
        }
        if (teamCommand.kind === "retry") {
          if (!teamCommand.taskId) {
            console.log("Usage: :team retry <taskId>");
            continue;
          }
          if (latestCollaboration === undefined) {
            console.log("No team result is available to retry.");
            continue;
          }
          const task = latestCollaboration.plan.find(
            (candidate) => candidate.id === teamCommand.taskId,
          );
          if (task === undefined) {
            console.log(`Unknown team task: ${teamCommand.taskId}`);
            continue;
          }
          await runTeamExecution(
            latestCollaboration.prompt,
            latestCollaborationContext,
            [{ ...task, dependsOn: undefined }],
          );
          continue;
        }
        await applyTeamReview();
        continue;
      }

      const planRequest = planRequestFromCommand(command);
      if (planRequest !== undefined) {
        if (!planRequest) {
          const printPlanUsage = (): void => {
            console.log("Usage: :plan <request>");
          };
          if (ui.rich) {
            streaming.withComposerHidden(printPlanUsage);
          } else {
            printPlanUsage();
          }
          continue;
        }

        ui.consumePlanReview?.();
        const prepared = await prepareInteractivePrompt(planRequest, ui.workingDirectory);
        const contextNotice = formatContextNotice(prepared);
        if (contextNotice) {
          const printContext = (): void => console.log(safeTerminalText(contextNotice));
          if (ui.rich) {
            streaming.withComposerHidden(printContext);
          } else {
            printContext();
          }
        }

        const timingContext = { submittedAtMs: performance.now(), queuedAtMs: performance.now() };
        const scheduled = scheduleTask({
          run: ({ signal }) =>
            runPrompt(
              loop,
              current,
              streaming,
              prepared.prompt,
              jsonOutput,
              cost,
              reviews,
              validations,
              signal,
              {
                mode: "plan",
                ...(prepared.context === undefined ? {} : { attachedContext: prepared.context }),
              },
              timingContext,
            ),
        });
        activeTaskId = ui.tasks.list().at(-1)?.id;
        try {
          current = await scheduled;
          if (current.state.status !== "error") {
            pendingPlan = await capturePendingPlan(
              current,
              prepared.prompt,
              prepared.context,
              ui.consumePlanReview?.(),
            );
            if (pendingPlan.review !== undefined && ui.ink === undefined) {
              const printReview = (): void => {
                console.log(formatPlanReviewForTerminal(pendingPlan!.review!));
              };
              if (ui.rich) {
                streaming.withComposerHidden(printReview);
              } else {
                printReview();
              }
            }
          }
        } catch (error) {
          if (!interrupted) {
            const message = error instanceof Error ? error.message : String(error);
            const printError = (): void => {
              console.error(safeTerminalText(`Plan failed: ${message}`));
            };
            if (ui.rich) {
              streaming.withComposerHidden(printError);
            } else {
              printError();
            }
          }
        } finally {
          activeTaskId = undefined;
        }
        continue;
      }

      if (isApplyCommand(command)) {
        if (!pendingPlan) {
          const printMissingPlan = (): void => {
            console.log("No plan is waiting. Use :plan <request> first.");
          };
          if (ui.rich) {
            streaming.withComposerHidden(printMissingPlan);
          } else {
            printMissingPlan();
          }
          continue;
        }
        const planToApply = pendingPlan;

        const answer = questionBox.ask
          ? await questionBox.ask(
              `Apply the latest plan for "${safeTerminalText(planToApply.prompt)}"? [y/N] `
            )
          : "";
        if (!answer.trim().toLowerCase().startsWith("y")) {
          const printKept = (): void => console.log("Plan kept. No files were changed.");
          if (ui.rich) {
            streaming.withComposerHidden(printKept);
          } else {
            printKept();
          }
          continue;
        }

        const prepared = await prepareInteractivePrompt(
          planToApply.prompt,
          ui.workingDirectory,
        );
        const contextNotice = formatContextNotice(prepared);
        if (contextNotice) {
          const printContext = (): void => console.log(safeTerminalText(contextNotice));
          if (ui.rich) {
            streaming.withComposerHidden(printContext);
          } else {
            printContext();
          }
        }

        const timingContext = { submittedAtMs: performance.now(), queuedAtMs: performance.now() };
        const scheduled = scheduleTask({
          run: ({ signal }) =>
            planToApply.review === undefined
              ? runPrompt(
                  loop,
                  current,
                  streaming,
                  prepared.prompt,
                  jsonOutput,
                  cost,
                  reviews,
                  validations,
                  signal,
                  approvedPlanContext(planToApply) === undefined
                    ? prepared.context === undefined
                      ? {}
                      : { attachedContext: prepared.context }
                    : { attachedContext: approvedPlanContext(planToApply) },
                  timingContext,
                )
              : loop.applyPlannedChangeSet(current, {
                  prompt: prepared.prompt,
                  review: planToApply.review,
                  signal,
                }),
        });
        activeTaskId = ui.tasks.list().at(-1)?.id;
        try {
          current = await scheduled;
          pendingPlan = undefined;
        } catch (error) {
          if (!interrupted) {
            const message = error instanceof Error ? error.message : String(error);
            const printError = (): void => {
              console.error(safeTerminalText(`Apply failed: ${message}`));
            };
            if (ui.rich) {
              streaming.withComposerHidden(printError);
            } else {
              printError();
            }
          }
        } finally {
          activeTaskId = undefined;
        }
        continue;
      }

      if (command === ":help") {
        if (ui.rich) {
          streaming.withComposerHidden(() => {
            console.log(renderCommandHints(DEFAULT_COMMAND_HINTS, { width: ui.width }));
          });
        } else {
          console.log(
            "Commands: :help, :clear, :model, :project [refresh], :instructions [refresh], :mode fast|balanced|deep, :route [auto|manual], :budget [tokens|cost|duration], :bench [prompt], :history [count], :plan <request>, :team <request>, :apply, :trace, :tasks, :task <id>, :extensions, :extension <id>, :validate <changeSetId>, :autofix [1-3], :branch [create <name>], :commit [--all] <message>, :push [remote] [branch], :pr [--base <branch>] <title>, :memory [add|search|forget], :cleanup ..., exit, quit"
          );
        }
        continue;
      }

      if (command === ":clear") {
        pendingPlan = undefined;
        if (ui.rich) {
          streaming.withComposerHidden(() => {
            process.stdout.write("\u001b[2J\u001b[H");
            printHeader();
          });
        } else {
          console.log("Clear is available only in an interactive terminal.");
        }
        continue;
      }

      if (command === ":model") {
        if (ui.rich) {
          streaming.withComposerHidden(() => {
            console.log(
              renderRuntimeStatus({
                provider: ui.provider,
                model: ui.model,
                streaming: ui.streaming,
                runState: ui.session?.snapshot().state ?? "ready",
                width: ui.width,
              })
            );
          });
        } else {
          console.log(
            `[runtime] provider=${safeTerminalText(ui.provider)} model=${safeTerminalText(ui.model)} streaming=${
              ui.streaming ? "enabled" : "disabled"
            }`
          );
        }
        continue;
      }

      const routingMessage = executeModelRoutingCommand(command, ui.modelRouting, ui.modelBudget);
      if (routingMessage !== undefined) {
        if (ui.rich) streaming.withComposerHidden(() => console.log(safeTerminalText(routingMessage)));
        else console.log(safeTerminalText(routingMessage));
        continue;
      }

      const modeCommand = parseSpeedModeCommand(command);
      if (modeCommand) {
        if (modeCommand.kind === "invalid") {
          const message = "Usage: :mode fast|balanced|deep";
          if (ui.rich) streaming.withComposerHidden(() => console.log(message));
          else console.log(message);
        } else {
          if (modeCommand.kind === "set") ui.modelRouting.setManualMode(modeCommand.mode);
          const message = `Speed mode: ${ui.speedMode.mode} · ${describeSpeedModeSupport(
            { id: ui.provider as ModelProvider["id"], model: ui.model },
            ui.speedMode.mode,
          )}`;
          if (ui.rich) streaming.withComposerHidden(() => console.log(message));
          else console.log(message);
        }
        continue;
      }

      const benchmarkPrompt = parseBenchmarkCommand(command);
      if (benchmarkPrompt !== undefined) {
        const report = async (): Promise<void> => {
          const result = await ui.benchmark(benchmarkPrompt);
          console.log(
            `[bench] scope=provider-only model=${safeTerminalText(ui.model)} mode=${ui.speedMode.mode} first-token=${formatTimingMs(result.firstTokenMs)} total=${formatTimingMs(result.totalMs)}`,
          );
        };
        try {
          if (ui.rich) await streaming.withComposerHidden(() => report());
          else await report();
        } catch (error) {
          const message = error instanceof Error ? error.message : "benchmark failed";
          const printError = (): void => console.error(safeTerminalText(`[bench] failed: ${message}`));
          if (ui.rich) streaming.withComposerHidden(printError);
          else printError();
        }
        continue;
      }

      if (command === ":project" || command.startsWith(":project ")) {
        if (command !== ":project" && command !== ":project refresh") {
          console.log("Usage: :project [refresh]");
          continue;
        }
        if (command.endsWith(" refresh")) await ui.projectContext.refresh();
        const message = ui.projectContext.formatProjectStatus();
        if (ui.rich) streaming.withComposerHidden(() => console.log(safeTerminalText(message)));
        else console.log(safeTerminalText(message));
        continue;
      }
      if (command === ":instructions" || command.startsWith(":instructions ")) {
        if (command !== ":instructions" && command !== ":instructions refresh") {
          console.log("Usage: :instructions [refresh]");
          continue;
        }
        if (command.endsWith(" refresh")) await ui.projectContext.refresh();
        const statuses = await ui.projectContext.instructionStatuses();
        const lines = ["Project instruction files (user → root → child scope):"];
        if (statuses.length === 0) lines.push("  none found");
        for (const item of statuses) {
          lines.push(
            `  [${item.freshness}] ${item.displayPath} · scope=${item.scope}:${item.appliesTo}`,
          );
        }
        if (statuses.some((item) => item.freshness !== "fresh")) {
          lines.push("Run :instructions refresh to reload changed instructions.");
        }
        const message = safeTerminalText(lines.join("\n"));
        if (ui.rich) streaming.withComposerHidden(() => console.log(message));
        else console.log(message);
        continue;
      }

      if (command === ":trace") {
        const printTrace = (): void => {
          console.log(renderTraceSummary(ui.trace.snapshot()));
        };
        if (ui.rich) {
          streaming.withComposerHidden(printTrace);
        } else {
          printTrace();
        }
        continue;
      }

      if (command === ":cards" || command === ":collapse" || command === ":expand") {
        if (!ui.rich) {
          console.log("Card folding is available only in an interactive terminal.");
          continue;
        }
        if (command === ":cards") {
          streaming.showLatestCard();
        } else {
          streaming.setLatestCardCollapsed(command === ":collapse");
        }
        continue;
      }

      if (command === ":cleanup" || command.startsWith(":cleanup ")) {
        const cleanupArgs = command.slice(":cleanup".length).trim();
        const parsedCleanup = parseCliEvidenceCleanupOptions(
          ["--cleanup-evidence", ...(cleanupArgs ? cleanupArgs.split(/\s+/) : [])],
          true
        );
        if ("error" in parsedCleanup) {
          console.error(safeTerminalText(parsedCleanup.error));
          continue;
        }
        if (!current.memory.pruneEvidence) {
          if (ui.rich) {
            streaming.withComposerHidden(() => {
              console.error("Evidence cleanup is unavailable for this memory.");
            });
          } else {
            console.error("Evidence cleanup is unavailable for this memory.");
          }
          continue;
        }
        try {
          const result = await current.memory.pruneEvidence(parsedCleanup.options);
          const evidenceSummary = await current.memory.evidenceSummary?.();
          const printCleanup = (): void => {
            printEvidenceCleanupResult(
              current.sessionId,
              result,
              evidenceSummary,
              jsonOutput
            );
          };
          if (ui.rich) {
            streaming.withComposerHidden(printCleanup);
          } else {
            printCleanup();
          }
        } catch (error) {
          if (!interrupted) {
            const message = error instanceof Error ? error.message : String(error);
            const printError = (): void => {
              console.error(safeTerminalText(`Evidence cleanup failed: ${message}`));
            };
            if (ui.rich) {
              streaming.withComposerHidden(printError);
            } else {
              printError();
            }
          }
        }
        continue;
      }

      if (command === ":validate" || command.startsWith(":validate ")) {
        const changeSetId = command.slice(":validate".length).trim();
        if (!changeSetId) {
          console.error("Usage: :validate <changeSetId>");
          continue;
        }
        const activeRerunValidation =
          ui.createRerunValidation?.(current) ?? rerunValidation;
        if (!activeRerunValidation) {
          const printError = (): void => {
            console.error("Validation rerun is unavailable because the filesystem tool is unavailable.");
          };
          if (ui.rich) {
            streaming.withComposerHidden(printError);
          } else {
            printError();
          }
          continue;
        }
        const controller = new AbortController();
        abort = controller;
        try {
          const validation = await activeRerunValidation(changeSetId, controller.signal);
          validations.push(validation);
          if (jsonOutput) {
            const changeSets = (await current.memory.changeSets?.()) ?? [];
            const evidenceSummary = await current.memory.evidenceSummary?.();
            const printJson = (): void => {
              console.log(
                JSON.stringify(
                  {
                    validation,
                    changeSets: [...changeSets],
                    ...(evidenceSummary === undefined ? {} : { evidenceSummary }),
                  },
                  null,
                  2
                )
              );
            };
            if (ui.rich) {
              streaming.withComposerHidden(printJson);
            } else {
              printJson();
            }
          } else {
            const printValidation = (): void => {
              printValidationResult(validation, true, ui.width);
            };
            if (ui.rich) {
              streaming.withComposerHidden(printValidation);
            } else {
              printValidationResult(validation, false, ui.width);
            }
          }
        } catch (error) {
          if (!interrupted) {
            const message = error instanceof Error ? error.message : String(error);
            const printError = (): void => {
              console.error(safeTerminalText(`Validation rerun failed: ${message}`));
            };
            if (ui.rich) {
              streaming.withComposerHidden(printError);
            } else {
              printError();
            }
          }
        } finally {
          abort = undefined;
        }
        if (interrupted) {
          break;
        }
        continue;
      }

      pendingPlan = undefined;
      ui.consumePlanReview?.();
      const prepared = await prepareInteractivePrompt(prompt, ui.workingDirectory);
      const contextNotice = formatContextNotice(prepared);
      if (contextNotice) {
        const printContext = (): void => console.log(safeTerminalText(contextNotice));
        if (ui.rich) {
          streaming.withComposerHidden(printContext);
        } else {
          printContext();
        }
      }

      const route = ui.modelRouting.select(prepared.prompt);
      const routeNotice = `[route] mode=${route.mode} reason=${route.reason}`;
      if (ui.rich) streaming.withComposerHidden(() => console.log(routeNotice));
      else console.log(routeNotice);
      const timingContext = { submittedAtMs: performance.now(), queuedAtMs: performance.now() };
      const scheduled = scheduleTask({
        run: ({ signal }) =>
          runPrompt(
            loop,
            current,
            streaming,
            prepared.prompt,
            jsonOutput,
            cost,
            reviews,
            validations,
            signal,
            prepared.context === undefined ? {} : { attachedContext: prepared.context },
            timingContext,
          ),
      });
      activeTaskId = ui.tasks.list().at(-1)?.id;
      try {
        current = await scheduled;
      } catch (error) {
        // An interrupt is not a failure; the session keeps its prior state.
        if (!interrupted) {
          throw error;
        }
      } finally {
        activeTaskId = undefined;
      }
      if (interrupted) {
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
    questionBox.ask = undefined;
    questionBox.askText = undefined;
  }
}

async function interactiveInk(
  loop: AgentLoop,
  context: AgentContext,
  _streaming: StreamingRun,
  questionBox: QuestionBox,
  ui: InteractiveUiOptions,
  jsonOutput = false,
  cost?: UsageCostOptions,
  reviews: readonly ReviewRecord[] = [],
  validations: ValidationResult[] = [],
  rerunValidation?: ValidationRerunner
): Promise<void> {
  const ink = ui.ink;
  if (!ink) {
    return;
  }

  let current = context;
  let pendingPlan: PendingPlan | undefined;
  let latestCollaboration: CollaborationExecutionResult | undefined;
  let latestCollaborationContext: string | undefined;
  let activeCollaboration: CollaborationExecutionHandle | undefined;
  let activeAbort: AbortController | undefined;
  let activeTaskId: string | undefined;
  let autoFixRunning = false;
  let autoFixCancelRequested = false;
  let closed = false;
  let pickerSessions: readonly StoredSession[] | undefined;
  let instance: ReturnType<typeof renderInk> | undefined;
  let lastRetry:
    | {
        readonly prompt: string;
        readonly runOptions: PromptRunOptions;
        readonly label: string;
      }
    | undefined;
  const normalizeTerminalSize = (): void => {
    normalizeInkTerminalSize(process.stdout);
  };

  ink.store.setSpeedMode(ui.speedMode.mode);

  const syncQueue = (): void => {
    ink.store.setQueuedPrompts(ink.controller.snapshot().queuedPrompts);
  };

  const updateInkSummary = (result: AgentContext): void => {
    const modelName = cost === undefined
      ? undefined
      : typeof cost.model === "function"
        ? cost.model()
        : cost.model;
    const runCost = result.usage && modelName !== undefined
      ? estimateCost(result.usage, modelName, cost?.pricing)
      : undefined;
    ink.store.setSummary({
      status: result.state.status,
      turns: result.state.turns,
      usage: result.usage,
      ...summarizeRunTimings(ui.trace.latest()),
      ...(runCost === undefined ? {} : { cost: runCost }),
    });
  };

  const scheduleTask = <T>(
    options: {
      run: (task: AgentTaskExecutionContext) => Promise<T> | T;
    },
  ): Promise<T> =>
    scheduleInteractiveTask(ui.tasks, ui.taskStatusBridge, options.run);

  const runInkPrompt = async (
    prompt: string,
    runOptions: PromptRunOptions = {},
    label = "Run",
    runTask?: (signal: AbortSignal | undefined) => Promise<AgentContext>,
  ): Promise<AgentContext | undefined> => {
    ink.store.clearHistoryView();
    ink.store.setRetry(undefined);
    lastRetry = runTask === undefined
      ? { prompt, runOptions: { ...runOptions }, label }
      : undefined;
    const submittedAtMs = performance.now();
    const queuedAtMs = performance.now();
    const scheduled = scheduleTask({
      run: async ({ signal }) => {
        ui.trace.prepareNextRun({
          submittedAtMs,
          queueMs: Math.max(0, performance.now() - queuedAtMs),
          speedMode: ui.speedMode.mode,
        });
        if (runTask) return runTask(signal);
        await ui.projectContext.refresh();
        return loop.run(current, prompt, {
            signal,
            ...(runOptions.mode === undefined ? {} : { mode: runOptions.mode }),
            toolAccess: runOptions.toolAccess ?? (
              runOptions.mode === "plan" ? "all" : resolvePromptToolAccess(prompt)
            ),
            ...(runOptions.attachedContext === undefined
              ? {}
              : { attachedContext: runOptions.attachedContext }),
          });
      },
    });
    activeTaskId = ui.tasks.list().at(-1)?.id;
    ink.controller.setBusy(true);
    try {
      current = await scheduled;
      updateInkSummary(current);
      if (current.state.status === "error") {
        const message = current.state.lastError ?? `${label} failed`;
        ink.store.setRetry({ prompt, error: message });
        ink.store.addNotice(`${label} failed: ${message}`);
      } else {
        lastRetry = undefined;
      }
      return current;
    } catch (error) {
      const cancelled = activeTaskId !== undefined &&
        ui.tasks.get(activeTaskId)?.status === "cancelled";
      if (cancelled) {
        lastRetry = undefined;
      } else {
        const message = error instanceof Error ? error.message : String(error);
        ink.store.setRetry({ prompt, error: message });
        ink.store.addNotice(
          `${label} failed: ${message}`,
        );
      }
      return undefined;
    } finally {
      activeTaskId = undefined;
      ink.controller.setBusy(false);
      syncQueue();
    }
  };

  const retryLast = async (): Promise<void> => {
    const retry = lastRetry;
    if (retry === undefined) {
      ink.store.addNotice("Nothing to retry.");
      return;
    }
    await runInkPrompt(retry.prompt, retry.runOptions, retry.label);
  };

  const runAutoFixCommand = async (attempts: number): Promise<void> => {
    let repairContext = current;
    const autoFixAbort = new AbortController();
    activeAbort = autoFixAbort;
    autoFixRunning = true;
    autoFixCancelRequested = false;
    try {
      const hasRerunValidation =
        ui.createRerunValidation !== undefined || rerunValidation !== undefined;
      const result = await runAutoFixLoop({
        context: repairContext,
        validations,
        maxAttempts: attempts,
        signal: autoFixAbort.signal,
        loadPersistedValidations: async () =>
          (await repairContext.memory.validations?.()) ?? [],
        ...(hasRerunValidation
          ? {
              rerunValidation: async (changeSetId: string, signal?: AbortSignal) => {
                const activeRerunValidation =
                  ui.createRerunValidation?.(repairContext) ?? rerunValidation;
                if (!activeRerunValidation) {
                  throw new Error("trusted validation rerun is unavailable");
                }
                return activeRerunValidation(changeSetId, signal);
              },
            }
          : {}),
        onProgress: (message) => ink.store.addNotice(message),
        onValidation: (validationResult) => {
          validations.push(validationResult);
          ink.store.addNotice(
            `Validation ${validationResult.status}: ${validationResult.summary}`,
          );
        },
        runRepair: async (repairPrompt): Promise<AutoFixRepairRun> => {
          const next = await runInkPrompt(repairPrompt, {}, "Auto-fix");
          if (next === undefined) {
            return {
              context: repairContext,
              ...(autoFixCancelRequested
                ? { cancelled: true }
                : { error: "agent repair run failed" }),
            };
          }
          repairContext = next;
          return next.state.status === "error"
            ? {
                context: next,
                error: next.state.lastError ?? "agent repair run failed",
              }
            : { context: next };
        },
      });
      current = result.context;
      updateInkSummary(current);
      ink.store.addNotice(result.message);
    } catch (error) {
      if (!autoFixCancelRequested && !autoFixAbort.signal.aborted) {
        ink.store.addNotice(
          `Auto-fix failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      autoFixRunning = false;
      if (activeAbort === autoFixAbort) activeAbort = undefined;
    }
  };

  const runTeamExecution = async (
    prompt: string,
    attachedContext?: string,
    tasks?: readonly CollaborationTask[],
  ): Promise<CollaborationExecutionResult | undefined> => {
    if (!ui.startCollaborativeExecution) {
      ink.store.addNotice("Collaborative execution is unavailable in this session.");
      return undefined;
    }
    latestCollaborationContext = attachedContext;
    latestCollaboration = undefined;
    ink.store.clearCollaboration();
    ink.store.setRetry(undefined);
    const scheduled = scheduleTask({
      run: async ({ signal }) => {
        const handle = await ui.startCollaborativeExecution!(
          prompt,
          current,
          {
            signal,
            attachedContext,
            tasks,
            onEvent: (event) => ink.store.applyCollaborationEvent(event),
          },
        );
        activeCollaboration = handle;
        try {
          return await handle.promise;
        } finally {
          if (activeCollaboration === handle) {
            activeCollaboration = undefined;
          }
        }
      },
    });
    activeTaskId = ui.tasks.list().at(-1)?.id;
    ink.controller.setBusy(true);
    try {
      const result = await scheduled;
      latestCollaboration = result;
      ink.store.setCollaborationResult(result);
      if (result.status === "review" && result.review.mergeable) {
        ink.store.addNotice("Team review ready. Use :team apply after checking the diff.");
      } else if (result.status === "cancelled") {
        ink.store.addNotice("Team execution cancelled.");
      } else {
        ink.store.addNotice("Team execution is blocked. Retry the failed task or inspect the conflicts.");
      }
      return result;
    } catch (error) {
      const cancelled = activeTaskId !== undefined &&
        ui.tasks.get(activeTaskId)?.status === "cancelled";
      if (error instanceof CollaborationScopeReviewCancelledError) {
        ink.store.addNotice("Team execution cancelled during tool-scope review; no task workspaces were created.");
      } else if (!cancelled) {
        const message = error instanceof Error ? error.message : String(error);
        ink.store.addNotice(`Team execution failed: ${safeTerminalText(message)}`);
      }
      return undefined;
    } finally {
      activeTaskId = undefined;
      ink.controller.setBusy(false);
      syncQueue();
    }
  };

  const applyTeamReview = async (): Promise<void> => {
    const result = latestCollaboration;
    if (result === undefined || result.review.mergeable === false) {
      ink.store.addNotice("No mergeable team review is waiting.");
      return;
    }
    if (!ui.mergeCollaborativeReview) {
      ink.store.addNotice("Team merge is unavailable in this session.");
      return;
    }
    const answer = questionBox.ask
      ? await questionBox.ask(
          `Merge the reviewed team changes for "${safeTerminalText(result.prompt)}"? [y/N] `,
        )
      : "";
    if (!answer.trim().toLowerCase().startsWith("y")) {
      ink.store.addNotice("Team review kept. No files were changed.");
      return;
    }
    const scheduled = scheduleTask({
      run: ({ signal }) =>
        ui.mergeCollaborativeReview!(result.review, { signal }),
    });
    activeTaskId = ui.tasks.list().at(-1)?.id;
    ink.controller.setBusy(true);
    try {
      const merge = await scheduled;
      if (merge.status === "merged") {
        ink.store.setCollaborationStatus("merged");
        latestCollaboration = undefined;
        ink.store.addNotice(`Team changes merged: ${safeTerminalText(merge.summary)}`);
      } else {
        ink.store.addNotice(
          `Team merge ${merge.status}: ${safeTerminalText(merge.summary)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ink.store.addNotice(`Team merge failed: ${safeTerminalText(message)}`);
    } finally {
      activeTaskId = undefined;
      ink.controller.setBusy(false);
      syncQueue();
    }
  };

  const close = (exitCode?: number): void => {
    if (closed) return;
    closed = true;
    if (exitCode !== undefined) {
      // Ink owns the terminal session and treats Ctrl-C/Escape as a normal
      // user cancellation. Do not make the package runner report ELIFECYCLE.
      process.exitCode = exitCode;
    }
    if (activeTaskId !== undefined) {
      ui.tasks.cancel(activeTaskId, "session closed");
    }
    activeCollaboration?.cancel("session closed");
    activeAbort?.abort();
    ink.controller.close();
    instance?.unmount();
  };

  const cancel = (): void => {
    if (autoFixRunning) autoFixCancelRequested = true;
    if (activeAbort || activeTaskId !== undefined || activeCollaboration !== undefined) {
      activeCollaboration?.cancel("user interrupted");
      activeAbort?.abort();
      if (activeTaskId !== undefined) {
        ui.tasks.cancel(activeTaskId, "user interrupted");
      }
      process.exitCode = 0;
      ink.store.addNotice("Run interrupted. The composer is ready for the next request.");
      return;
    }
    close(0);
  };

  ink.controller.setSessionId(current.sessionId);

  const dismissSessionPicker = (): void => {
    pickerSessions = undefined;
    ink.store.setSessionPicker(undefined);
  };

  const resumeSessionAt = (index: number): void => {
    const candidate = pickerSessions?.[index];
    dismissSessionPicker();
    if (candidate === undefined) {
      ink.store.addNotice("That session is no longer available.");
      return;
    }
    if (!candidate.readable) {
      ink.store.addNotice(`Session ${safeTerminalText(candidate.id)} is unavailable.`);
      return;
    }
    if (!ui.openSession) {
      ink.store.addNotice("Session switching is unavailable in this interface.");
      return;
    }
    void ui.openSession(candidate.id)
      .then((next) => {
        current = next;
        pendingPlan = undefined;
        lastRetry = undefined;
        ink.store.reset();
        ink.controller.setSessionId(next.sessionId);
        ink.store.addNotice(`Resumed session ${safeTerminalText(next.sessionId)}.`);
        updateInkSummary(next);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        ink.store.addNotice(safeTerminalText(`Session resume failed: ${message}`));
      });
  };

    questionBox.ask = (prompt, signal) => ink.controller.askApproval(prompt, signal);
  questionBox.askText = (prompt, signal) => ink.controller.askText(prompt, signal);
  questionBox.onApprovalRequest = (tool, detail) => {
    ink.store.addNotice(`Approval requested for ${tool}: ${detail}`);
  };
  questionBox.onApprovalResolved = (tool, decision, detail) => {
    ink.store.addNotice(`Sandbox expansion ${decision} for ${tool}: ${detail}`);
  };

  const onSigint = (): void => {
    cancel();
  };
  process.on("SIGINT", onSigint);
  normalizeTerminalSize();
  process.stdout.on("resize", normalizeTerminalSize);
  const inkOutput = createInkRenderOutput(process.stdout);
  let resolveInitialRender!: () => void;
  const initialRender = new Promise<void>((resolve) => {
    resolveInitialRender = resolve;
  });

  instance = renderInk(
    React.createElement(InkCliApp, {
      store: ink.store,
      controller: ink.controller,
      provider: ui.provider,
      model: ui.model,
      sessionId: ui.sessionId,
      workingDirectory: ui.workingDirectory,
      executor: ui.executor ?? "local",
      terminalRowsOffset: 1,
      mcpCount: ui.mcpCount,
      commands: DEFAULT_COMMAND_HINTS,
      onSubmit: (value: string) => {
        ink.controller.submit(value);
        syncQueue();
      },
      onCancel: cancel,
      onExit: close,
      onRetry: () => {
        void retryLast();
      },
      onDismissRetry: () => {
        lastRetry = undefined;
        ink.store.setRetry(undefined);
      },
      onSessionResume: resumeSessionAt,
      onDismissSessionPicker: dismissSessionPicker,
      onApprovalAnswer: (value: string) => {
        ink.controller.submit(value);
        syncQueue();
      },
    }),
    {
      stdin: process.stdin,
      stdout: inkOutput,
      stderr: process.stderr,
      exitOnCtrlC: false,
      patchConsole: true,
      // The welcome panel is the only static block now; the transcript,
      // composer, and footer share one controlled dynamic viewport. Use Ink's
      // standard log-update renderer: the incremental diff misplaces cursor
      // rows whenever a frame grows or shrinks, which leaves stale duplicated
      // status and transcript lines on real PTYs.
      maxFps: 15,
      onRender: () => {
        // Do not let input that arrived while providers/MCP were starting
        // launch a run before the composer has painted its first frame. Ink
        // still receives and buffers those keystrokes through the controller;
        // the interactive loop begins consuming them only after this point.
        resolveInitialRender();
      },
    },
  );

  const handleCommand = async (command: string, queued = false): Promise<boolean> => {
    const themeCommand = parseInkThemeCommand(command);
    if (themeCommand.handled) {
      if (themeCommand.error) {
        ink.store.addNotice(themeCommand.error);
      } else if (themeCommand.name === undefined) {
        ink.store.addNotice(
          `Theme: ${ink.controller.snapshot().theme}. Available: ${INK_THEME_NAMES.join(", ")}`,
        );
      } else {
        const previousTheme = ink.controller.snapshot().theme;
        ink.controller.setTheme(themeCommand.name);
        try {
          await ink.persistTheme?.(themeCommand.name);
          ink.store.addNotice(`Theme switched to ${themeCommand.name}.`);
        } catch {
          ink.controller.setTheme(previousTheme);
          ink.store.addNotice("Theme changed for this session, but could not be saved.");
        }
      }
      return true;
    }
    const sessionLookup = await sessionPickerLookup(command, ui);
    if (sessionLookup.handled) {
      if (sessionLookup.error) {
        ink.store.addNotice(sessionLookup.error);
        return true;
      }
      const controllerSnapshot = ink.controller.snapshot();
      if (
        queued ||
        activeTaskId !== undefined ||
        controllerSnapshot.busy ||
        controllerSnapshot.queuedPrompts.length > 0
      ) {
        ink.store.addNotice("Switching sessions is available only while idle.");
        return true;
      }
      if (sessionLookup.sessions.length === 0) {
        ink.store.addNotice(
          formatSessionPickerList(sessionLookup.sessions, sessionLookup.query),
        );
        return true;
      }
      pickerSessions = sessionLookup.sessions;
      ink.store.setSessionPicker({
        title: sessionLookup.query === undefined
          ? "SESSIONS"
          : `SESSIONS · ${safeTerminalText(sessionLookup.query)}`,
        rows: sessionLookup.sessions.map(formatStoredSessionRow),
        selectedIndex: 0,
      });
      return true;
    }
    if (command === ":retry") {
      await retryLast();
      return true;
    }
    const autoFixCommand = parseAutoFixCommand(command);
    if (autoFixCommand.handled) {
      if (autoFixCommand.error !== undefined) {
        ink.store.addNotice(autoFixCommand.error);
      } else {
        await runAutoFixCommand(autoFixCommand.attempts ?? 2);
      }
      return true;
    }
    if (isGitWorkflowCommand(command)) {
      const workflowAbort = new AbortController();
      activeAbort = workflowAbort;
      ink.controller.setBusy(true);
      try {
        const workflowMessage = await gitWorkflowCommandMessage(
          command,
          ui,
          questionBox,
          workflowAbort.signal,
        );
        ink.store.addNotice(workflowMessage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ink.store.addNotice(safeTerminalText(`GitHub workflow failed: ${message}`));
      } finally {
        if (activeAbort === workflowAbort) activeAbort = undefined;
        ink.controller.setBusy(false);
        syncQueue();
      }
      return true;
    }
    if (isProjectMemoryCommand(command)) {
      const memoryAbort = new AbortController();
      activeAbort = memoryAbort;
      ink.controller.setBusy(true);
      try {
        const memoryMessage = await projectMemoryCommandMessage(
          command,
          ui,
          questionBox,
          memoryAbort.signal,
        );
        ink.store.addNotice(memoryMessage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ink.store.addNotice(safeTerminalText(`Project memory failed: ${message}`));
      } finally {
        if (activeAbort === memoryAbort) activeAbort = undefined;
        ink.controller.setBusy(false);
        syncQueue();
      }
      return true;
    }
    const skillMessage = skillCommandMessage(command, ui);
    if (skillMessage !== undefined) {
      ink.store.addNotice(skillMessage);
      return true;
    }
    const extensionMessage = extensionCommandMessage(command, ui);
    if (extensionMessage !== undefined) {
      ink.store.addNotice(extensionMessage);
      return true;
    }
    const backgroundJobMessage = await backgroundJobCommandMessage(command, ui);
    if (backgroundJobMessage !== undefined) {
      ink.store.addNotice(backgroundJobMessage);
      return true;
    }
    const taskMessage = taskCommandMessage(command, ui);
    if (taskMessage !== undefined) {
      ink.store.addNotice(taskMessage);
      return true;
    }
    const checkpointResult = await checkpointCommandResult(command, ui, current);
    if (checkpointResult?.handled) {
      if (checkpointResult.rewound) {
        ink.store.reset();
      }
      if (checkpointResult.message) {
        ink.store.addNotice(checkpointResult.message);
      }
      return true;
    }
    const historyMessage = await sessionHistoryCommandMessage(command, current.memory);
    if (historyMessage !== undefined) {
      ink.store.setHistoryView(historyViewFromMessage(historyMessage));
      return true;
    }
    const searchMessage = await sessionSearchCommandMessage(command, current.memory);
    if (searchMessage !== undefined) {
      ink.store.setHistoryView(historyViewFromMessage(searchMessage));
      return true;
    }
    const exportMessage = await sessionExportCommandMessage(
      command,
      current.memory,
      ui.workingDirectory,
      current.sessionId,
    );
    if (exportMessage !== undefined) {
      ink.store.addNotice(exportMessage);
      return true;
    }
    const teamCommand = parseTeamCommand(command);
    if (teamCommand !== undefined) {
      if (teamCommand.kind === "execute") {
        if (!teamCommand.request) {
          ink.store.addNotice("Usage: :team <request> · :team plan <request>");
          return true;
        }
        const prepared = await prepareInteractivePrompt(
          teamCommand.request,
          ui.workingDirectory,
        );
        const contextNotice = formatContextNotice(prepared);
        if (contextNotice) {
          ink.store.addNotice(contextNotice);
        }
        await runTeamExecution(prepared.prompt, prepared.context);
        return true;
      }
      if (teamCommand.kind === "plan") {
        if (!teamCommand.request) {
          ink.store.addNotice("Usage: :team plan <request>");
          return true;
        }
        if (!ui.runCollaborativePlan) {
          ink.store.addNotice("Collaborative planning is unavailable in this session.");
          return true;
        }
        const prepared = await prepareInteractivePrompt(
          teamCommand.request,
          ui.workingDirectory,
        );
        const contextNotice = formatContextNotice(prepared);
        if (contextNotice) {
          ink.store.addNotice(contextNotice);
        }
        await runInkPrompt(
          prepared.prompt,
          prepared.context === undefined
            ? {}
            : { attachedContext: prepared.context },
          "Team plan",
          async (signal) => {
            const result = await ui.runCollaborativePlan!(
              prepared.prompt,
              current,
              { signal, attachedContext: prepared.context },
            );
            ink.store.addNotice(formatCollaborativePlanResult(result));
            return current;
          },
        );
        return true;
      }
      if (teamCommand.kind === "cancel") {
        if (activeCollaboration === undefined) {
          ink.store.addNotice("No team execution is currently running.");
        } else if (teamCommand.taskId === undefined) {
          activeCollaboration.cancel("user cancelled the team execution");
          ink.store.addNotice("Team execution cancellation requested.");
        } else if (
          activeCollaboration.cancelTask(
            teamCommand.taskId,
            "user cancelled the team task",
          )
        ) {
          ink.store.addNotice(`Cancellation requested for team task ${teamCommand.taskId}.`);
        } else {
          ink.store.addNotice(`Team task not found or already finished: ${teamCommand.taskId}`);
        }
        return true;
      }
      if (teamCommand.kind === "retry") {
        if (!teamCommand.taskId) {
          ink.store.addNotice("Usage: :team retry <taskId>");
          return true;
        }
        if (latestCollaboration === undefined) {
          ink.store.addNotice("No team result is available to retry.");
          return true;
        }
        const task = latestCollaboration.plan.find(
          (candidate) => candidate.id === teamCommand.taskId,
        );
        if (task === undefined) {
          ink.store.addNotice(`Unknown team task: ${teamCommand.taskId}`);
          return true;
        }
        await runTeamExecution(
          latestCollaboration.prompt,
          latestCollaborationContext,
          [{ ...task, dependsOn: undefined }],
        );
        return true;
      }
      await applyTeamReview();
      return true;
    }
    const planRequest = planRequestFromCommand(command);
    if (planRequest !== undefined) {
      if (!planRequest) {
        ink.store.addNotice("Usage: :plan <request>");
        return true;
      }
      ui.consumePlanReview?.();
      const prepared = await prepareInteractivePrompt(planRequest, ui.workingDirectory);
      const contextNotice = formatContextNotice(prepared);
      if (contextNotice) {
        ink.store.addNotice(contextNotice);
      }
      const result = await runInkPrompt(
        prepared.prompt,
        {
          mode: "plan",
          ...(prepared.context === undefined ? {} : { attachedContext: prepared.context }),
        },
        "Plan",
      );
      if (result && result.state.status !== "error") {
        pendingPlan = await capturePendingPlan(
          result,
          prepared.prompt,
          prepared.context,
          ui.consumePlanReview?.(),
        );
        if (pendingPlan.review !== undefined) {
          ink.store.setPlan({
            prompt: pendingPlan.prompt,
            review: pendingPlan.review,
            status: "ready",
          });
          ink.store.addNotice("Plan ready. Review the files above, then use :apply.");
        } else {
          ink.store.addNotice(
            "Plan ready. Review the proposed steps in the transcript, then use :apply.",
          );
        }
      }
      return true;
    }
    if (isApplyCommand(command)) {
      if (!pendingPlan) {
        ink.store.addNotice("No plan is waiting. Use :plan <request> first.");
        return true;
      }
      const planToApply = pendingPlan;
      const answer = questionBox.ask
        ? await questionBox.ask(
            `Apply the latest plan for "${safeTerminalText(planToApply.prompt)}"? [y/N] `,
          )
        : "";
      if (!answer.trim().toLowerCase().startsWith("y")) {
        ink.store.addNotice("Plan kept. No files were changed.");
        return true;
      }

      const prepared = await prepareInteractivePrompt(
        planToApply.prompt,
        ui.workingDirectory,
      );
      const contextNotice = formatContextNotice(prepared);
      if (contextNotice) {
        ink.store.addNotice(contextNotice);
      }
      ink.store.setPlanStatus("applying");
      const approvedContext = approvedPlanContext(planToApply);
      const result = await runInkPrompt(
        prepared.prompt,
        planToApply.review === undefined
          ? approvedContext === undefined
            ? prepared.context === undefined
              ? {}
              : { attachedContext: prepared.context }
            : { attachedContext: approvedContext }
          : {},
        "Apply",
        planToApply.review === undefined
          ? undefined
          : (signal) =>
              loop.applyPlannedChangeSet(current, {
                prompt: prepared.prompt,
                review: planToApply.review!,
                signal,
              }),
      );
      if (result && result.state.status !== "error") {
        pendingPlan = undefined;
        ink.store.setPlan(undefined);
      } else {
        ink.store.setPlanStatus("ready");
      }
      return true;
    }
    if (command === ":help") {
      ink.store.addNotice(
        DEFAULT_COMMAND_HINTS
          .map((hint) => `${hint.command}  ${hint.description ?? ""}`.trimEnd())
          .join("\n"),
      );
      return true;
    }
    if (command === ":clear") {
      pendingPlan = undefined;
      ink.store.reset();
      return true;
    }
    if (command === ":model") {
      ink.store.addNotice(
        `Provider: ${ui.provider}\nModel: ${ui.model}\nTransport: ${
          ui.streaming ? "streaming" : "single response"
        }`,
      );
      return true;
    }
    const routingMessage = executeModelRoutingCommand(command, ui.modelRouting, ui.modelBudget);
    if (routingMessage !== undefined) {
      ink.store.addNotice(safeTerminalText(routingMessage));
      return true;
    }
    const modeCommand = parseSpeedModeCommand(command);
    if (modeCommand) {
      if (modeCommand.kind === "invalid") {
        ink.store.addNotice("Usage: :mode fast|balanced|deep");
      } else {
        if (modeCommand.kind === "set") ui.modelRouting.setManualMode(modeCommand.mode);
        ink.store.setSpeedMode(ui.speedMode.mode);
        ink.store.addNotice(`Speed mode: ${ui.speedMode.mode} · ${describeSpeedModeSupport(
          { id: ui.provider as ModelProvider["id"], model: ui.model },
          ui.speedMode.mode,
        )}`);
      }
      return true;
    }
    const benchmarkPrompt = parseBenchmarkCommand(command);
    if (benchmarkPrompt !== undefined) {
      ink.controller.setBusy(true);
      void ui.benchmark(benchmarkPrompt)
        .then((result) => {
          ink.store.addNotice(
            `[bench] scope=provider-only model=${safeTerminalText(ui.model)} mode=${ui.speedMode.mode} first-token=${formatTimingMs(result.firstTokenMs)} total=${formatTimingMs(result.totalMs)}`,
          );
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "benchmark failed";
          ink.store.addNotice(`[bench] failed: ${safeTerminalText(message)}`);
        })
        .finally(() => ink.controller.setBusy(false));
      return true;
    }
    if (command === ":project" || command.startsWith(":project ")) {
      if (command !== ":project" && command !== ":project refresh") {
        ink.store.addNotice("Usage: :project [refresh]");
        return true;
      }
      if (command.endsWith(" refresh")) await ui.projectContext.refresh();
      ink.store.addNotice(safeTerminalText(ui.projectContext.formatProjectStatus()));
      return true;
    }
    if (command === ":instructions" || command.startsWith(":instructions ")) {
      if (command !== ":instructions" && command !== ":instructions refresh") {
        ink.store.addNotice("Usage: :instructions [refresh]");
        return true;
      }
      if (command.endsWith(" refresh")) await ui.projectContext.refresh();
      const statuses = await ui.projectContext.instructionStatuses();
      const lines = ["Project instruction files (user → root → child scope):"];
      if (statuses.length === 0) lines.push("  none found");
      for (const item of statuses) {
        lines.push(
          `  [${item.freshness}] ${item.displayPath} · scope=${item.scope}:${item.appliesTo}`,
        );
      }
      if (statuses.some((item) => item.freshness !== "fresh")) {
        lines.push("Run :instructions refresh to reload changed instructions.");
      }
      ink.store.addNotice(safeTerminalText(lines.join("\n")));
      return true;
    }
    if (command === ":trace") {
      ink.store.addNotice(renderTraceSummary(ui.trace.snapshot()));
      return true;
    }
    if (command === ":cards") {
      ink.store.addNotice("Tool cards remain visible in the transcript.");
      return true;
    }
    if (command === ":collapse" || command === ":expand") {
      ink.store.addNotice(
        command === ":collapse"
          ? "The latest tool card is collapsed."
          : "The latest tool card is expanded.",
      );
      return true;
    }
    if (command === ":cleanup" || command.startsWith(":cleanup ")) {
      const cleanupArgs = command.slice(":cleanup".length).trim();
      const parsedCleanup = parseCliEvidenceCleanupOptions(
        ["--cleanup-evidence", ...(cleanupArgs ? cleanupArgs.split(/\s+/) : [])],
        true,
      );
      if ("error" in parsedCleanup) {
        ink.store.addNotice(parsedCleanup.error);
        return true;
      }
      if (!current.memory.pruneEvidence) {
        ink.store.addNotice("Evidence cleanup is unavailable for this memory.");
        return true;
      }
      try {
        const result = await current.memory.pruneEvidence(parsedCleanup.options);
        ink.store.addNotice(
          `Evidence cleanup: removed ${result.validationsRemoved} validations and ${result.changeSetsRemoved} change sets.`,
        );
      } catch (error) {
        ink.store.addNotice(
          `Evidence cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return true;
    }
    if (command === ":validate" || command.startsWith(":validate ")) {
      const changeSetId = command.slice(":validate".length).trim();
      if (!changeSetId) {
        ink.store.addNotice("Usage: :validate <changeSetId>");
        return true;
      }
      const activeRerunValidation =
        ui.createRerunValidation?.(current) ?? rerunValidation;
      if (!activeRerunValidation) {
        ink.store.addNotice("Validation rerun is unavailable because the filesystem tool is unavailable.");
        return true;
      }
      const controller = new AbortController();
      activeAbort = controller;
      try {
        const validation = await activeRerunValidation(changeSetId, controller.signal);
        validations.push(validation);
        ink.store.addNotice(`Validation ${validation.status}: ${validation.summary}`);
      } catch (error) {
        if (!controller.signal.aborted) {
          ink.store.addNotice(
            `Validation rerun failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        activeAbort = undefined;
      }
      return true;
    }
    return false;
  };

  try {
    await initialRender;
    while (!closed) {
      const item = await ink.controller.nextPrompt();
      syncQueue();
      if (item === null || closed) {
        break;
      }
      const prompt = item.value.trim();
      if (!prompt) {
        continue;
      }
      const command = normalizeInteractiveCommand(prompt);
      if (command === ":quit" || command === "exit" || command === "quit") {
        close(0);
        break;
      }
      if (await handleCommand(command, item.queued)) {
        continue;
      }

      pendingPlan = undefined;
      ink.store.setPlan(undefined);
      const prepared = await prepareInteractivePrompt(prompt, ui.workingDirectory);
      const contextNotice = formatContextNotice(prepared);
      if (contextNotice) {
        ink.store.addNotice(contextNotice);
      }
      const route = ui.modelRouting.select(prepared.prompt);
      ink.store.addNotice(`[route] mode=${route.mode} reason=${route.reason}`);
      await runInkPrompt(
        prepared.prompt,
        prepared.context === undefined ? {} : { attachedContext: prepared.context },
      );
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.stdout.off("resize", normalizeTerminalSize);
    questionBox.ask = undefined;
    questionBox.askText = undefined;
    questionBox.onApprovalRequest = undefined;
    close();
  }
}

interface UsageCostOptions {
  readonly model: string | (() => string);
  readonly pricing?: PriceTable;
  readonly selection?: () => ModelSelectionResult;
  readonly trace?: AgentRunTrace;
  readonly speedMode?: () => ModelSpeedMode;
  readonly projectContext?: ProjectContextManager;
}

function createCliValidationAdapter(
  executor: ReturnType<typeof createExecutor>,
  policy: ValidationPolicy = "default"
): ValidationAdapter {
  const runner = createValidationRunner(executor);
  return {
    prepare: (review, context, options) =>
      deriveValidationPlan(review, {
        workingDirectory: context.workingDirectory,
        isGitRepository: existsSync(join(context.workingDirectory, ".git")),
        policy,
        validationId: options?.validationId,
      }),
    run: (plan, options) => runner.run(plan, options),
  };
}

type ValidationRerunner = (
  changeSetId: string,
  signal?: AbortSignal
) => Promise<ValidationResult>;

async function restorePersistedChangeSets(
  filesystem: FilesystemTool,
  context: AgentContext
) {
  const records = (await context.memory.changeSets?.()) ?? [];
  return filesystem.restoreAppliedChangeSets(records, {
    sessionId: context.sessionId,
    workingDirectory: context.workingDirectory,
  });
}

/** Runs an explicit, guarded validation attempt from the interactive CLI. */
export async function runExplicitValidation(
  filesystem: FilesystemTool,
  validation: ValidationAdapter,
  context: AgentContext,
  changeSetId: string,
  signal?: AbortSignal
): Promise<ValidationResult> {
  const startedAt = Date.now();
  const validationId = createValidationAttemptId(changeSetId);
  let result: ValidationResult;
  const restoreResults = await restorePersistedChangeSets(filesystem, context);
  const blockedRestore = restoreResults.find(
    (candidate) => candidate.changeSetId === changeSetId && candidate.status === "blocked"
  );
  if (blockedRestore) {
    result = createBlockedValidationResult(
      changeSetId,
      validationId,
      `validation rerun blocked: ${blockedRestore.reason ?? "persisted change-set evidence could not be restored"}`,
      startedAt
    );
  } else {
    try {
      result = await filesystem.withAppliedChangeSet(changeSetId, (review) =>
        runValidationAttempt(validation, review, context, {
          signal,
          validationId,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/postimage|hash conflict|cannot rollback non-empty directory/i.test(message)) {
        throw error;
      }
      result = createBlockedValidationResult(
        changeSetId,
        validationId,
        `validation rerun blocked: ${message}`,
        startedAt
      );
    }
  }

  try {
    await context.memory.recordValidation?.(result);
  } catch {
    // Evidence persistence is best-effort; rerunning checks must never mutate
    // or roll back the applied files because recording failed.
  }
  return result;
}

function printValidationResult(
  result: ValidationResult,
  richUi = false,
  width = 80
): void {
  if (richUi) {
    process.stdout.write(
      `${renderValidationMessage(result.status, result.summary, { width })}\n`
    );
    return;
  }
  process.stdout.write(
    `[validation] ${safeTerminalText(result.status)}: ${safeTerminalText(
      result.summary
    )}\n`
  );
  for (const check of result.checks) {
    const detail = check.reason ? ` — ${safeTerminalText(check.reason)}` : "";
    const command = safeTerminalText(
      formatValidationCommand(check.command.executable, check.command.args)
    );
    process.stdout.write(
      `  [${safeTerminalText(check.status)}] ${safeTerminalText(check.id)} (${check.durationMs}ms) — ${command}${detail}\n`
    );
  }
}

function formatValidationCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args]
    .map((part) => /^[A-Za-z0-9_./:@%+=,-]+$/.test(part) ? part : JSON.stringify(part))
    .join(" ");
}

function parseCliEvidenceAuditOptions(
  args: readonly string[],
  auditSurface: boolean,
  exportEvidence: boolean
):
  | { readonly filters: EvidenceAuditFilters; readonly limits?: EvidenceAuditLimits }
  | { readonly error: string } {
  const changeSetId = readCliEvidenceFilterValue(args, "--change-set-id");
  if ("error" in changeSetId) return changeSetId;
  const validationId = readCliEvidenceFilterValue(args, "--validation-id");
  if ("error" in validationId) return validationId;
  const status = readCliEvidenceFilterValue(args, "--status");
  if ("error" in status) return status;

  const limitsResult = parseCliEvidenceAuditLimits(args, exportEvidence);
  if ("error" in limitsResult) return limitsResult;

  const hasFilter =
    changeSetId.value !== undefined ||
    validationId.value !== undefined ||
    status.value !== undefined;
  if (hasFilter && !auditSurface) {
    return { error: "evidence filters require --export-evidence or --preview-evidence" };
  }
  if (status.value !== undefined && !["passed", "failed", "skipped", "blocked"].includes(status.value)) {
    return { error: "status must be one of: passed, failed, skipped, blocked" };
  }
  return {
    filters: {
      ...(changeSetId.value === undefined ? {} : { changeSetId: changeSetId.value }),
      ...(validationId.value === undefined ? {} : { validationId: validationId.value }),
      ...(status.value === undefined ? {} : { status: status.value as EvidenceAuditFilters["status"] }),
    },
    ...(limitsResult.limits === undefined ? {} : { limits: limitsResult.limits }),
  };
}

function parseCliEvidenceAuditLimits(
  args: readonly string[],
  exportEvidence: boolean
): { readonly limits?: EvidenceAuditLimits } | { readonly error: string } {
  const specs: readonly { readonly flag: string; readonly key: keyof EvidenceAuditLimits }[] = [
    { flag: "--audit-max-validations", key: "maxValidations" },
    { flag: "--audit-max-change-sets", key: "maxChangeSets" },
    { flag: "--audit-max-files", key: "maxFiles" },
    { flag: "--audit-max-bytes", key: "maxBytes" },
  ];
  const hasLimit = specs.some(({ flag }) => args.includes(flag));
  if (hasLimit && !exportEvidence) {
    return { error: "evidence export limit options require --export-evidence" };
  }

  const values: Partial<Record<keyof EvidenceAuditLimits, number>> = {};
  for (const { flag, key } of specs) {
    const index = args.indexOf(flag);
    if (index < 0) {
      continue;
    }
    const raw = args[index + 1];
    const value = raw === undefined ? Number.NaN : Number(raw);
    if (raw === undefined || raw.startsWith("-") || !Number.isSafeInteger(value) || value <= 0) {
      return { error: `${flag} must be a positive integer` };
    }
    values[key] = value;
  }

  const limits: EvidenceAuditLimits = {
    ...(values.maxValidations === undefined ? {} : { maxValidations: values.maxValidations }),
    ...(values.maxChangeSets === undefined ? {} : { maxChangeSets: values.maxChangeSets }),
    ...(values.maxFiles === undefined ? {} : { maxFiles: values.maxFiles }),
    ...(values.maxBytes === undefined ? {} : { maxBytes: values.maxBytes }),
  };
  try {
    validateEvidenceAuditLimits(limits);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  return Object.keys(limits).length === 0 ? {} : { limits };
}

function readCliEvidenceFilterValue(
  args: readonly string[],
  flag: string
): { readonly value?: string } | { readonly error: string } {
  const index = args.indexOf(flag);
  if (index < 0) return {};
  const value = args[index + 1]?.trim();
  if (!value) {
    return { error: `${flag} requires a non-empty value` };
  }
  return { value };
}

function parseCliEvidenceCleanupOptions(
  args: readonly string[],
  cleanupEvidence: boolean
): { readonly options: EvidencePruneOptions } | { readonly error: string } {
  const maxValidationsIndex = args.indexOf("--max-validations");
  const maxChangeSetsIndex = args.indexOf("--max-change-sets");
  const hasCleanupOption =
    maxValidationsIndex >= 0 ||
    maxChangeSetsIndex >= 0 ||
    args.includes("--remove-rolled-back");
  if (hasCleanupOption && !cleanupEvidence) {
    return { error: "evidence cleanup options require --cleanup-evidence" };
  }

  const parseLimit = (index: number, name: string): number | string | undefined => {
    if (index < 0) return undefined;
    const raw = args[index + 1];
    const value = Number(raw);
    if (
      raw === undefined ||
      raw.startsWith("-") ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > 10_000
    ) {
      return `${name} must be a positive integer no greater than 10000`;
    }
    return value;
  };

  const maxValidations = parseLimit(maxValidationsIndex, "--max-validations");
  if (typeof maxValidations === "string") return { error: maxValidations };
  const maxChangeSets = parseLimit(maxChangeSetsIndex, "--max-change-sets");
  if (typeof maxChangeSets === "string") return { error: maxChangeSets };
  return {
    options: {
      ...(maxValidations === undefined ? {} : { maxValidations }),
      ...(maxChangeSets === undefined ? {} : { maxChangeSets }),
      ...(args.includes("--remove-rolled-back") ? { removeRolledBack: true } : {}),
    },
  };
}

function printEvidenceSummary(summary: EvidenceSummary): void {
  console.log(
    `Evidence: validations=${summary.validations} changeSets=${summary.changeSets} protected applied guards=${summary.protectedChangeSets} rolled-back=${summary.rolledBackChangeSets}`
  );
  console.log(
    `Retention: validations<=${summary.retention.maxValidations} changeSets<=${summary.retention.maxChangeSets}`
  );
  console.log(`Protected reason: ${safeTerminalText(summary.protectedChangeSetsReason)}.`);
}

function printEvidenceCleanupResult(
  sessionId: string,
  result: EvidencePruneResult,
  summary: EvidenceSummary | undefined,
  jsonOutput: boolean
): void {
  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          sessionId,
          ...result,
          ...(summary === undefined ? {} : { evidenceSummary: summary }),
        },
        null,
        2
      )
    );
    return;
  }
  console.log(`Evidence cleanup for session ${safeTerminalText(sessionId)}:`);
  console.log(`  Removed validations: ${result.validationsRemoved}`);
  console.log(`  Removed change sets: ${result.changeSetsRemoved}`);
  console.log(`  Protected applied guards: ${result.protectedChangeSets}`);
  console.log(`  Remaining validations: ${result.remainingValidations}`);
  console.log(`  Remaining change sets: ${result.remainingChangeSets}`);
  if (summary !== undefined) {
    printEvidenceSummary(summary);
  }
}

async function runPrompt(
  loop: AgentLoop,
  context: AgentContext,
  streaming: StreamingRun,
  prompt: string,
  jsonOutput = false,
  costOptions?: UsageCostOptions,
  reviews: readonly ReviewRecord[] = [],
  validations: readonly ValidationResult[] = [],
  signal?: AbortSignal,
  runOptions: PromptRunOptions = {},
  timingContext?: PromptRunTimingContext,
): Promise<AgentContext> {
  const startedAtMs = performance.now();
  costOptions?.trace?.prepareNextRun({
    submittedAtMs: timingContext?.submittedAtMs ?? startedAtMs,
    queueMs: timingContext === undefined
      ? 0
      : Math.max(0, startedAtMs - timingContext.queuedAtMs),
    speedMode: costOptions.speedMode?.(),
  });
  await costOptions?.projectContext?.refresh();
  streaming.begin();
  const rawResult = await loop.run(context, prompt, {
    ...(signal === undefined ? {} : { signal }),
    ...(runOptions.mode === undefined ? {} : { mode: runOptions.mode }),
    toolAccess: runOptions.toolAccess ?? (
      runOptions.mode === "plan" ? "all" : resolvePromptToolAccess(prompt)
    ),
    ...(runOptions.attachedContext === undefined
      ? {}
      : { attachedContext: runOptions.attachedContext }),
  }).catch((error) => {
    // Keep a rich live block from leaking into the next prompt when a request
    // is aborted or fails before the normal result rendering path.
    streaming.finish(
      signal?.aborted ? "interrupted" : "error",
      undefined,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  });
  const timing = streaming.finish(
    rawResult.state.status === "error" ? "error" : "ready",
    rawResult.usage,
    rawResult.state.lastError
  );
  const currentSelection = costOptions?.selection?.();
  const result = currentSelection === undefined
    ? rawResult
    : {
        ...rawResult,
        metadata: {
          ...rawResult.metadata,
          provider: currentSelection.selection.provider,
          ...(currentSelection.selection.model === undefined
            ? {}
            : { model: currentSelection.selection.model }),
          modelSelection: formatModelSelectionMetadata(currentSelection),
        },
      };
  if (result.state.status === "error" && jsonOutput) {
    emitCliError(result.state.lastError ?? "Agent run failed", true);
    process.exitCode = 1;
    return result;
  }
  const entries = await result.memory.entries();
  const persistedValidations = await result.memory.validations?.();
  const persistedChangeSets = await result.memory.changeSets?.();
  const evidenceSummary = await result.memory.evidenceSummary?.();
  const outputValidations = persistedValidations ?? validations;
  const outputChangeSets = persistedChangeSets ?? [];
  const lastAssistant = [...entries].reverse().find((entry) => entry.role === "assistant");
  const costModel = costOptions === undefined
    ? undefined
    : typeof costOptions.model === "function"
      ? costOptions.model()
      : costOptions.model;
  const cost =
    result.usage && costModel !== undefined
      ? estimateCost(result.usage, costModel, costOptions?.pricing)
      : undefined;

  if (jsonOutput) {
    console.log(
      JSON.stringify({
        sessionId: result.sessionId,
        status: result.state.status,
        turns: result.state.turns,
        content: lastAssistant?.content ?? "",
        usage: result.usage ?? null,
        cost: cost ?? null,
        reviews: [...reviews],
        validations: [...outputValidations],
        changeSets: [...outputChangeSets],
        ...(evidenceSummary === undefined ? {} : { evidenceSummary }),
      })
    );
    return result;
  }

  return streaming.withComposerHidden(() => {
    if (streaming.isRichUi()) {
      if (!streaming.hasStreamed() && lastAssistant) {
        console.log(
          renderAssistantMessage(lastAssistant.content, {
            width: streaming.width(),
          })
        );
      }
    } else if (streaming.isEnabled() && streaming.hasStreamed()) {
      process.stdout.write("\n");
    } else if (lastAssistant) {
      console.log(safeTerminalText(lastAssistant.content));
    }
    console.log(`[state=${result.state.status} turns=${result.state.turns}]`);
    if (result.usage) {
      const suffix = cost === undefined ? "" : ` cost=$${formatCost(cost)}`;
      console.log(
        `[usage] prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens} total=${result.usage.totalTokens}${suffix}`
      );
    }
    const traceTiming = summarizeRunTimings(costOptions?.trace?.latest());
    console.log(
      `[timing] queue=${formatTimingMs(traceTiming.queueMs)} first-token=${formatTimingMs(
        traceTiming.firstTokenMs ?? timing.firstTokenMs
      )} model=${formatTimingMs(traceTiming.modelMs)} tool=${formatTimingMs(traceTiming.toolMs)} total=${formatTimingMs(
        traceTiming.totalMs ?? timing.totalMs
      )}`
    );
    return result;
  });
}

function formatTimingMs(value: number | undefined): string {
  return value === undefined ? "n/a" : `${Math.max(0, Math.round(value))}ms`;
}

function readMcpManagementEntries(config: CliConfig): readonly unknown[] {
  const raw = process.env.DEV_AGENT_MCP_SERVERS?.trim();
  if (!raw) {
    return config.mcpServers ?? [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [null];
  } catch {
    // Let the management module turn malformed environment input into its
    // stable invalid_config result without echoing the raw value.
    return [null];
  }
}

function createMcpManagementProbe(workingDirectory: string): McpProbe {
  return async ({ server }) => {
    const client = new McpStdioClient();
    try {
      await client.connect({ ...server, rootDirectory: workingDirectory });
      const [tools, resources, prompts] = await Promise.all([
        client.listTools(),
        client.listResources(),
        client.listPrompts(),
      ]);
      return {
        snapshot: {
          serverInfo: client.getServerInfo(),
          capabilities: client.getServerCapabilities(),
          counts: {
            tools: tools.length,
            resources: resources.length,
            prompts: prompts.length,
          },
        },
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  };
}

function printMcpCommandResult(result: McpManagementResult): void {
  if (result.reason) {
    console.log(`${result.command}: ${result.status} (${result.reason})`);
  } else {
    console.log(`${result.command}: ${result.status}`);
  }
  for (const server of result.servers) {
    const latency = server.latencyMs === null ? "n/a" : `${server.latencyMs}ms`;
    console.log(`- ${safeTerminalText(server.name)}: ${server.state}, latency=${latency}`);
  }
}

function printMcpConfigCommandResult(result: McpConfigCommandResult): void {
  if (result.status === "not_found") {
    console.log(`mcp config: server '${safeTerminalText(result.name)}' was not found.`);
    return;
  }
  const action = result.status === "added" ? "Added" :
    result.status === "removed" ? "Removed" :
    result.status === "enabled" ? "Enabled" : "Disabled";
  console.log(
    `${action} MCP server '${safeTerminalText(result.name)}' ` +
      `(${result.serverCount} configured, ${result.argumentCount} args, ` +
      `${result.environmentVariableCount} environment variables).`,
  );
}

function printMcpTemplates(templates: ReturnType<typeof listMcpTemplates>): void {
  console.log("MCP templates:");
  for (const template of templates) {
    console.log(`- ${safeTerminalText(template.name)}: ${safeTerminalText(template.description)}`);
    console.log(`  command: ${safeTerminalText(template.command)}`);
    console.log(`  args: ${template.args.map((arg) => safeTerminalText(arg)).join(" ")}`);
    console.log(
      `  required environment: ${
        template.requiredEnvironment.length === 0
          ? "none"
          : template.requiredEnvironment.map((name) => safeTerminalText(name)).join(", ")
      }`,
    );
  }
}

function mcpCommandExitCode(result: McpManagementResult): number {
  if (result.ok) return EXIT_CODES.success;
  if (result.reason === "invalid_config") return EXIT_CODES.config_error;
  if (result.reason === "timeout" || result.reason === "connection_failed" || result.reason === "probe_failed") {
    return EXIT_CODES.runtime_unavailable;
  }
  return EXIT_CODES.execution_error;
}

function resolveIndexFilePath(workingDirectory: string, configuredPath: string | undefined): string {
  return resolve(workingDirectory, configuredPath ?? join(".dev-agent", "index.json"));
}

function printIndexStatus(result: {
  readonly status: string;
  readonly usable: boolean;
  readonly fileCount: number;
  readonly symbolCount: number;
  readonly hasSignatures: boolean;
  readonly schemaVersion: number | null;
  readonly cacheHits: number | null;
  readonly cacheMisses: number | null;
  readonly cacheHitRate: number | null;
  readonly errorCount: number;
  readonly updatedAt: string | null;
}): void {
  console.log(`Index: ${result.status} (${result.usable ? "usable" : "not usable"})`);
  console.log(`Files: ${result.fileCount}; symbols: ${result.symbolCount}; signatures: ${result.hasSignatures ? "yes" : "no"}; schema: ${result.schemaVersion ?? "unknown"}`);
  const hitRate = result.cacheHitRate === null ? "n/a" : `${(result.cacheHitRate * 100).toFixed(1)}%`;
  console.log(`Cache: ${hitRate} (${result.cacheHits ?? "n/a"} hits / ${result.cacheMisses ?? "n/a"} misses); errors: ${result.errorCount}; updated: ${result.updatedAt ?? "n/a"}`);
}

function printIndexClear(result: { readonly status: string; readonly cleared: boolean }): void {
  console.log(result.cleared ? "Index cleared." : `Index clear: ${result.status}.`);
}

function printProviderCommandResult(result: { readonly command: string; readonly ok: boolean; readonly providers?: readonly unknown[]; readonly models?: readonly unknown[]; readonly provider?: string | null; readonly model?: string | null; readonly error?: { readonly reason: string; readonly message: string } | null }): void {
  if (result.error) {
    console.error(`${result.error.reason}: ${result.error.message}`);
    return;
  }
  if (result.command === "models current") {
    console.log(`${result.provider ?? "unknown"}/${result.model ?? "unknown"}`);
    return;
  }
  const count = result.providers?.length ?? result.models?.length ?? 0;
  console.log(`${result.command}: ${count} item${count === 1 ? "" : "s"}`);
}

function providerCommandExitCode(result: { readonly ok: boolean; readonly command: string; readonly error?: { readonly reason: string } | null; readonly providers?: readonly { readonly state?: string }[] }): number {
  if (!result.ok) {
    return result.error?.reason === "invalid_provider" ? EXIT_CODES.usage_error : EXIT_CODES.config_error;
  }
  if (result.command === "providers test" && result.providers?.some((provider) => provider.state !== "passed")) {
    return EXIT_CODES.runtime_unavailable;
  }
  return EXIT_CODES.success;
}

function renderTraceSummary(snapshot: AgentTraceSnapshot): string {
  const latest = snapshot.runs.at(-1);
  if (!latest) {
    return "[trace] no completed runs";
  }
  const modelSpans = latest.spans.filter((span) => span.kind === "model").length;
  const toolSpans = latest.spans.filter((span) => span.kind === "tool").length;
  const usage = latest.usage ?? {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  const duration = latest.durationMs === undefined ? "n/a" : formatTimingMs(latest.durationMs);
  const timings = summarizeRunTimings(latest);
  const diagnosis = diagnoseSlowStage(latest);
  const lines = [
    `[trace] run=${safeTerminalText(latest.runId)} status=${safeTerminalText(latest.status)} duration=${duration} turns=${latest.turns ?? 0} mode=${latest.speedMode ?? "unknown"}`,
    `spans=model:${modelSpans} tool:${toolSpans} tokens=prompt:${usage.promptTokens} completion:${usage.completionTokens} total:${usage.totalTokens}`,
    `[trace] timing queue=${formatTimingMs(timings.queueMs)} first-token=${formatTimingMs(timings.firstTokenMs)} model=${formatTimingMs(timings.modelMs)} tool=${formatTimingMs(timings.toolMs)} other=${formatTimingMs(timings.unaccountedMs)} total=${formatTimingMs(timings.totalMs)}`,
  ];
  if (timings.providerLoadMs !== undefined) {
    lines.push(
      `[trace] provider load=${formatTimingMs(timings.providerLoadMs)} prompt-eval=${formatTimingMs(timings.providerPromptEvalMs)} generation=${formatTimingMs(timings.providerGenerationMs)} server-total=${formatTimingMs(timings.providerServerMs)} app-overhead=${formatTimingMs(timings.providerOverheadMs)}`,
    );
  }
  if (diagnosis) {
    const span = diagnosis.longestSpan === undefined
      ? ""
      : `; longest ${diagnosis.longestSpan.kind}${diagnosis.longestSpan.name ? `:${safeTerminalText(diagnosis.longestSpan.name)}` : ""}${diagnosis.longestSpan.turn === undefined ? "" : ` turn=${diagnosis.longestSpan.turn}`}=${formatTimingMs(diagnosis.longestSpan.durationMs)}`;
    lines.push(`[trace] ${formatSlowStageDiagnosis(diagnosis)}${span}`);
  }
  if (latest.droppedSpans !== undefined || snapshot.droppedRuns > 0) {
    lines.push(
      `retained=runs:${snapshot.runs.length} spans:${latest.spans.length} droppedRuns:${snapshot.droppedRuns} droppedSpans:${latest.droppedSpans ?? 0}`,
    );
  }
  return lines.join("\n");
}

function safeTerminalText(value: unknown): string {
  return redactSensitiveText(sanitizeTerminalText(String(value)));
}

/** Keeps --json failures parseable without changing human-readable stderr. */
function emitCliError(message: string, jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify({ error: message }));
    return;
  }
  console.error(safeTerminalText(message));
}

function shouldEmitJsonErrorDocument(args: readonly string[]): boolean {
  return (
    args.includes("--json") &&
    !args.includes("--preview-evidence") &&
    !args.includes("--export-evidence")
  );
}

/** Trims trailing zeros so small estimates stay readable. */
function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  const fixed = value.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "" ? "0" : fixed;
}

interface StreamingCallbacks {
  onToken?: (token: string, context: AgentContext) => void;
  onToolCall?: (call: { name: string; input: unknown }, context: AgentContext) => void;
  onToolResult?: (result: { name: string; output: string }, context: AgentContext) => void;
}

interface PromptComposer {
  renderPendingPrompt(): void;
  hidePendingPrompt(): void;
  isPendingPromptVisible(): boolean;
}

interface RunTiming {
  readonly firstTokenMs?: number;
  readonly totalMs: number;
}

class StreamingRun {
  private readonly enabled: boolean;
  private readonly richUi: boolean;
  private readonly terminalWidth?: number;
  private readonly session: TuiSessionModel;
  private readonly liveAssistant?: LiveAssistantRenderer;
  private composer?: PromptComposer;
  private readonly activeToolIds = new Map<string, string[]>();
  private streamed = false;
  private thinkingVisible = false;
  private streamingStateVisible = false;
  private renderedCardId: string | undefined;
  private renderedCardLineCount = 0;
  private readonly collapsedCardIds = new Set<string>();
  private startedAt?: number;
  private firstTokenAt?: number;

  constructor(options: {
    enabled: boolean;
    richUi?: boolean;
    width?: number;
    session?: TuiSessionModel;
  }) {
    this.enabled = options.enabled;
    this.richUi = options.richUi === true;
    this.terminalWidth = options.width;
    this.session = options.session ?? new TuiSessionModel();
    this.liveAssistant = this.richUi
      ? new LiveAssistantRenderer((chunk) => this.writeRich(chunk), {
          width: options.width,
        })
      : undefined;
  }

  attachComposer(composer: PromptComposer | undefined): void {
    this.composer = composer;
  }

  withComposerHidden<T>(callback: () => T): T {
    const wasVisible = this.composer?.isPendingPromptVisible() === true;
    if (wasVisible) {
      this.composer?.hidePendingPrompt();
    }
    try {
      return callback();
    } finally {
      if (wasVisible) {
        this.composer?.renderPendingPrompt();
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isRichUi(): boolean {
    return this.richUi;
  }

  width(): number | undefined {
    return this.terminalWidth;
  }

  hasStreamed(): boolean {
    return this.streamed;
  }

  state(): TuiRunState {
    return this.session.snapshot().state;
  }

  begin(): void {
    this.streamed = false;
    this.startedAt = performance.now();
    this.firstTokenAt = undefined;
    this.streamingStateVisible = false;
    this.activeToolIds.clear();
    this.renderedCardId = undefined;
    this.renderedCardLineCount = 0;
    this.session.dispatch({ type: "turn-start" });
    if (this.richUi) {
      this.thinkingVisible = true;
      this.announceState("thinking");
      this.writeRich(`${colorize("Thinking…", "dim")}\n`);
      this.showComposer();
    }
  }

  finish(
    outcome: "ready" | "error" | "interrupted" = "ready",
    usage?: UsageSummary,
    errorMessage?: string
  ): RunTiming {
    this.clearThinking();
    this.commitLive();
    if (outcome === "error") {
      this.session.dispatch({
        type: "turn-error",
        message: errorMessage ?? "agent run failed",
      });
    } else if (outcome === "interrupted") {
      this.session.dispatch({ type: "turn-interrupted", reason: errorMessage ?? "interrupted" });
    } else {
      this.session.dispatch({ type: "turn-complete", usage });
    }
    if (this.richUi) {
      this.announceState(outcome === "error" ? "error" : outcome === "interrupted" ? "interrupted" : "ready");
    }
    const finishedAt = performance.now();
    const startedAt = this.startedAt ?? finishedAt;
    return {
      firstTokenMs:
        this.firstTokenAt === undefined
          ? undefined
          : Math.max(0, this.firstTokenAt - startedAt),
      totalMs: Math.max(0, finishedAt - startedAt),
    };
  }

  commitLive(): boolean {
    if (!this.liveAssistant?.isActive()) {
      return false;
    }
    this.liveAssistant.finish();
    return true;
  }

  /** Clean up transient rich-UI state when a run is cancelled by Ctrl-C. */
  cleanup(): void {
    this.clearThinking();
    this.commitLive();
    this.renderedCardId = undefined;
    this.renderedCardLineCount = 0;
  }

  approvalRequested(tool: string, detail: string, diff?: string): string {
    const id = this.session.dispatch({
      type: "approval-request",
      tool,
      detail,
      ...(diff === undefined ? {} : { diff }),
    });
    if (this.richUi) this.renderCard(id);
    return id;
  }

  approvalResolved(tool: string, decision: string, detail: string): void {
    const existing = [...this.session.snapshot().cards]
      .reverse()
      .find((card) => card.kind === "approval" && card.name === tool && card.status === "approval");
    const approvalId = existing?.id ?? this.approvalRequested(tool, detail);
    this.session.dispatch({
      type: "approval-resolved",
      decision,
      id: approvalId,
    });
    if (this.richUi) this.renderCard(approvalId);
  }

  showLatestCard(): void {
    const card = this.latestCard();
    if (!card) {
      this.writeRich("No tool cards recorded yet.\n");
      return;
    }
    this.renderCard(card.id, { append: true });
  }

  setLatestCardCollapsed(collapsed: boolean): void {
    const card = this.latestCard();
    if (!card) {
      this.writeRich("No tool cards recorded yet.\n");
      return;
    }
    if (collapsed) {
      this.collapsedCardIds.add(card.id);
    } else {
      this.collapsedCardIds.delete(card.id);
    }
    this.renderCard(card.id, { append: true });
  }

  validationResult(status: string, summary: string): void {
    const validationId = this.session.dispatch({
      type: "validation-start",
      detail: summary,
    });
    const normalized: "passed" | "failed" | "blocked" =
      status === "passed" || status === "failed" || status === "blocked"
        ? status
        : "failed";
    if (this.richUi) this.renderCard(validationId);
    this.session.dispatch({
      type: "validation-result",
      status: normalized,
      detail: summary,
      id: validationId,
    });
    if (this.richUi) this.renderCard(validationId);
  }

  toolProgress(name: string, detail: string): void {
    const ids = this.activeToolIds.get(name);
    const id = ids?.at(-1);
    if (id !== undefined) {
      this.session.dispatch({ type: "tool-progress", id, detail });
      if (this.richUi) this.renderCard(id);
    }
  }

  private clearThinking(): boolean {
    if (!this.thinkingVisible) {
      return false;
    }
    // Thinking is rendered on its own line. Move back to it, erase it, and
    // leave the cursor at column zero for the next stable block.
    this.writeRich("\u001b[1A\u001b[2K\r");
    this.thinkingVisible = false;
    return true;
  }

  callbacks(): StreamingCallbacks {
    if (!this.enabled) {
      return {};
    }
    return {
      onToken: (token) => {
        this.clearThinking();
        this.firstTokenAt ??= performance.now();
        this.streamed = true;
        this.session.dispatch({ type: "assistant-token", text: token });
        if (this.richUi && !this.streamingStateVisible) {
          this.announceState("streaming");
          this.streamingStateVisible = true;
        }
        if (this.liveAssistant) {
          this.liveAssistant.append(token);
        } else {
          process.stdout.write(safeTerminalText(token));
        }
      },
      onToolCall: (call) => {
        const preview = previewInput(call.name, call.input);
        const toolId = this.session.dispatch({
          type: "tool-start",
          name: call.name,
          ...(preview.trim() ? { input: preview.trim() } : {}),
        });
        const ids = this.activeToolIds.get(call.name) ?? [];
        ids.push(toolId);
        this.activeToolIds.set(call.name, ids);
        const clearedThinking = this.clearThinking();
        const committedLive = this.commitLive();
        const separator = clearedThinking || committedLive ? "" : "\n";
        const line = `[tool] ${safeTerminalText(call.name)}${preview}`;
        if (this.richUi) {
          if (separator) this.writeRich(separator);
          this.renderCard(toolId);
        } else {
          process.stdout.write(`${line}\n`);
        }
      },
      onToolResult: (result) => {
        const summary = summarizeOutput(result.output);
        const ids = this.activeToolIds.get(result.name);
        const toolId = ids?.shift();
        if (ids?.length === 0) {
          this.activeToolIds.delete(result.name);
        }
        if (toolId !== undefined) {
          this.session.dispatch({
            type: "tool-finish",
            id: toolId,
            output: summary,
          });
        }
        this.clearThinking();
        this.commitLive();
        const line = `[tool-result] ${safeTerminalText(result.name)}: ${summary}`;
        if (this.richUi && toolId !== undefined) {
          this.renderCard(toolId);
        } else if (!this.richUi) {
          process.stdout.write(`${line}\n`);
        }
      },
    };
  }

  private renderCard(id: string, options: { append?: boolean } = {}): void {
    const card = this.session.snapshot().cards.find((candidate) => candidate.id === id);
    if (!card) return;

    if (!options.append && this.renderedCardId === id && this.renderedCardLineCount > 0) {
      this.writeRich(clearRenderedBlock(this.renderedCardLineCount));
    }
    const rendered = renderToolCard(card, {
      width: this.terminalWidth,
      collapsed: this.collapsedCardIds.has(id),
    });
    this.writeRich(`${rendered}\n`);

    if (options.append) return;

    const stable = card.status !== "running" && card.status !== "approval" && card.status !== "validation";
    if (stable) {
      this.renderedCardId = undefined;
      this.renderedCardLineCount = 0;
    } else {
      this.renderedCardId = id;
      this.renderedCardLineCount = rendered.split("\n").length;
    }
  }

  private latestCard() {
    return this.session.snapshot().cards.at(-1);
  }

  private announceState(state: TuiRunState): void {
    if (!this.richUi) return;
    const label = state === "ready" ? "READY / idle" : state.toUpperCase().replaceAll("-", " ");
    const color = state === "ready" ? "dim" : state === "error" ? "red" : "green";
    this.writeRich(`${colorize(`STATUS / ${label}`, color)}\n`);
  }

  private showComposer(): void {
    if (!this.composer?.isPendingPromptVisible()) {
      this.composer?.renderPendingPrompt();
    }
  }

  private writeRich(chunk: string): void {
    this.withComposerHidden(() => {
      process.stdout.write(chunk);
    });
  }
}

function clearRenderedBlock(lineCount: number): string {
  if (lineCount <= 0) return "";
  const chunks = [`\u001b[${lineCount}A`];
  for (let index = 0; index < lineCount; index += 1) {
    chunks.push("\u001b[2K\r");
    if (index < lineCount - 1) chunks.push("\n");
  }
  if (lineCount > 1) chunks.push(`\u001b[${lineCount - 1}A`);
  return chunks.join("");
}

function previewInput(name: string, input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  try {
    const text = safeTerminalText(JSON.stringify(input));
    if (text.length <= 60) {
      return ` ${text}`;
    }
    return ` ${text.slice(0, 57)}...`;
  } catch {
    return "";
  }
}

function summarizeOutput(output: string): string {
  const safeOutput = safeTerminalText(output);
  if (safeOutput.length <= 80) {
    return safeOutput;
  }
  return `${safeOutput.slice(0, 77)}...`;
}

async function registerMcpTools(
  tools: AgentToolRegistry,
  sessions: McpServerSession[],
  runtime: { readonly sessionId: string; workingDirectory: string },
  config: CliConfig = {},
  onSupplementChange?: (supplement: string) => void
): Promise<string> {
  const servers = loadMcpServers(config);
  const metadataByPrefix = new Map<
    string,
    { readonly resources: readonly McpResourceLine[]; readonly prompts: readonly McpPromptLine[] }
  >();
  const prefixes = assignMcpPrefixes(servers.map((entry) => entry.name));
  const rebuildSupplement = (): string =>
    buildMcpSystemPromptSupplement(
      [...metadataByPrefix.values()].flatMap((metadata) => metadata.resources),
      [...metadataByPrefix.values()].flatMap((metadata) => metadata.prompts)
    );

  for (const config of servers.entries()) {
    const index = config[0];
    const serverConfig = config[1];
    // Tool names are keyed by `<prefix>:<name>` in a Map, so two servers
    // sharing a prefix silently erase each other's tools. Give each one a
    // deterministic unique prefix before anything is registered.
    const prefix = prefixes[index] ?? "mcp";
    const session = new McpServerSession({
      config: {
        ...serverConfig,
        name: prefix,
        rootDirectory: runtime.workingDirectory,
        env: {
          DEV_AGENT_SESSION_ID: runtime.sessionId,
          DEV_AGENT_WORKING_DIRECTORY: runtime.workingDirectory,
          ...(serverConfig.env ?? {}),
        },
      },
    });

    const snapshot = await session.connect();
    sessions.push(session);

    metadataByPrefix.set(prefix, registerServerTools(tools, session, prefix, snapshot));
    session.onChange((updated) => {
      unregisterServerTools(tools, prefix);
      metadataByPrefix.set(prefix, registerServerTools(tools, session, prefix, updated));
      onSupplementChange?.(rebuildSupplement());
    });
  }

  return rebuildSupplement();
}

type McpServerPromptMetadata = {
  readonly resources: McpResourceLine[];
  readonly prompts: McpPromptLine[];
};

function registerServerTools(
  tools: AgentToolRegistry,
  session: McpServerSession,
  prefix: string,
  snapshot: McpSessionSnapshot
): McpServerPromptMetadata {
  const metadata: McpServerPromptMetadata = { resources: [], prompts: [] };
  const client = sessionForClient(session);
  for (const tool of snapshot.tools) {
    tools.register({
      name: `${prefix}:${tool.name}`,
      description: tool.description,
      parameters: tool.parameters,
      metadata: {
        // MCP server actions are arbitrary remote behavior. Never downgrade
        // their risk based on annotations supplied by the server itself.
        risk: "dangerous",
        confirmation: "always",
        resultFormat: "text",
        supportsProgress: true,
      },
      async execute(input: unknown, context) {
        return tool.execute(input, {
          signal: context?.signal,
          onProgress: context?.onProgress,
        });
      },
    });
  }

  for (const resource of snapshot.resources) {
    metadata.resources.push({
      prefix,
      uri: resource.info.uri,
      name: resource.info.name,
      description: resource.info.description,
    });
  }
  tools.register({
    name: `${prefix}:resource`,
    description: `Read an MCP resource from server ${prefix} by URI.`,
    parameters: {
      type: "object",
      properties: { uri: { type: "string" } },
      required: ["uri"],
    },
    metadata: {
      risk: "read-only",
      confirmation: "never",
      resultFormat: "json",
      supportsProgress: false,
    },
    async execute(input: unknown) {
      const uri = readString(input, "uri");
      // Return every content block: a resource may answer with several, and
      // handing the model only the first would silently drop the rest.
      const contents = await client.readResourceContents(uri);
      return contents.length > 0 ? contents : [{ uri }];
    },
  });

  for (const prompt of snapshot.prompts) {
    metadata.prompts.push({
      prefix,
      name: prompt.info.name,
      description: prompt.info.description,
      argumentNames: prompt.info.arguments?.map((arg) => arg.name),
    });
  }
  tools.register({
    name: `${prefix}:prompt`,
    description: `Get an MCP prompt from server ${prefix} by name.`,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        arguments: { type: "object" },
      },
      required: ["name"],
    },
    metadata: {
      risk: "read-only",
      confirmation: "never",
      resultFormat: "json",
      supportsProgress: false,
    },
    async execute(input: unknown) {
      const name = readString(input, "name");
      const args = readArguments(input);
      return client.getPrompt(name, args);
    },
  });
  return metadata;
}

function unregisterServerTools(tools: AgentToolRegistry, prefix: string): void {
  const marker = `${prefix}:`;
  for (const tool of tools.list()) {
    if (tool.name.startsWith(marker)) {
      tools.unregister(tool.name);
    }
  }
}

function sessionForClient(session: McpServerSession): McpClient {
  return session.getClient();
}

function loadMcpServers(config: CliConfig = {}): McpClientConfig[] {
  const raw = process.env.DEV_AGENT_MCP_SERVERS;
  if (!raw) {
    // No environment override: fall back to servers saved in the config file.
    return normalizeMcpServers(config.mcpServers ?? []);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DEV_AGENT_MCP_SERVERS must be valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("DEV_AGENT_MCP_SERVERS must be a JSON array");
  }

  return normalizeMcpServers(parsed);
}

function normalizeMcpServers(entries: readonly unknown[]): McpClientConfig[] {
  return entries.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Each MCP server entry must be an object with a string command");
    }
    const config = entry as Record<string, unknown>;
    if (typeof config.command !== "string") {
      throw new Error("Each MCP server entry must be an object with a string command");
    }
    return {
      name: typeof config.name === "string" ? config.name : undefined,
      command: config.command,
      args: Array.isArray(config.args)
        ? (config.args as unknown[]).map((arg) => String(arg))
        : undefined,
      env: typeof config.env === "object" && config.env !== null
        ? (config.env as Record<string, string>)
        : undefined,
      timeoutMs: resolveMcpTimeoutMs(config.timeoutMs),
    };
  });
}

/**
 * Per-request MCP timeout: `DEV_AGENT_MCP_TIMEOUT_MS` wins over the config
 * entry, which wins over the client default. A server that never answers must
 * fail fast instead of hanging the CLI at startup.
 */
function resolveMcpTimeoutMs(fromConfig: unknown): number | undefined {
  const raw = process.env.DEV_AGENT_MCP_TIMEOUT_MS?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (typeof fromConfig === "number" && Number.isInteger(fromConfig) && fromConfig > 0) {
    return fromConfig;
  }
  return undefined;
}

/**
 * Deterministic, unique tool prefixes for the configured MCP servers.
 *
 * `tools.register()` is a `Map.set`, so two servers sharing a prefix silently
 * erase each other's tools. A single unnamed server keeps the historical `mcp`
 * prefix; several unnamed ones become `mcp-1`, `mcp-2`, ... in config order,
 * and an explicitly repeated name gets a numeric suffix on the later entries.
 */
export function assignMcpPrefixes(
  names: readonly (string | undefined)[]
): readonly string[] {
  const unnamed = names.filter((name) => name === undefined || name === "").length;
  const used = new Set<string>();
  const prefixes: string[] = [];

  names.forEach((name, index) => {
    const trimmed = name?.trim();
    let base: string;
    if (trimmed) {
      base = trimmed;
    } else {
      base = unnamed > 1 ? `mcp-${index + 1}` : "mcp";
    }

    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    prefixes.push(candidate);
  });

  return prefixes;
}

function resolveAgentLoopBudget(config: CliConfig, args: readonly string[]): AgentLoopBudget | undefined {
  const configured = config.budget ?? {};
  const read = (flag: string, fallback: number | undefined): number | undefined => {
    const index = args.indexOf(flag);
    if (index < 0) return fallback;
    const raw = args[index + 1];
    const value = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${flag} must be a non-negative integer`);
    }
    return value;
  };
  const budget: AgentLoopBudget = {
    maxTurns: read("--max-turns", configured.maxTurns),
    maxTokens: read("--max-tokens", configured.maxTokens ?? config.maxTokens),
    maxDurationMs: read("--max-duration-ms", configured.maxDurationMs ?? config.maxDurationMs),
    maxOutputChars: read("--max-output-chars", configured.maxOutputChars ?? config.maxOutputChars),
  };
  return Object.values(budget).some((value) => value !== undefined) ? budget : undefined;
}

function createProvider(
  config: CliConfig = {},
  selection: ModelSelectionResult,
  onSelectionChange?: (selection: ModelSelectionResult) => void,
  speedMode = new ModelSpeedModeController(),
): ModelProvider {
  const createConcreteProvider = (providerSelection: ModelSelection): ModelProvider =>
    new SpeedModeModelProvider(
      createConcreteModelProvider(config, providerSelection),
      speedMode,
    );

  if (!selection.metadata.fallback.enabled) {
    return createConcreteProvider(selection.selection);
  }

  return new FallbackModelProvider({
    config: config as unknown as { readonly [key: string]: unknown },
    initial: selection,
    createProvider: createConcreteProvider,
    onSelectionChange,
  });
}

function createConcreteModelProvider(config: CliConfig, selection: ModelSelection): ModelProvider {
  const providerId = selection.provider;
  const providerConfig = config.providers?.[providerId as keyof NonNullable<CliConfig["providers"]>];
  const model = selection.model ?? providerConfig?.model ?? resolveModel(config);
  const baseUrl = firstNonEmpty(
    process.env[`DEV_AGENT_${providerId.toUpperCase()}_BASE_URL`],
    process.env[`${providerId.toUpperCase()}_BASE_URL`],
    providerConfig?.baseUrl,
    config.baseUrls?.[providerId as keyof NonNullable<CliConfig["baseUrls"]>],
  );
  const apiKey = firstNonEmpty(
    process.env[`${providerId.toUpperCase()}_API_KEY`],
    process.env[`DEV_AGENT_${providerId.toUpperCase()}_API_KEY`],
    providerConfig?.apiKey,
    config.apiKeys?.[providerId as keyof NonNullable<CliConfig["apiKeys"]>],
  );

  if (providerId === "ollama") {
    return createOllamaProvider({
      model: model ?? "qwen3:4b-instruct",
      ...(baseUrl ? { baseUrl } : {}),
    });
  }

  if (providerId === "openai") {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for the openai provider");
    }
    return createOpenAIProvider({
      model: model ?? "gpt-4o-mini",
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }

  if (providerId === "anthropic") {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for the anthropic provider");
    }
    return createAnthropicProvider({
      model: model ?? "claude-sonnet-4-20250514",
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }

  if (providerId === "gemini") {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for the gemini provider");
    }
    return createGeminiProvider({
      model: model ?? "gemini-2.0-flash",
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }

  throw new Error(
    `Unsupported model provider '${providerId}'. Phase 1 supports ollama, openai, anthropic, and gemini.`
  );
}

function firstNonEmpty(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

function readString(input: unknown, key: string): string {
  const record = asRecord(input);
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`MCP tool input is missing required string field: ${key}`);
  }
  return value;
}

function readArguments(input: unknown): Record<string, string | number | boolean> | undefined {
  const record = asRecord(input);
  const value = record.arguments;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object") {
    throw new Error("MCP prompt arguments must be an object");
  }
  return value as Record<string, string | number | boolean>;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }
  const modulePath = fileURLToPath(import.meta.url);
  try {
    // npm exposes bins as symlinks on Unix. Compare canonical paths so the
    // installed `dev-agent` command starts the same way as `node dist/index.js`.
    return realpathSync(entrypoint) === realpathSync(modulePath);
  } catch {
    return resolve(entrypoint) === resolve(modulePath);
  }
}

export async function runCli(
  argv: string[],
  options: CliMainOptions = {}
): Promise<void> {
  try {
    await main(argv, options);
  } catch (error: unknown) {
    emitCliError(
      error instanceof Error ? error.message : String(error),
      shouldEmitJsonErrorDocument(argv.slice(2))
    );
    process.exitCode = 1;
  }
}

if (
  process.env.DEV_AGENT_NO_AUTO_MAIN !== "1" &&
  isMainModule()
) {
  void runCli(process.argv);
}
