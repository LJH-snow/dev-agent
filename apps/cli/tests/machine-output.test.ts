import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");
const modelText = "\u001b]0;terminal-owned\u0007Safe \u001b[31manswer\u001b[0m";

async function startStubProvider(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: modelText } }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  return {
    baseUrl,
    close: () => closeServer(server),
  };
}

async function startToolStreamingStubProvider(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  let requestCount = 0;
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      requestCount += 1;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const payload =
        requestCount === 1
          ? {
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
                          arguments: JSON.stringify({
                            command: "echo",
                            args: ["apiKey=secret-value"],
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : { choices: [{ delta: { content: "done" } }] };
      res.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timed out; stdout=${stdout}; stderr=${stderr}`));
    }, 10_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(input ?? "");
  });
}


function runInteractiveCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  prompt: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exitSent = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI timed out; stdout=" + stdout + "; stderr=" + stderr));
    }, 10_000);

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!exitSent && stdout.includes("[state=done turns=1]")) {
        exitSent = true;
        child.stdin.end("exit\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) =>
      finish(() => resolve({ code, stdout, stderr }))
    );
    child.stdin.write(prompt);
  });
}
function environment(baseUrl: string, memoryFile: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: baseUrl,
    DEV_AGENT_MEMORY_FILE: memoryFile,
  };
}

test("piped interactive output stays line-oriented and strips terminal controls", async () => {
  const provider = await startStubProvider();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-machine-output-"));

  try {
    const result = await runInteractiveCli(
      ["--no-stream"],
      environment(provider.baseUrl, join(dir, "session.json")),
      "say hi\n"
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /> /);
    assert.match(result.stdout, /Safe answer/);
    assert.match(result.stdout, /\[state=done turns=1\]/);
    assert.doesNotMatch(result.stdout, /\u001b/);
    assert.doesNotMatch(result.stdout, /terminal-owned/);
    assert.doesNotMatch(result.stdout, /Thinking…/);
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("--once human output does not expose rich TTY controls", async () => {
  const provider = await startStubProvider();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-machine-output-"));

  try {
    const result = await runCli(
      ["--once", "say hi", "--no-stream"],
      environment(provider.baseUrl, join(dir, "session.json"))
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Safe answer/);
    assert.match(result.stdout, /\[state=done turns=1\]/);
    assert.doesNotMatch(result.stdout, /Dev Agent/);
    assert.doesNotMatch(result.stdout, /Thinking…/);
    assert.doesNotMatch(result.stdout, /\u001b/);
    assert.doesNotMatch(result.stdout, /terminal-owned/);
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("human startup errors sanitize an untrusted provider id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-machine-output-"));

  try {
    const result = await runCli(
      ["--once", "say hi"],
      {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "unknown\u001b[31m",
        DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
      }
    );

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /\u001b/);
    assert.match(result.stderr, /Unsupported model provider 'unknown/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("human runtime status sanitizes an untrusted configured model name", async () => {
  const provider = await startStubProvider();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-machine-output-"));

  try {
    const result = await runCli(
      ["--once", "say hi", "--no-stream"],
      {
        ...environment(provider.baseUrl, join(dir, "session.json")),
        DEV_AGENT_MODEL: "model\u001b[31m-name",
      }
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /model=model-name/);
    assert.doesNotMatch(result.stdout, /\u001b/);
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("piped streaming tool output stays plain and redacts credentials", async () => {
  const provider = await startToolStreamingStubProvider();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-machine-output-"));

  try {
    const result = await runCli(
      ["--once", "run the command"],
      environment(provider.baseUrl, join(dir, "session.json"))
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\[tool\] shell/);
    assert.match(result.stdout, /\[tool-result\] shell/);
    assert.match(result.stdout, /\[redacted\]/);
    assert.match(result.stdout, /\[state=done turns=2\]/);
    assert.doesNotMatch(result.stdout, /secret-value/);
    assert.doesNotMatch(result.stdout, /\u001b/);
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("--once --json emits one parseable machine-readable document", async () => {
  const provider = await startStubProvider();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-machine-output-"));

  try {
    const result = await runCli(
      ["--once", "say hi", "--json"],
      environment(provider.baseUrl, join(dir, "session.json"))
    );

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "done");
    assert.equal(payload.content, modelText);
    assert.equal(result.stdout.trim().split("\n").length, 1);
    assert.doesNotMatch(result.stdout, /\u001b/);
    assert.doesNotMatch(result.stdout, /Dev Agent/);
    assert.doesNotMatch(result.stdout, /Thinking…/);
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});
