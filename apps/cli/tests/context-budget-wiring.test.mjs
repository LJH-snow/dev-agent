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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
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

function runCli(args, env) {
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
      DEV_AGENT_MAX_CONTEXT_CHARS: "",
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
