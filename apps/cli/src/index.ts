import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import {
  AgentLoop,
  AgentToolRegistry,
  compileApprovalConfig,
  normalizeApprovalKey,
  createAgentContext,
  denyDangerousPolicy,
  FileMemory,
  type AgentContext,
  type AgentMemory,
  type ApprovalPolicy,
  type ApprovalRequest,
  type CompiledApprovalConfig,
  type SessionMetadata,
} from "@dev-agent/agent-core";
import { createExecutor } from "@dev-agent/executor";
import {
  createMcpServer,
  McpServerSession,
  type McpClient,
  type McpClientConfig,
  type McpSessionSnapshot,
} from "@dev-agent/mcp";
import { colors, colorize } from "./colors.js";
import {
  loadConfig,
  parseApprovalMode,
  resolveApprovalMode,
  resolveMaxContextChars,
  resolveMaxTurns,
  resolveModel,
  resolveProviderId,
  resolveRustBinaryPath,
  resolveSummarizeContext,
  resolveSummaryMaxChars,
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
import { createDefaultTools } from "@dev-agent/tools";

const version = "0.1.0";
const defaultSystemPrompt =
  "You are dev-agent, a coding agent. Use tools when they help answer the user.";

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
  "--doctor": "none",
  "--mcp-server": "none",
  "--reset-memory": "none",
  "--no-stream": "none",
  "--json": "none",
  "--once": "one",
  "--session": "one",
  "--session-delete": "one",
  "--index": "one",
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

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const argError = validateCliArgs(args);
  if (argError) {
    console.error(argError);
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
    console.error("--once requires a prompt argument");
    process.exitCode = 1;
    return;
  }

  const sessionIndex = args.indexOf("--session");
  const sessionId = sessionIndex >= 0 ? args[sessionIndex + 1] : undefined;
  if (sessionIndex >= 0 && !sessionId) {
    console.error("--session requires a session id");
    process.exitCode = 1;
    return;
  }
  const resetMemory = args.includes("--reset-memory");
  const noStream = args.includes("--no-stream");
  const jsonOutput = args.includes("--json");
  const sessionDeleteIndex = args.indexOf("--session-delete");
  const sessionDeleteId = sessionDeleteIndex >= 0 ? args[sessionDeleteIndex + 1] : undefined;
  if (sessionDeleteIndex >= 0 && sessionDeleteId === undefined) {
    console.error("--session-delete requires a session id");
    process.exitCode = 1;
    return;
  }
  const renameIndex = args.indexOf("--session-rename");
  const renameFrom = renameIndex >= 0 ? args[renameIndex + 1] : undefined;
  const renameTo = renameIndex >= 0 ? args[renameIndex + 2] : undefined;
  if (renameIndex >= 0 && (renameFrom === undefined || renameTo === undefined)) {
    console.error("--session-rename requires both the current and the new session id");
    process.exitCode = 1;
    return;
  }
  const indexIndex = args.indexOf("--index");
  const indexPath = indexIndex >= 0 ? args[indexIndex + 1] : undefined;
  if (indexIndex >= 0 && indexPath === undefined) {
    console.error("--index requires a directory path");
    process.exitCode = 1;
    return;
  }
  const normalizedSessionId = normalizeSessionId(sessionId ?? "default");
  const workingDirectory = resolveWorkingDirectory();
  const rustIndex = args.indexOf("--rust-executor");
  const rustFlag = rustIndex >= 0 ? args[rustIndex + 1] : undefined;
  if (rustIndex >= 0 && !rustFlag) {
    console.error("--rust-executor requires a path to the dev-agent-executor binary");
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
    console.error("--approval requires one of: allow, deny-dangerous, ask");
    process.exitCode = 1;
    return;
  }
  const approvalFlagMode = approvalFlag === undefined ? undefined : parseApprovalMode(approvalFlag);
  if (approvalFlag !== undefined && approvalFlagMode === undefined) {
    console.error(`Unknown approval mode '${approvalFlag}'. Use allow, deny-dangerous, or ask.`);
    process.exitCode = 1;
    return;
  }

  if (args.includes("--mcp-server")) {
    // Expose the built-in tools over MCP instead of running the agent. No model
    // provider is needed, and stdout carries only JSON-RPC frames.
    const config = loadConfig();
    await runMcpServer({
      sessionId: normalizedSessionId,
      workingDirectory,
      rustBinaryPath,
      approvalMode: approvalFlagMode ?? resolveApprovalMode(config),
      approvalConfig: compileApprovalConfig(config.approval),
    });
    return;
  }

  if (args.includes("--doctor")) {
    const config = loadConfig();
    const report = await runDoctor({
      providerId: resolveProviderId(config),
      rustBinaryPath,
      sessionDir: sessionDir(),
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
      await rm(join(sessionDir(), `${id}.json`));
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
    const source = join(sessionDir(), `${from}.json`);
    const target = join(sessionDir(), `${to}.json`);

    if (from !== to && existsSync(target)) {
      console.error(`Session ${to} already exists.`);
      process.exitCode = 1;
      return;
    }

    let renamed = false;
    if (from !== to) {
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
        renamed ? `Renamed session ${from} to ${to}.` : `Session ${from} not found.`
      );
    }
    return;
  }

  if (indexPath !== undefined) {
    const report = await indexDirectory(resolve(workingDirectory, indexPath));
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
      console.log(`Index written to ${report.indexPath}`);
    }
    return;
  }

  const mcpSessions: McpServerSession[] = [];
  try {
    const config = loadConfig();
    const provider = createProvider(config);
    const approvalMode = approvalFlagMode ?? resolveApprovalMode(config);
    const questionBox: QuestionBox = {};
    const approval = buildApprovalPolicy(approvalMode, questionBox, config);
    const tools = new AgentToolRegistry();
    for (const tool of createDefaultTools(createExecutor({ rustBinaryPath }))) {
      tools.register(tool);
    }

    const mcpSupplement = await registerMcpTools(tools, mcpSessions, {
      sessionId: normalizedSessionId,
      workingDirectory,
    }, config);

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
        console.log(`${tool.name}: ${tool.description}`);
      }
      return;
    }

    if (args.includes("--metadata")) {
      const memory = createMemory(normalizedSessionId);
      const filePath = memoryFilePath(normalizedSessionId);
      const meta = await memory.getMetadata();
      if (!meta && (await isInvalidMemoryFile(filePath, memory))) {
        if (jsonOutput) {
          console.log(
            JSON.stringify({ error: "invalid memory file", path: filePath }, null, 2)
          );
        } else {
          console.error(
            `Invalid memory file: ${filePath}. Use --reset-memory or --session-delete ${normalizedSessionId} to recover.`
          );
        }
        process.exitCode = 1;
        return;
      }
      if (jsonOutput) {
        console.log(JSON.stringify(meta ?? null, null, 2));
        return;
      }
      if (meta) {
        console.log(`Session: ${meta.sessionId}`);
        console.log(`Created: ${meta.createdAt}`);
        console.log(`Last active: ${meta.lastActiveAt}`);
        console.log(`Entries: ${meta.entryCount}`);
        if (meta.usage) {
          console.log(
            `Usage: prompt=${meta.usage.promptTokens} completion=${meta.usage.completionTokens} total=${meta.usage.totalTokens}`
          );
        }
      } else {
        console.log("No session metadata found.");
      }
      return;
    }

    if (args.includes("--session-list")) {
      await listSessions(jsonOutput);
      return;
    }

    const compactIndex = args.indexOf("--compact");
    if (compactIndex >= 0) {
      const keepTurns = Number.parseInt(args[compactIndex + 1] ?? "5", 10);
      if (!Number.isInteger(keepTurns) || keepTurns < 1) {
        console.error("--compact requires a positive integer argument");
        process.exitCode = 1;
        return;
      }
      const memory = createMemory(normalizedSessionId);
      const removed = await memory.compact(keepTurns);
      if (jsonOutput) {
        console.log(JSON.stringify({ removed, keptTurns: keepTurns }, null, 2));
        return;
      }
      console.log(`Compacted session memory: removed ${removed} entries, keeping ${keepTurns} recent turns.`);
      return;
    }

    const memory = createMemory(normalizedSessionId);
    if (resetMemory) {
      await memory.clear();
    }
    const context = createAgentContext("cli", memory, {
      sessionId: normalizedSessionId,
      workingDirectory,
      metadata: { cliVersion: version, provider: provider.id },
    });
    // Token streaming would interleave with the JSON document.
    const streaming = new StreamingRun({ enabled: !noStream && !jsonOutput });
    const loop = new AgentLoop({
      model: provider,
      tools,
      systemPrompt: [defaultSystemPrompt, mcpSupplement]
        .filter((part) => part.length > 0)
        .join("\n\n"),
      maxTurns: resolveMaxTurns(config, 8),
      contextBudget: buildContextBudget(config),
      approval,
      onApproval: (request, outcome) => {
        // Nothing may interleave with the JSON document on stdout.
        if (!jsonOutput && outcome.decision === "deny") {
          process.stdout.write(
            `${colorize(`[denied] ${request.toolName} ${outcome.reason ?? ""}`.trimEnd(), "yellow")}\n`
          );
        }
      },
      onTurn: (turn) => {
        if (!jsonOutput) {
          process.stdout.write(`[turn ${turn}]\n`);
        }
      },
      ...streaming.callbacks(),
    });

    if (oncePrompt) {
      await runPrompt(loop, context, streaming, oncePrompt, jsonOutput, {
        model: provider.model,
        pricing: config.pricing,
      });
      return;
    }

    await interactive(loop, context, streaming, questionBox, jsonOutput, {
      model: provider.model,
      pricing: config.pricing,
    });
  } finally {
    await Promise.all(mcpSessions.map((session) => session.close()));
  }
}

function createMemory(sessionId = "default"): FileMemory {
  // Keep this consistent with sessionDir() so sessions written by the CLI are
  // the same ones --session-list and --compact operate on.
  return new FileMemory({ filePath: memoryFilePath(sessionId) });
}

function memoryFilePath(sessionId = "default"): string {
  return process.env.DEV_AGENT_MEMORY_FILE ?? join(sessionDir(), `${sessionId}.json`);
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
  readonly rustBinaryPath?: string;
  readonly approvalMode: ApprovalMode;
  readonly approvalConfig: CompiledApprovalConfig;
}): Promise<void> {
  const tools = createDefaultTools(createExecutor({ rustBinaryPath: options.rustBinaryPath }));
  const memory = createMemory(options.sessionId);
  // MCP has no interactive channel, so `ask` behaves like `deny-dangerous`:
  // a flagged call is refused with a reason the host model can act on.
  const policy =
    options.approvalMode === "allow"
      ? undefined
      : denyDangerousPolicy({
          patterns: [...options.approvalConfig.patterns],
          allowlist: [...options.approvalConfig.allowlist],
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
        return tool.execute(input, { sessionId, workingDirectory });
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

function buildApprovalPolicy(
  mode: ApprovalMode,
  questionBox: QuestionBox,
  config: CliConfig = {}
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
      const question = `${reason ?? "dangerous call"}\nRun ${request.toolName} anyway? [y/N/a] `;
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

function sessionDir(): string {
  return process.env.DEV_AGENT_SESSION_DIR ??
    join(homedir(), ".dev-agent", "sessions");
}

async function listSessions(jsonOutput = false): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(sessionDir());
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
  }> = [];
  for (const file of sessionFiles) {
    const filePath = join(sessionDir(), file);
    try {
      const info = await stat(filePath);
      const memory = new FileMemory({ filePath });
      const metadata = await memory.getMetadata();
      rows.push({ file, size: info.size, modified: info.mtime, usage: metadata?.usage });
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
        })),
        null,
        2
      )
    );
    return;
  }
  console.log(`Sessions (${rows.length}) in ${sessionDir()}:`);
  for (const row of rows) {
    const tokens = row.usage ? `  ${row.usage.totalTokens} tokens` : "";
    console.log(
      `  ${row.file.padEnd(32)} ${String(row.size).padStart(10)} bytes${tokens}  ${row.modified.toISOString()}`
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
    console.error(`Rust executor binary not found at ${path}`);
    process.exitCode = 1;
    return;
  }

  try {
    const healthCheck = await probeRustBinary(path);
    console.log(`Rust executor binary: ${path}`);
    console.log(`Runtime version: ${healthCheck.runtimeVersion}`);
    console.log(`Capabilities: ${healthCheck.capabilities.join(", ")}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
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

function resolveWorkingDirectory(): string {
  return process.env.INIT_CWD ??
    process.cwd();
}

async function interactive(
  loop: AgentLoop,
  context: AgentContext,
  streaming: StreamingRun,
  questionBox: QuestionBox,
  jsonOutput = false,
  cost?: UsageCostOptions
): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // Approval prompts reuse this interface instead of opening a second reader
  // on the same stdin.
  questionBox.ask = (prompt) => rl.question(prompt);

  console.log("dev-agent CLI. Type 'exit' or 'quit' to stop.");
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    process.stdout.write("\n(interrupted)\n");
  };
  process.on("SIGINT", onSigint);

  for (;;) {
    const line = await rl.question("> ");
    if (interrupted) {
      break;
    }
    const prompt = line.trim();
    if (prompt === "exit" || prompt === "quit") {
      break;
    }
    if (!prompt) {
      continue;
    }
    await runPrompt(loop, context, streaming, prompt, jsonOutput, cost);
  }

  process.removeListener("SIGINT", onSigint);
  rl.close();
}

interface UsageCostOptions {
  readonly model: string;
  readonly pricing?: PriceTable;
}

async function runPrompt(
  loop: AgentLoop,
  context: AgentContext,
  streaming: StreamingRun,
  prompt: string,
  jsonOutput = false,
  costOptions?: UsageCostOptions
): Promise<void> {
  const result = await loop.run(context, prompt);
  const entries = await result.memory.entries();
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
      })
    );
    return;
  }

  if (streaming.isEnabled() && streaming.hasStreamed()) {
    process.stdout.write("\n");
  } else {
    if (lastAssistant) {
      console.log(lastAssistant.content);
    }
  }
  console.log(`[state=${result.state.status} turns=${result.state.turns}]`);
  if (result.usage) {
    const suffix = cost === undefined ? "" : ` cost=$${formatCost(cost)}`;
    console.log(
      `[usage] prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens} total=${result.usage.totalTokens}${suffix}`
    );
  }
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

class StreamingRun {
  private readonly enabled: boolean;
  private streamed = false;

  constructor(options: { enabled: boolean }) {
    this.enabled = options.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  hasStreamed(): boolean {
    return this.streamed;
  }

  callbacks(): StreamingCallbacks {
    if (!this.enabled) {
      return {};
    }
    return {
      onToken: (token) => {
        this.streamed = true;
        process.stdout.write(token);
      },
      onToolCall: (call) => {
        const preview = previewInput(call.name, call.input);
        process.stdout.write(`\n${colorize(`[tool] ${call.name}${preview}`, "cyan")}\n`);
      },
      onToolResult: (result) => {
        const summary = summarizeOutput(result.output);
        process.stdout.write(`${colorize(`[tool-result] ${result.name}: ${summary}`, "dim")}\n`);
      },
    };
  }
}

function previewInput(name: string, input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  try {
    const text = JSON.stringify(input);
    if (text.length <= 60) {
      return ` ${text}`;
    }
    return ` ${text.slice(0, 57)}...`;
  } catch {
    return "";
  }
}

function summarizeOutput(output: string): string {
  if (output.length <= 80) {
    return output;
  }
  return `${output.slice(0, 77)}...`;
}

async function registerMcpTools(
  tools: AgentToolRegistry,
  sessions: McpServerSession[],
  runtime: { readonly sessionId: string; workingDirectory: string },
  config: CliConfig = {}
): Promise<string> {
  const servers = loadMcpServers(config);
  const resourceLines: McpResourceLine[] = [];
  const promptLines: McpPromptLine[] = [];

  for (const config of servers.entries()) {
    const index = config[0];
    const serverConfig = config[1];
    const session = new McpServerSession({
      config: {
        ...serverConfig,
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

    const prefix = session.prefix;
    registerServerTools(tools, session, prefix, snapshot, resourceLines, promptLines);
    session.onChange((updated) => {
      unregisterServerTools(tools, prefix);
      registerServerTools(tools, session, prefix, updated, resourceLines, promptLines);
    });
  }

  return buildMcpSystemPromptSupplement(resourceLines, promptLines);
}

function registerServerTools(
  tools: AgentToolRegistry,
  session: McpServerSession,
  prefix: string,
  snapshot: McpSessionSnapshot,
  resourceLines: McpResourceLine[],
  promptLines: McpPromptLine[]
): void {
  const client = sessionForClient(session);
  for (const tool of snapshot.tools) {
    tools.register({
      name: `${prefix}:${tool.name}`,
      description: tool.description,
      parameters: tool.parameters,
      async execute(input: unknown) {
        return tool.execute(input);
      },
    });
  }

  for (const resource of snapshot.resources) {
    resourceLines.push({
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
      return client.readResource(uri);
    },
  });

  for (const prompt of snapshot.prompts) {
    promptLines.push({
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
    };
  });
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

main(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
