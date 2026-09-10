import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

const toolCallChunk = {
  choices: [
    {
      delta: {
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: {
              name: "shell",
              arguments: JSON.stringify({ command: "echo", args: ["hi"] }),
            },
          },
        ],
      },
    },
  ],
};

const finalChunk = { choices: [{ delta: { content: "done" } }] };

function sse(payloads) {
  return (
    payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

/** Minimal OpenAI-compatible streaming endpoint: tool call first, then an answer. */
async function startStubProvider() {
  let calls = 0;
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      calls += 1;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse(calls === 1 ? [toolCallChunk] : [finalChunk]));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
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
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function withCli(baseUrl, extraEnv, run) {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-wiring-"));
  try {
    return await run({
      ...process.env,
      NO_COLOR: "1",
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: baseUrl,
      DEV_AGENT_MEMORY_FILE: join(dir, "memory.json"),
      ...extraEnv,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("DEV_AGENT_RUST_BINARY is used for real tool runs, not only --check-rust", async () => {
  const stub = await startStubProvider();
  try {
    const result = await withCli(stub.baseUrl, {
      DEV_AGENT_RUST_BINARY: "/nonexistent/dev-agent-executor",
    }, (env) => runCli(["--once", "run echo"], env));

    // The shell tool must have gone through RustExecutor and reported the path,
    // which only happens if the environment variable reached createExecutor().
    assert.match(
      `${result.stdout}${result.stderr}`,
      /Rust executor binary not found at \/nonexistent\/dev-agent-executor/
    );
  } finally {
    await stub.close();
  }
});

test("without DEV_AGENT_RUST_BINARY the shell tool runs through LocalExecutor", async () => {
  const stub = await startStubProvider();
  try {
    const result = await withCli(stub.baseUrl, {}, (env) => runCli(["--once", "run echo"], env));

    assert.equal(result.code, 0);
    assert.match(result.stdout, /\[tool-result\] shell: \{"stdout":"hi/);
    assert.match(result.stdout, /\[state=done/);
  } finally {
    await stub.close();
  }
});
