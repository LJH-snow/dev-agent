import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");
const mcpFixture = fileURLToPath(
  new URL("../../../packages/mcp/tests/cancelable-mcp-server.mjs", import.meta.url)
);

async function startProvider(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  let requestCount = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requestCount += 1;
      const isFirst = requestCount === 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: isFirst
                ? {
                    content: "",
                    tool_calls: [
                      {
                        id: "progress-call",
                        type: "function",
                        function: {
                          name: "cancelable:progressive",
                          arguments: "{}",
                        },
                      },
                    ],
                  }
                : { content: "done" },
            },
          ],
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => {
      server.closeAllConnections?.();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function runCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end();
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function baseEnvironment(providerBaseUrl: string, dir: string): Promise<NodeJS.ProcessEnv> {
  return {
    ...process.env,
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: providerBaseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
    DEV_AGENT_MCP_SERVERS: JSON.stringify([
      { name: "cancelable", command: process.execPath, args: [mcpFixture] },
    ]),
  };
}

test("CLI prints MCP tool progress in human mode", async () => {
  const provider = await startProvider();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-cli-progress-"));
  try {
    const result = await runCli(
      ["--once", "run the progressive tool", "--no-stream"],
      await baseEnvironment(provider.baseUrl, dir)
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\[tool-progress\] cancelable:progressive 1\/3/);
    assert.match(result.stdout, /\[tool-progress\] cancelable:progressive 2\/3/);
    assert.match(result.stdout, /\[tool-progress\] cancelable:progressive 3\/3/);
    assert.match(result.stdout, /done/);
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI JSON mode suppresses progress lines and keeps one JSON result", async () => {
  const provider = await startProvider();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-cli-progress-json-"));
  try {
    const result = await runCli(
      ["--once", "run the progressive tool", "--json"],
      await baseEnvironment(provider.baseUrl, dir)
    );

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /tool-progress/);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "done");
    assert.equal(output.content, "done");
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Ctrl-C cancels an in-flight MCP tool and ignores its late result", async () => {
  const provider = await startProvider();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-cli-cancel-"));
  const marker = join(dir, "cancel.jsonl");
  const child = spawn("node", [cliPath, "--no-stream"], {
    env: {
      ...(await baseEnvironment(provider.baseUrl, dir)),
      MCP_CANCEL_MARKER: marker,
      MCP_RESPONSE_DELAY_MS: "400",
    },
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

  try {
    await waitForText(() => stdout, "Type 'exit' or 'quit' to stop.");
    child.stdin.write("run the progressive tool\n");
    await waitForText(() => stdout, "[tool-progress] cancelable:progressive 1/3");

    child.kill("SIGINT");
    const result = await waitForClose(child);
    const cancellation = await waitForTextFile(marker);

    assert.equal(result.code, 130, stderr);
    assert.match(stdout, /\(interrupted\)/);
    assert.doesNotMatch(stdout, /\[tool-result\] cancelable:progressive/);
    assert.match(cancellation, /"requestId":\d+/);
    assert.match(cancellation, /"reason":"request aborted"/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForClose(child).catch(() => undefined);
    }
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

async function waitForText(getText: () => string, expected: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getText().includes(expected)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`did not observe ${JSON.stringify(expected)} within ${timeoutMs}ms`);
}

async function waitForTextFile(path: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(path, "utf8");
      if (content.length > 0) {
        return content;
      }
    } catch {
      // The fixture creates the marker only after it receives cancellation.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`did not observe cancellation marker ${path} within ${timeoutMs}ms`);
}

async function waitForClose(
  child: ReturnType<typeof spawn>,
  timeoutMs = 5000
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`child did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}
