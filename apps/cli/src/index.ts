import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { readdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  denyDangerousPolicy,
  FileMemory,
  type AgentContext,
  type AgentMemory,
  type ApprovalPolicy,
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
import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
  type ModelProvider,
} from "@dev-agent/model";
import { createDefaultTools } from "@dev-agent/tools";

const version = "0.1.0";
const defaultSystemPrompt =
  "You are dev-agent, a coding agent. Use tools when they help answer the user.";

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
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
    await runMcpServer({
      sessionId: normalizedSessionId,
      workingDirectory,
      rustBinaryPath,
    });
    return;
  }

  const mcpSessions: McpServerSession[] = [];
  try {
    const config = loadConfig();
    const provider = createProvider(config);
    const approvalMode = approvalFlagMode ?? resolveApprovalMode(config);
    const questionBox: QuestionBox = {};
    const approval = buildApprovalPolicy(approvalMode, questionBox);
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
      const meta = await memory.getMetadata();
      if (jsonOutput) {
        console.log(JSON.stringify(meta ?? null, null, 2));
        return;
      }
      if (meta) {
        console.log(`Session: ${meta.sessionId}`);
        console.log(`Created: ${meta.createdAt}`);
        console.log(`Last active: ${meta.lastActiveAt}`);
        console.log(`Entries: ${meta.entryCount}`);
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
      await runPrompt(loop, context, streaming, oncePrompt, jsonOutput);
      return;
    }

    await interactive(loop, context, streaming, questionBox, jsonOutput);
  } finally {
    await Promise.all(mcpSessions.map((session) => session.close()));
  }
}

function createMemory(sessionId = "default"): FileMemory {
  // Keep this consistent with sessionDir() so sessions written by the CLI are
  // the same ones --session-list and --compact operate on.
  const filePath =
    process.env.DEV_AGENT_MEMORY_FILE ?? join(sessionDir(), `${sessionId}.json`);
  return new FileMemory({ filePath });
}

async function runMcpServer(options: {
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly rustBinaryPath?: string;
}): Promise<void> {
  const tools = createDefaultTools(createExecutor({ rustBinaryPath: options.rustBinaryPath }));
  const memory = createMemory(options.sessionId);
  const server = createMcpServer({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: (input: unknown, context) =>
        tool.execute(input, {
          sessionId: context?.sessionId ?? options.sessionId,
          workingDirectory: context?.workingDirectory ?? options.workingDirectory,
        }),
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
  questionBox: QuestionBox
): ApprovalPolicy | undefined {
  if (mode === "allow") {
    // No policy means no per-call overhead, exactly as before.
    return undefined;
  }
  if (mode === "deny-dangerous") {
    return denyDangerousPolicy();
  }

  const dangerous = denyDangerousPolicy();
  return {
    async decide(request) {
      const outcome = await dangerous.decide(request);
      const decision = typeof outcome === "string" ? outcome : outcome.decision;
      if (decision === "allow") {
        return { decision: "allow" };
      }

      const reason = typeof outcome === "string" ? undefined : outcome.reason;
      const question = `${reason ?? "dangerous call"}\nRun ${request.toolName} anyway? [y/N] `;
      const answer = questionBox.ask
        ? await questionBox.ask(question)
        : await readLineFromStdin(question);

      return answer.trim().toLowerCase().startsWith("y")
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

  const rows: Array<{ file: string; size: number; modified: Date }> = [];
  for (const file of sessionFiles) {
    const filePath = join(sessionDir(), file);
    try {
      const info = await stat(filePath);
      rows.push({ file, size: info.size, modified: info.mtime });
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
        })),
        null,
        2
      )
    );
    return;
  }
  console.log(`Sessions (${rows.length}) in ${sessionDir()}:`);
  for (const row of rows) {
    console.log(`  ${row.file.padEnd(32)} ${String(row.size).padStart(10)} bytes  ${row.modified.toISOString()}`);
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

  const { spawn } = await import("node:child_process");
  const result = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(path, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout = Buffer.concat([stdout, chunk]); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Rust executor exited with code ${code}: ${stderr}`));
      }
    });
    // Send a HealthCheck envelope (request_id=1, health_check=4).
    const envelope = [0x08, 0x01, 0x22, 0x00];
    const frame = Buffer.alloc(4 + envelope.length);
    frame.writeUInt32BE(envelope.length, 0);
    Buffer.from(envelope).copy(frame, 4);
    child.stdin.write(frame);
    child.stdin.end();
  });

  if (result.length < 4) {
    console.error("Rust executor returned no response");
    process.exitCode = 1;
    return;
  }

  const len = result.readUInt32BE(0);
  const payload = result.subarray(4, 4 + len);
  const healthCheck = decodeHealthCheckResponse(payload);
  if (!healthCheck) {
    console.error("Rust executor returned an unexpected response");
    process.exitCode = 1;
    return;
  }
  console.log(`Rust executor binary: ${path}`);
  console.log(`Runtime version: ${healthCheck.runtimeVersion}`);
  console.log(`Capabilities: ${healthCheck.capabilities.join(", ")}`);
}

interface DecodedHealthCheck {
  readonly runtimeVersion: string;
  readonly capabilities: string[];
}

function readProtobufVarint(buffer: Buffer, offset: number): { readonly value: number; readonly offset: number } {
  let value = 0;
  let shift = 0;
  while (offset < buffer.length) {
    const byte = buffer.readUInt8(offset);
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, offset };
    }
    shift += 7;
  }
  throw new Error("malformed protobuf varint");
}

function decodeLengthDelimited(buffer: Buffer, offset: number): { readonly data: Buffer; readonly offset: number } {
  const length = readProtobufVarint(buffer, offset);
  const end = length.offset + length.value;
  if (end > buffer.length) {
    throw new Error("malformed protobuf length-delimited field");
  }
  return {
    data: buffer.subarray(length.offset, end),
    offset: end,
  };
}

function decodeHealthCheckResult(data: Buffer): DecodedHealthCheck {
  let offset = 0;
  let version = "";
  const capabilities: string[] = [];
  while (offset < data.length) {
    const tag = readProtobufVarint(data, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wireType = tag.value & 0x07;
    if (wireType !== 2) {
      offset = readProtobufVarint(data, offset).offset;
      continue;
    }
    const fieldData = decodeLengthDelimited(data, offset);
    offset = fieldData.offset;
    if (field === 1) {
      version = fieldData.data.toString("utf8");
    } else if (field === 2) {
      capabilities.push(fieldData.data.toString("utf8"));
    }
  }
  return { runtimeVersion: version, capabilities };
}

function decodeErrorResult(data: Buffer): string {
  let offset = 0;
  let message = "";
  let code = "";
  while (offset < data.length) {
    const tag = readProtobufVarint(data, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wireType = tag.value & 0x07;
    if (wireType !== 2) {
      offset = readProtobufVarint(data, offset).offset;
      continue;
    }
    const fieldData = decodeLengthDelimited(data, offset);
    offset = fieldData.offset;
    if (field === 1) {
      message = fieldData.data.toString("utf8");
    } else if (field === 2) {
      code = fieldData.data.toString("utf8");
    }
  }
  return `${code}: ${message}`;
}

function decodeHealthCheckResponse(payload: Buffer): DecodedHealthCheck | undefined {
  let offset = 0;
  let healthCheckData: Buffer | undefined;
  while (offset < payload.length) {
    const tag = readProtobufVarint(payload, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wireType = tag.value & 0x07;
    if (wireType === 0) {
      offset = readProtobufVarint(payload, offset).offset;
      continue;
    }
    if (wireType !== 2) {
      return undefined;
    }
    const fieldData = decodeLengthDelimited(payload, offset);
    offset = fieldData.offset;
    if (field === 3) {
      healthCheckData = fieldData.data;
    } else if (field === 4) {
      throw new Error(`Rust executor returned an error: ${decodeErrorResult(fieldData.data)}`);
    }
  }
  return healthCheckData ? decodeHealthCheckResult(healthCheckData) : undefined;
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
  jsonOutput = false
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
    await runPrompt(loop, context, streaming, prompt, jsonOutput);
  }

  process.removeListener("SIGINT", onSigint);
  rl.close();
}

async function runPrompt(
  loop: AgentLoop,
  context: AgentContext,
  streaming: StreamingRun,
  prompt: string,
  jsonOutput = false
): Promise<void> {
  const result = await loop.run(context, prompt);
  const entries = await result.memory.entries();
  const lastAssistant = [...entries].reverse().find((entry) => entry.role === "assistant");

  if (jsonOutput) {
    console.log(
      JSON.stringify({
        sessionId: result.sessionId,
        status: result.state.status,
        turns: result.state.turns,
        content: lastAssistant?.content ?? "",
        usage: result.usage ?? null,
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
    console.log(
      `[usage] prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens} total=${result.usage.totalTokens}`
    );
  }
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
