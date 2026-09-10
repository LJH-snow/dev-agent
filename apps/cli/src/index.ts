import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  FileMemory,
  type AgentContext,
  type AgentMemory,
  type SessionMetadata,
} from "@dev-agent/agent-core";
import { createExecutor } from "@dev-agent/executor";
import { McpServerSession, type McpClient, type McpClientConfig, type McpSessionSnapshot } from "@dev-agent/mcp";
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
  const normalizedSessionId = normalizeSessionId(sessionId ?? "default");
  const workingDirectory = resolveWorkingDirectory();
  const rustIndex = args.indexOf("--rust-executor");
  const rustBinaryPath = rustIndex >= 0 ? args[rustIndex + 1] : undefined;
  const rustCheckIndex = args.indexOf("--check-rust");
  const rustCheckPath = rustCheckIndex >= 0 ? args[rustCheckIndex + 1] : undefined;
  if (rustIndex >= 0 && !rustBinaryPath) {
    console.error("--rust-executor requires a path to the dev-agent-executor binary");
    process.exitCode = 1;
    return;
  }
  if (args.includes("--check-rust")) {
    await checkRust(rustBinaryPath ?? rustCheckPath);
    return;
  }

  const mcpSessions: McpServerSession[] = [];
  try {
    const provider = createProvider();
    const tools = new AgentToolRegistry();
    for (const tool of createDefaultTools(createExecutor({ rustBinaryPath }))) {
      tools.register(tool);
    }

    const mcpSupplement = await registerMcpTools(tools, mcpSessions, {
      sessionId: normalizedSessionId,
      workingDirectory,
    });

    if (args.includes("--tools")) {
      for (const tool of tools.list()) {
        console.log(`${tool.name}: ${tool.description}`);
      }
      return;
    }

    if (args.includes("--metadata")) {
      const memory = createMemory(normalizedSessionId);
      const meta = await memory.getMetadata();
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
    const loop = new AgentLoop({
      model: provider,
      tools,
      systemPrompt: [defaultSystemPrompt, mcpSupplement]
        .filter((part) => part.length > 0)
        .join("\n\n"),
      maxTurns: 8,
      onTurn: (turn) => {
        process.stdout.write(`[turn ${turn}]\n`);
      },
    });

    if (oncePrompt) {
      await runPrompt(loop, context, oncePrompt);
      return;
    }

    await interactive(loop, context);
  } finally {
    await Promise.all(mcpSessions.map((session) => session.close()));
  }
}

function createMemory(sessionId = "default"): FileMemory {
  const filePath =
    process.env.DEV_AGENT_MEMORY_FILE ??
    join(homedir(), ".dev-agent", "sessions", `${sessionId}.json`);
  return new FileMemory({ filePath });
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

async function interactive(loop: AgentLoop, context: AgentContext): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

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
    await runPrompt(loop, context, prompt);
  }

  process.removeListener("SIGINT", onSigint);
  rl.close();
}

async function runPrompt(loop: AgentLoop, context: AgentContext, prompt: string): Promise<void> {
  const result = await loop.run(context, prompt);
  const entries = await result.memory.entries();
  const lastAssistant = [...entries].reverse().find((entry) => entry.role === "assistant");
  if (lastAssistant) {
    console.log(lastAssistant.content);
  }
  console.log(`[state=${result.state.status} turns=${result.state.turns}]`);
}

async function registerMcpTools(
  tools: AgentToolRegistry,
  sessions: McpServerSession[],
  runtime: { readonly sessionId: string; workingDirectory: string }
): Promise<string> {
  const servers = loadMcpServers();
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

function loadMcpServers(): McpClientConfig[] {
  const raw = process.env.DEV_AGENT_MCP_SERVERS;
  if (!raw) {
    return [];
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

  return parsed.map((entry) => {
    if (typeof entry !== "object" || entry === null || typeof entry.command !== "string") {
      throw new Error(
        "Each DEV_AGENT_MCP_SERVERS entry must be an object with a string command"
      );
    }
    const config = entry as Record<string, unknown>;
    return {
      name: typeof config.name === "string" ? config.name : undefined,
      command: config.command as string,
      args: Array.isArray(config.args)
        ? (config.args as unknown[]).map((arg) => String(arg))
        : undefined,
      env: typeof config.env === "object" && config.env !== null
        ? (config.env as Record<string, string>)
        : undefined,
    };
  });
}

function createProvider(): ModelProvider {
  const providerId = process.env.DEV_AGENT_MODEL_PROVIDER ?? "ollama";
  const model = process.env.DEV_AGENT_MODEL;

  if (providerId === "ollama") {
    return createOllamaProvider({
      model: model ?? "qwen3:4b-instruct",
      baseUrl: process.env.OLLAMA_BASE_URL,
    });
  }

  if (providerId === "openai") {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.DEV_AGENT_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when DEV_AGENT_MODEL_PROVIDER=openai");
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
      throw new Error("ANTHROPIC_API_KEY is required when DEV_AGENT_MODEL_PROVIDER=anthropic");
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
      throw new Error("GEMINI_API_KEY is required when DEV_AGENT_MODEL_PROVIDER=gemini");
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

main(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
