import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

/** OpenAI-compatible stub that records the request bodies it receives. */
async function startCapturingProvider() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "done" } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as any;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startToolCallingProvider(toolName, toolInput) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const hasToolResult = parsed.messages.some((message) => message.role === "tool");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: hasToolResult
                ? { content: "done" }
                : {
                    content: "",
                    tool_calls: [
                      {
                        id: "call_context_budget",
                        type: "function",
                        function: {
                          name: toolName,
                          arguments: JSON.stringify(toolInput),
                        },
                      },
                    ],
                  },
            },
          ],
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as any;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function seedSession(dir, entryCount) {
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    entries.push({
      id: `entry-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `entry-${index}-${"x".repeat(200)}`,
      createdAt: new Date().toISOString(),
    });
  }
  const memoryFile = join(dir, "session.json");
  await writeFile(memoryFile, `${JSON.stringify({ version: 1, entries })}\n`, "utf8");
  return memoryFile;
}

function runCli(args, env = process.env): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("CLI trims the history it sends when DEV_AGENT_MAX_CONTEXT_CHARS is set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-budget-"));
  const provider = await startCapturingProvider();
  try {
    const memoryFile = await seedSession(dir, 12);
    const result = await runCli(["--once", "hello", "--no-stream"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: provider.baseUrl,
      DEV_AGENT_MEMORY_FILE: memoryFile,
      DEV_AGENT_MAX_CONTEXT_CHARS: "400",
    });

    assert.equal(result.code, 0, result.stderr);
    const [request] = provider.requests;
    assert.ok(request, "the CLI should have called the provider");

    const contents = request.messages.map((message) => message.content);
    assert.ok(
      contents.some((content) => content.startsWith("[context]")),
      "a trimmed history should be announced"
    );
    assert.ok(
      !contents.some((content) => content.startsWith("entry-0-")),
      "the oldest entry should have been dropped"
    );
    assert.ok(
      contents.some((content) => content.startsWith("entry-11-")),
      "the newest entry should have been kept"
    );
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI system prompt requires source-grounded findings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-system-prompt-"));
  const provider = await startCapturingProvider();
  try {
    const result = await runCli(["--once", "review the project", "--no-stream"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: provider.baseUrl,
      DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
    });

    assert.equal(result.code, 0, result.stderr);
    const system = provider.requests[0]?.messages.find((message) => message.role === "system");
    assert.ok(system, "the provider should receive a system message");
    assert.match(system.content, /ground findings in actual tool output/i);
    assert.match(system.content, /README|AGENTS|roadmap/i);
    assert.match(system.content, /path:line|verify.*location/i);
    assert.match(system.content, /uncertain|cannot verify/i);
    assert.match(system.content, /read-only tool fails|retry/i);
    assert.match(system.content, /search when line numbers are missing/i);
    assert.match(system.content, /lineNumbers for source reads/i);
    assert.match(system.content, /requested paths and symbols/i);
    assert.match(system.content, /newest user request as authoritative/i);
    assert.match(system.content, /never invent paths/i);
    assert.match(system.content, /search returns no matches/i);
    assert.match(system.content, /one concrete evidence path/i);
    assert.match(system.content, /risk is verified/i);
    assert.match(system.content, /unsupported.*not evidence/i);
    assert.match(system.content, /lexical for Python/i);
    assert.match(system.content, /containing class and indentation/i);
    assert.match(system.content, /normal shared-type usage/i);
    assert.match(system.content, /undefined or unimported/i);
    assert.match(system.content, /do not repeat identical tool calls/i);
    assert.match(system.content, /definition-only.*not a defect/i);
    assert.match(system.content, /问题：未验证到可复现缺陷/);
    assert.match(system.content, /严重性：不适用/);
    assert.match(system.content, /问题.*严重性.*证据.*风险.*建议修复方向/s);
    assert.match(system.content, /do not turn a symbol description into a finding/i);
    assert.match(system.content, /addresses the current task/i);
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI sends the full history when no budget is configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-budget-"));
  const provider = await startCapturingProvider();
  try {
    const memoryFile = await seedSession(dir, 12);
    const result = await runCli(["--once", "hello", "--no-stream"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: provider.baseUrl,
      DEV_AGENT_MEMORY_FILE: memoryFile,
      DEV_AGENT_MAX_CONTEXT_CHARS: "100000",
    });

    assert.equal(result.code, 0, result.stderr);
    const [request] = provider.requests;
    const contents = request.messages.map((message) => message.content);
    assert.ok(!contents.some((content) => content.startsWith("[context]")));
    assert.ok(contents.some((content) => content.startsWith("entry-0-")));
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI bounds one-shot history by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-default-budget-"));
  const provider = await startCapturingProvider();
  try {
    const memoryFile = await seedSession(dir, 80);
    const result = await runCli(["--once", "hello", "--no-stream"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: provider.baseUrl,
      DEV_AGENT_MEMORY_FILE: memoryFile,
      DEV_AGENT_MAX_CONTEXT_CHARS: "",
    });

    assert.equal(result.code, 0, result.stderr);
    const [request] = provider.requests;
    const contents = request.messages.map((message) => message.content);
    assert.ok(contents.some((content) => content.startsWith("[context]")));
    assert.ok(!contents.some((content) => content.startsWith("entry-0-")));
    assert.ok(contents.some((content) => content.includes("entry-79-")));
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI bounds oversized tool results before the next model turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-tool-output-budget-"));
  const provider = await startToolCallingProvider("search", { query: "needle", path: "." });
  try {
    await writeFile(join(dir, "large.txt"), `needle ${"x".repeat(30000)}\n`, "utf8");
    const result = await runCli(["--cwd", dir, "--once", "find the evidence", "--no-stream"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: provider.baseUrl,
      DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
    });

    assert.equal(result.code, 0, result.stderr);
    const secondRequest = provider.requests[1];
    assert.ok(secondRequest, "the CLI should make a second request after the tool call");
    const toolMessage = secondRequest.messages.find((message) => message.role === "tool");
    assert.ok(toolMessage, "the second request should include the tool result");
    assert.match(toolMessage.content, /truncated/);
    assert.ok(
      toolMessage.content.length < 9000,
      `expected a bounded tool result, got ${toolMessage.content.length} characters`
    );
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI summarizes the trimmed history when summarization is enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-budget-"));
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const isSummaryCall =
        typeof parsed.messages?.[0]?.content === "string" &&
        parsed.messages[0].content.startsWith("Summarize the conversation excerpt");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: isSummaryCall ? "digest-text" : "done" } }],
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as any;

  try {
    const memoryFile = await seedSession(dir, 12);
    const result = await runCli(["--once", "hello", "--no-stream"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      DEV_AGENT_MEMORY_FILE: memoryFile,
      DEV_AGENT_MAX_CONTEXT_CHARS: "400",
      DEV_AGENT_SUMMARIZE_CONTEXT: "1",
    });

    assert.equal(result.code, 0, result.stderr);
    const conversation = requests.find(
      (request) =>
        !String(request.messages?.[0]?.content ?? "").startsWith("Summarize the conversation excerpt")
    );
    assert.ok(conversation, "the CLI should have run the conversation");

    const contents = conversation.messages.map((message) => message.content);
    assert.ok(
      contents.some((content) => content.startsWith("[summary]")),
      "the trimmed history should be replaced by a summary"
    );
    assert.ok(contents.some((content) => content.includes("digest-text")));
    assert.ok(
      !contents.some((content) => content.startsWith("[context]")),
      "the plain omission notice should not be used when summarization succeeds"
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
