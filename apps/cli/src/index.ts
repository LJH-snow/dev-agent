#!/usr/bin/env node

import { createRequire } from "node:module";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentLoop,
  AgentToolRegistry,
  compileApprovalConfig,
  normalizeApprovalKey,
  createAgentContext,
  createBlockedValidationResult,
  createEvidenceAuditExport,
  createEvidenceAuditPreview,
  EVIDENCE_AUDIT_LIMIT_ERROR_CODE,
  EvidenceAuditLimitError,
  validateEvidenceAuditLimits,
  selectEvidenceForAudit,
  createValidationAttemptId,
  denyDangerousPolicy,
  reviewWritesPolicy,
  FileMemory,
  runValidationAttempt,
  type AgentContext,
  type AgentMemory,
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
} from "@dev-agent/agent-core";
import { assertWorkingDirectory, createExecutor } from "@dev-agent/executor";
import {
  createMcpServer,
  McpServerSession,
  type McpClient,
  type McpClientConfig,
  type McpSessionSnapshot,
} from "@dev-agent/mcp";
import { colors, colorize } from "./colors.js";
import { richPromptPrefix, shouldUseRichUi } from "./tui-mode.js";
import { LiveAssistantRenderer } from "./tui-stream.js";
import {
  DEFAULT_COMMAND_HINTS,
  redactSensitiveText,
  renderAssistantMessage,
  renderCommandHints,
  renderRuntimeStatus,
  renderWelcome,
  sanitizeTerminalText,
} from "./tui-renderer.js";
import {
  loadConfig,
  parseApprovalMode,
  resolveConfigPath,
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
import { indexDirectory } from "./index-command.js";
import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
  estimateCost,
  type ChatUsage,
  type ModelProvider,
  type PriceTable,
} from "@dev-agent/model";
import {
  createDefaultTools,
  createValidationRunner,
  deriveValidationPlan,
  FilesystemTool,
  type ValidationPolicy,
} from "@dev-agent/tools";

const packageMetadata = createRequire(import.meta.url)("../package.json") as { version?: string };
const version = packageMetadata.version ?? "0.0.0";
const defaultSystemPrompt =
  "You are dev-agent, a coding agent. Use tools when they help answer the user.";

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
  "--mcp-server",
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
  "--mcp-server": "none",
  "--reset-memory": "none",
  "--no-stream": "none",
  "--json": "none",
  "--once": "one",
  "--session": "one",
  "--session-delete": "one",
  "--index": "one",
  "--exclude": "one",
  "--cwd": "one",
  "--config": "one",
  "--project-state": "none",
  "--rust-executor": "one",
  "--approval": "one",
  "--session-rename": "two",
  "--compact": "optional",
  "--check-rust": "optional",
};

/**
 * Rejects arguments the flag table does not account for, plus values that look
 * like another flag. Returns a message to print, or undefined when the command
 * line is well formed.
 */
export function validateCliArgs(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("-")) {
      return `Unexpected argument '${arg}'.`;
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

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
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
  const previewCombinationError = validatePreviewCliCombination(args, previewEvidence);
  if (previewCombinationError) {
    emitCliError(previewCombinationError, jsonErrorOutput);
    process.exitCode = 1;
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
  const resetMemory = args.includes("--reset-memory");
  const noStream = args.includes("--no-stream");
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
  const configIndex = args.indexOf("--config");
  const configFlag = configIndex >= 0 ? args[configIndex + 1] : undefined;
  if (configIndex >= 0 && !configFlag?.trim()) {
    emitCliError("--config requires a file path", jsonErrorOutput);
    process.exitCode = 1;
    return;
  }
  const projectState = args.includes("--project-state");
  const normalizedSessionId = normalizeSessionId(sessionId ?? "default");
  const workingDirectory = resolveWorkingDirectory(cwdFlag);
  assertWorkingDirectory(workingDirectory);
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
  // An explicit flag wins; otherwise DEV_AGENT_RUST_BINARY applies to real runs
  // too, not just --check-rust.
  const rustBinaryPath = resolveRustBinaryPath(rustFlag ?? rustCheckFlag);
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
      console.log(`Index written to ${safeTerminalText(report.indexPath)}`);
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

  const mcpSessions: McpServerSession[] = [];
  try {
    const config = loadConfig(configPath, process.env, workingDirectory, projectState);
    const approvalMode = approvalFlagMode ?? resolveApprovalMode(config);
    const questionBox: QuestionBox = {};
    const executor = createExecutor({ rustBinaryPath });
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

    if (args.includes("--tools")) {
      if (jsonOutput) {
        console.log(
          JSON.stringify(
            tools.list().map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
            null,
            2
          )
        );
        return;
      }
      for (const tool of tools.list()) {
        console.log(
          `${safeTerminalText(tool.name)}: ${safeTerminalText(tool.description)}`
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
    const provider = createProvider(config);
    const streamingEnabled =
      !noStream && !jsonOutput && typeof provider.streamChat === "function";
    const richUi = shouldUseRichUi({
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
      once: oncePrompt !== undefined,
      json: jsonOutput,
      mcpServer: args.includes("--mcp-server"),
    });
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
    const context = createAgentContext("cli", memory, {
      sessionId: normalizedSessionId,
      workingDirectory,
      metadata: { cliVersion: version, provider: provider.id },
    });
    if (filesystem instanceof FilesystemTool) {
      await restorePersistedChangeSets(filesystem, context);
    }
    const rerunValidation =
      filesystem instanceof FilesystemTool
        ? (changeSetId: string, signal?: AbortSignal) =>
            runExplicitValidation(filesystem, validation, context, changeSetId, signal)
        : undefined;
    // Token streaming would interleave with the JSON document.
    const streaming = new StreamingRun({
      enabled: streamingEnabled,
      richUi,
      width: resolveTerminalWidth(),
    });
    const reviews: ReviewRecord[] = [];
    const validations: ValidationResult[] = [];
    const loop = new AgentLoop({
      model: provider,
      tools,
      systemPromptProvider: () =>
        [defaultSystemPrompt, mcpSupplement]
          .filter((part) => part.length > 0)
          .join("\n\n"),
      maxTurns: resolveMaxTurns(config, 8),
      contextBudget: buildContextBudget(config),
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
        // Nothing may interleave with the JSON document on stdout.
        if (!jsonOutput && outcome.decision === "deny") {
          const line = `[denied] ${safeTerminalText(request.toolName)} ${safeTerminalText(
            outcome.reason ?? ""
          )}`.trimEnd();
          process.stdout.write(`${richUi ? colorize(line, "yellow") : line}\n`);
        }
      },
      onValidation: (result) => {
        validations.push(result);
        if (!jsonOutput) {
          printValidationResult(result);
        }
      },
      validation,
      onTurn: (turn) => {
        if (!jsonOutput) {
          if (richUi) {
            streaming.commitLive();
            process.stdout.write(`\n${colorize(`Turn ${turn}`, "dim")}\n`);
          } else {
            if (streaming.isEnabled() && streaming.hasStreamed()) {
              process.stdout.write("\n");
            }
            process.stdout.write(`[turn ${turn}]\n`);
          }
        }
      },
      onToolProgress: (progress) => {
        if (!jsonOutput) {
          const total = progress.total === undefined ? "" : `/${progress.total}`;
          process.stdout.write(
            `[tool-progress] ${safeTerminalText(progress.name)} ${progress.progress}${total}\n`
          );
        }
      },
      ...streaming.callbacks(),
    });

    if (oncePrompt) {
      const result = await runPrompt(loop, context, streaming, oncePrompt, jsonOutput, {
        model: provider.model,
        pricing: config.pricing,
      }, reviews, validations);
      if (result.state.status === "error") {
        process.exitCode = 1;
      }
      return;
    }

    await interactive(loop, context, streaming, questionBox, {
      rich: richUi,
      provider: provider.id,
      model: provider.model,
      streaming: streamingEnabled,
      sessionId: normalizedSessionId,
      workingDirectory,
      width: resolveTerminalWidth(),
    }, jsonOutput, {
      model: provider.model,
      pricing: config.pricing,
    }, reviews, validations, rerunValidation);
  } finally {
    await Promise.all(mcpSessions.map((session) => session.close()));
  }
}

function createMemory(
  sessionId = "default",
  baseDirectory = process.cwd(),
  projectState = false
): FileMemory {
  // Keep this consistent with sessionDir() so sessions written by the CLI are
  // the same ones --session-list and --compact operate on.
  return new FileMemory({ filePath: memoryFilePath(sessionId, baseDirectory, projectState) });
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
  const tools = createDefaultTools(createExecutor({ rustBinaryPath: options.rustBinaryPath }));
  const filesystem = tools.find(
    (tool): tool is FilesystemTool => tool instanceof FilesystemTool
  );
  const memory = createMemory(options.sessionId, options.workingDirectory, options.projectState);
  const policy = (() => {
    if (options.approvalMode === "allow") {
      return undefined;
    }

    const policyOptions = {
      patterns: [...options.approvalConfig.patterns],
      allowlist: [...options.approvalConfig.allowlist],
    };

    if (options.approvalMode === "review-writes") {
      // MCP has no interactive channel. The review-writes policy therefore
      // prepares the same change set as the local agent, but denies the
      // mutation because no reviewer can approve it over stdio.
      return reviewWritesPolicy({
        prepare: filesystem
          ? (request) =>
              filesystem.prepareChangeSet(request.input, {
                sessionId: request.sessionId,
                workingDirectory: request.workingDirectory,
              })
          : async () => {
              throw new Error("filesystem tool is unavailable for write review");
            },
        patterns: policyOptions.patterns,
        allowlist: policyOptions.allowlist,
      });
    }

    // MCP has no interactive channel, so `ask` behaves like
    // `deny-dangerous`: a flagged call is refused with a reason the host model
    // can act on.
    return denyDangerousPolicy(policyOptions);
  })();
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
        return tool.execute(input, { sessionId, workingDirectory, signal: context?.signal });
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
        uri: "dev-agent://workspace",
        name: "Workspace",
        description: "Top-level entries of the working directory.",
        mimeType: "text/plain",
        async read() {
          const entries = await readdir(options.workingDirectory, { withFileTypes: true });
          const lines = entries
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`);
          return [`working directory: ${options.workingDirectory}`, ...lines].join("\n");
        },
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
  await server.start();
}

function buildContextBudget(
  config: CliConfig
): { maxChars?: number; summarize?: boolean; summaryMaxChars?: number } | undefined {
  const maxChars = resolveMaxContextChars(config);
  const summarize = resolveSummarizeContext(config);
  const summaryMaxChars = resolveSummaryMaxChars(config);
  if (maxChars === undefined && !summarize) {
    return undefined;
  }
  return { maxChars, summarize, summaryMaxChars };
}

/** Filled in by the interactive loop so approval prompts share its reader. */
interface QuestionBox {
  ask?: (prompt: string) => Promise<string>;
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
  if (mode === "allow") {
    // No policy means no per-call overhead, exactly as before.
    return undefined;
  }

  const { patterns, allowlist } = compileApprovalConfig(config.approval);
  const policyOptions = { patterns: [...patterns], allowlist: [...allowlist] };

  if (mode === "deny-dangerous") {
    return denyDangerousPolicy(policyOptions);
  }

  if (mode === "review-writes") {
    const sessionAllowed = new Set<string>();
    const requestApproval = (request: ApprovalRequest, reason?: string) =>
      requestReviewedCall(request, reason, questionBox, sessionAllowed);
    if (!filesystem) {
      return reviewWritesPolicy({
        prepare: async () => {
          throw new Error("filesystem tool is unavailable for write review");
        },
        patterns: policyOptions.patterns,
        allowlist: policyOptions.allowlist,
        requestApproval,
      });
    }
    return reviewWritesPolicy({
      prepare: (request) =>
        filesystem.prepareChangeSet(request.input, {
          sessionId: request.sessionId,
          workingDirectory: request.workingDirectory,
        }),
      patterns: policyOptions.patterns,
      allowlist: policyOptions.allowlist,
      requestApproval,
    });
  }

  const dangerous = denyDangerousPolicy(policyOptions);
  const sessionAllowed = new Set<string>();
  return {
    async decide(request) {
      const key = normalizeApprovalKey(request);
      if (key && sessionAllowed.has(key)) {
        return { decision: "allow" };
      }

      const outcome = await dangerous.decide(request);
      const decision = typeof outcome === "string" ? outcome : outcome.decision;
      if (decision === "allow") {
        return { decision: "allow" };
      }

      const reason = typeof outcome === "string" ? undefined : outcome.reason;
      const question = `${safeTerminalText(reason ?? "dangerous call")}\nRun ${safeTerminalText(
        request.toolName
      )} anyway? [y/N/a] `;
      const answer = questionBox.ask
        ? await questionBox.ask(question)
        : await readLineFromStdin(question);
      const normalized = answer.trim().toLowerCase();

      if (normalized.startsWith("a") && key) {
        // Remembered for this process only; never written to disk.
        sessionAllowed.add(key);
        return { decision: "allow" };
      }

      return normalized.startsWith("y")
        ? { decision: "allow" }
        : { decision: "deny", reason: `${reason ?? "dangerous call"} (declined)` };
    },
  };
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
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
    };
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        cleanup();
        resolve(buffer.slice(0, newline));
      }
    };
    const onEnd = (): void => {
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
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      console.log(jsonOutput ? "[]" : "No sessions found.");
      return;
    }
    throw error;
  }

  const sessionFiles = entries.filter((name) => name.endsWith(".json"));
  if (sessionFiles.length === 0) {
    console.log(jsonOutput ? "[]" : "No sessions found.");
    return;
  }

  const rows: Array<{
    file: string;
    size: number;
    modified: Date;
    usage?: ChatUsage;
    evidenceSummary?: EvidenceSummary;
  }> = [];
  for (const file of sessionFiles) {
    const filePath = join(directory, file);
    try {
      const info = await stat(filePath);
      const memory = new FileMemory({ filePath });
      const metadata = await memory.getMetadata();
      const evidenceSummary = await memory.evidenceSummary();
      rows.push({
        file,
        size: info.size,
        modified: info.mtime,
        usage: metadata?.usage,
        evidenceSummary,
      });
    } catch {
      rows.push({ file, size: 0, modified: new Date(0) });
    }
  }

  rows.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  if (jsonOutput) {
    console.log(
      JSON.stringify(
        rows.map((row) => ({
          file: row.file,
          size: row.size,
          modifiedAt: row.modified.toISOString(),
          usage: row.usage ?? null,
          evidenceSummary: row.evidenceSummary ?? null,
        })),
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

interface InteractiveUiOptions {
  readonly rich: boolean;
  readonly provider: string;
  readonly model: string;
  readonly streaming: boolean;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly width: number;
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
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // Approval prompts reuse this interface instead of opening a second reader
  // on the same stdin.
  questionBox.ask = (prompt) => rl.question(prompt);

  let interrupted = false;
  let abort: AbortController | undefined;
  // Closing the readline interface does not settle a pending `question()` --
  // the event loop simply drains and the process exits with code 0. Race the
  // question against this instead, so the loop always unwinds.
  let wakeOnInterrupt: (() => void) | undefined;
  const interrupt = new Promise<void>((resolve) => {
    wakeOnInterrupt = resolve;
  });
  const onSigint = () => {
    interrupted = true;
    if (ui.rich) {
      streaming.cleanup();
    }
    process.stdout.write("\n(interrupted)\n");
    // Cancel whatever is in flight. Without this Ctrl-C only printed a line
    // and the running request kept going.
    abort?.abort();
    rl.close();
    // 130 is the conventional exit code for "terminated by SIGINT".
    process.exitCode = 130;
    wakeOnInterrupt?.();
  };
  process.on("SIGINT", onSigint);

  const printHeader = (): void => {
    if (!ui.rich) {
      // Publish readiness only after the handler is installed. stdout is piped
      // in callers, so the banner can be observed before a later listener
      // setup.
      console.log(
        "dev-agent CLI. Type 'exit' or 'quit' to stop. Use ':validate <changeSetId>' to rerun trusted checks or ':cleanup [--remove-rolled-back] [--max-validations N] [--max-change-sets N]'."
      );
      return;
    }

    console.log(
      renderWelcome({
        provider: ui.provider,
        model: ui.model,
        streaming: ui.streaming,
        sessionId: ui.sessionId,
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
  try {
    for (;;) {
      const line = await Promise.race([
        rl.question(ui.rich ? richPromptPrefix() : "> ").catch(() => ""),
        interrupt.then(() => ""),
      ]);
      if (interrupted) {
        break;
      }
      const prompt = line.trim();
      if (prompt === ":quit" || prompt === "exit" || prompt === "quit") {
        break;
      }
      if (!prompt) {
        continue;
      }

      if (prompt === ":help") {
        if (ui.rich) {
          console.log(renderCommandHints(DEFAULT_COMMAND_HINTS, { width: ui.width }));
        } else {
          console.log(
            "Commands: :help, :clear, :model, :validate <changeSetId>, :cleanup ..., exit, quit"
          );
        }
        continue;
      }

      if (prompt === ":clear") {
        if (ui.rich) {
          process.stdout.write("\u001b[2J\u001b[H");
          printHeader();
        } else {
          console.log("Clear is available only in an interactive terminal.");
        }
        continue;
      }

      if (prompt === ":model") {
        if (ui.rich) {
          console.log(
            renderRuntimeStatus({
              provider: ui.provider,
              model: ui.model,
              streaming: ui.streaming,
              width: ui.width,
            })
          );
        } else {
          console.log(
            `[runtime] provider=${safeTerminalText(ui.provider)} model=${safeTerminalText(ui.model)} streaming=${
              ui.streaming ? "enabled" : "disabled"
            }`
          );
        }
        continue;
      }

      if (prompt === ":cleanup" || prompt.startsWith(":cleanup ")) {
        const cleanupArgs = prompt.slice(":cleanup".length).trim();
        const parsedCleanup = parseCliEvidenceCleanupOptions(
          ["--cleanup-evidence", ...(cleanupArgs ? cleanupArgs.split(/\s+/) : [])],
          true
        );
        if ("error" in parsedCleanup) {
          console.error(safeTerminalText(parsedCleanup.error));
          continue;
        }
        if (!context.memory.pruneEvidence) {
          console.error("Evidence cleanup is unavailable for this memory.");
          continue;
        }
        try {
          const result = await context.memory.pruneEvidence(parsedCleanup.options);
          const evidenceSummary = await context.memory.evidenceSummary?.();
          printEvidenceCleanupResult(
            context.sessionId,
            result,
            evidenceSummary,
            jsonOutput
          );
        } catch (error) {
          if (!interrupted) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(safeTerminalText(`Evidence cleanup failed: ${message}`));
          }
        }
        continue;
      }

      if (prompt === ":validate" || prompt.startsWith(":validate ")) {
        const changeSetId = prompt.slice(":validate".length).trim();
        if (!changeSetId) {
          console.error("Usage: :validate <changeSetId>");
          continue;
        }
        if (!rerunValidation) {
          console.error("Validation rerun is unavailable because the filesystem tool is unavailable.");
          continue;
        }
        const controller = new AbortController();
        abort = controller;
        try {
          const validation = await rerunValidation(changeSetId, controller.signal);
          validations.push(validation);
          if (jsonOutput) {
            const changeSets = (await context.memory.changeSets?.()) ?? [];
            const evidenceSummary = await context.memory.evidenceSummary?.();
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
          } else {
            printValidationResult(validation);
          }
        } catch (error) {
          if (!interrupted) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(safeTerminalText(`Validation rerun failed: ${message}`));
          }
        } finally {
          abort = undefined;
        }
        if (interrupted) {
          break;
        }
        continue;
      }

      const controller = new AbortController();
      abort = controller;
      try {
        current = await runPrompt(
          loop,
          current,
          streaming,
          prompt,
          jsonOutput,
          cost,
          reviews,
          validations,
          controller.signal
        );
      } catch (error) {
        // An interrupt is not a failure; the session keeps its prior state.
        if (!interrupted) {
          throw error;
        }
      } finally {
        abort = undefined;
      }
      if (interrupted) {
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
  }
}

interface UsageCostOptions {
  readonly model: string;
  readonly pricing?: PriceTable;
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

function printValidationResult(result: ValidationResult): void {
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
  signal?: AbortSignal
): Promise<AgentContext> {
  streaming.begin();
  const result = await loop.run(context, prompt, signal ? { signal } : undefined).catch((error) => {
    // Keep a rich live block from leaking into the next prompt when a request
    // is aborted or fails before the normal result rendering path.
    streaming.finish();
    throw error;
  });
  const timing = streaming.finish();
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
  const cost =
    result.usage && costOptions
      ? estimateCost(result.usage, costOptions.model, costOptions.pricing)
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
  console.log(
    `[timing] first-token=${formatTimingMs(timing.firstTokenMs)} total=${formatTimingMs(
      timing.totalMs
    )}`
  );
  return result;
}

function formatTimingMs(value: number | undefined): string {
  return value === undefined ? "n/a" : `${Math.max(0, Math.round(value))}ms`;
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

interface RunTiming {
  readonly firstTokenMs?: number;
  readonly totalMs: number;
}

class StreamingRun {
  private readonly enabled: boolean;
  private readonly richUi: boolean;
  private readonly terminalWidth?: number;
  private readonly liveAssistant?: LiveAssistantRenderer;
  private streamed = false;
  private thinkingVisible = false;
  private startedAt?: number;
  private firstTokenAt?: number;

  constructor(options: { enabled: boolean; richUi?: boolean; width?: number }) {
    this.enabled = options.enabled;
    this.richUi = options.richUi === true;
    this.terminalWidth = options.width;
    this.liveAssistant = this.richUi
      ? new LiveAssistantRenderer((chunk) => process.stdout.write(chunk), {
          width: options.width,
        })
      : undefined;
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

  begin(): void {
    this.streamed = false;
    this.startedAt = performance.now();
    this.firstTokenAt = undefined;
    if (this.richUi) {
      this.thinkingVisible = true;
      process.stdout.write(`${colorize("Thinking…", "dim")}\n`);
    }
  }

  finish(): RunTiming {
    this.clearThinking();
    this.commitLive();
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
  }

  private clearThinking(): boolean {
    if (!this.thinkingVisible) {
      return false;
    }
    // Thinking is rendered on its own line. Move back to it, erase it, and
    // leave the cursor at column zero for the next stable block.
    process.stdout.write("\u001b[1A\u001b[2K\r");
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
        if (this.liveAssistant) {
          this.liveAssistant.append(token);
        } else {
          process.stdout.write(safeTerminalText(token));
        }
      },
      onToolCall: (call) => {
        const preview = previewInput(call.name, call.input);
        const clearedThinking = this.clearThinking();
        const committedLive = this.commitLive();
        const separator = clearedThinking || committedLive ? "" : "\n";
        const line = `[tool] ${safeTerminalText(call.name)}${preview}`;
        process.stdout.write(
          `${separator}${this.richUi ? colorize(line, "cyan") : line}\n`
        );
      },
      onToolResult: (result) => {
        const summary = summarizeOutput(result.output);
        this.clearThinking();
        this.commitLive();
        const line = `[tool-result] ${safeTerminalText(result.name)}: ${summary}`;
        process.stdout.write(
          `${this.richUi ? colorize(line, "dim") : line}\n`
        );
      },
    };
  }
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

function createProvider(config: CliConfig = {}): ModelProvider {
  const providerId = resolveProviderId(config);
  const model = resolveModel(config);

  if (providerId === "ollama") {
    return createOllamaProvider({
      model: model ?? "qwen3:4b-instruct",
      baseUrl: process.env.OLLAMA_BASE_URL,
    });
  }

  if (providerId === "openai") {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.DEV_AGENT_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for the openai provider");
    }
    return createOpenAIProvider({
      model: model ?? "gpt-4o-mini",
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL,
    });
  }

  if (providerId === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.DEV_AGENT_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for the anthropic provider");
    }
    return createAnthropicProvider({
      model: model ?? "claude-sonnet-4-20250514",
      apiKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    });
  }

  if (providerId === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.DEV_AGENT_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for the gemini provider");
    }
    return createGeminiProvider({
      model: model ?? "gemini-2.0-flash",
      apiKey,
      baseUrl: process.env.GEMINI_BASE_URL,
    });
  }

  throw new Error(
    `Unsupported model provider '${providerId}'. Phase 1 supports ollama, openai, anthropic, and gemini.`
  );
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

if (isMainModule()) {
  main(process.argv).catch((error: unknown) => {
    emitCliError(
      error instanceof Error ? error.message : String(error),
      shouldEmitJsonErrorDocument(process.argv.slice(2))
    );
    process.exitCode = 1;
  });
}
