import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return `http://127.0.0.1:${(server.address() as any).port}/v1`;
}

function closeServer(server: Server): Promise<void> {
  // A stub that never answers would otherwise keep the socket open.
  server.closeAllConnections?.();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Answers every request with the same content and usage. */
async function startStubProvider(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );
    });
  });
  const baseUrl = await listen(server);
  return { baseUrl, close: () => closeServer(server) };
}

/** Accepts the request and never answers, so a run stays in flight. */
async function startHangingProvider(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req) => {
    req.on("data", () => {});
    req.on("end", () => {
      // Intentionally no response; the socket is dropped on closeServer().
    });
  });
  const baseUrl = await listen(server);
  return { baseUrl, close: () => closeServer(server) };
}

interface InteractiveOptions {
  readonly provider: string;
  readonly memoryFile: string;
  readonly openAiBaseUrl?: string;
}

function launch({ provider, memoryFile, openAiBaseUrl }: InteractiveOptions): ChildProcess {
  return spawn("node", [cliPath, "--no-stream"], {
    env: {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: provider,
      ...(openAiBaseUrl
        ? { OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: openAiBaseUrl }
        : {}),
      DEV_AGENT_MEMORY_FILE: memoryFile,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Waits for exit, killing the child if it does not stop in time. */
async function waitForExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<{ code: number | null; signal: NodeJS.Signals | null; elapsed: number }> {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`the CLI did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, elapsed: Date.now() - started });
    });
  });
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-interactive-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition was not met before the timeout");
}

test("interactive prompts accumulate turns and usage", async () => {
  const provider = await startStubProvider();
  await withTempDir(async (dir) => {
    const child = launch({
      provider: "openai",
      openAiBaseUrl: provider.baseUrl,
      memoryFile: join(dir, "session.json"),
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    try {
      for (const prompt of ["first", "second", "third"]) {
        child.stdin?.write(`${prompt}\n`);
        // Wait for the run to print its state line before queueing the next.
        await waitFor(() => stdout.includes(`turns=${prompt === "first" ? 1 : prompt === "second" ? 2 : 3}`), 4000);
      }
      child.stdin?.write("exit\n");
      const result = await waitForExit(child, 5000);
      assert.equal(result.code, 0, stdout);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }

    // The session continues from the previous run instead of restarting.
    assert.match(stdout, /\[state=done turns=1\]/);
    assert.match(stdout, /\[state=done turns=2\]/);
    assert.match(stdout, /\[state=done turns=3\]/);
    assert.match(stdout, /\[usage\] prompt=30 completion=15 total=45/, "usage must accumulate");
  });
  await provider.close();
});

test("Ctrl-C aborts a run that is in flight", async () => {
  const provider = await startHangingProvider();
  await withTempDir(async (dir) => {
    const child = launch({
      provider: "openai",
      openAiBaseUrl: provider.baseUrl,
      memoryFile: join(dir, "session.json"),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      child.stdin?.write("hello\n");
      await new Promise((resolve) => setTimeout(resolve, 600));

      const started = Date.now();
      child.kill("SIGINT");
      const result = await waitForExit(child, 3000);

      assert.equal(result.code, 130, "SIGINT exits with the conventional code");
      assert.ok(Date.now() - started < 2000, "the run must not wait for the model");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  });
  await provider.close();
});

test("Ctrl-C exits the CLI while it is idle at the prompt", async () => {
  await withTempDir(async (dir) => {
    const child = launch({ provider: "ollama", memoryFile: join(dir, "session.json") });
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      child.kill("SIGINT");
      const result = await waitForExit(child, 3000);

      assert.equal(result.code, 130);
      assert.ok(result.elapsed < 2000, "an idle prompt must not hang");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  });
});
