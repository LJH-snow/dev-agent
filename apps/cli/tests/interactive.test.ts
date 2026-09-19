import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");
const expectAvailable = (() => {
  try {
    execFileSync("expect", ["-c", "exit 0"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

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
async function startStreamingStubProvider(options: {
  readonly chunks?: readonly string[];
  readonly firstTokenDelayMs?: number;
} = {}): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const chunks = options.chunks ?? ["answer"];
  const firstTokenDelayMs = options.firstTokenDelayMs ?? 250;
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      let index = 0;
      const writeNext = (): void => {
        const chunk = chunks[index];
        if (chunk === undefined) {
          res.write(
            `data: ${JSON.stringify({
              choices: [],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            })}\n\n`
          );
          res.end("data: [DONE]\n\n");
          return;
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
        index += 1;
        setTimeout(writeNext, 10);
      };
      setTimeout(writeNext, firstTokenDelayMs);
    });
  });
  const baseUrl = await listen(server);
  return { baseUrl, close: () => closeServer(server) };
}

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

function launchRich({ provider, memoryFile, openAiBaseUrl }: InteractiveOptions): ChildProcess {
  // Expect drives the complete scenario inside a real controlling pty. Avoid
  // `interact` here: when expect itself has piped stdin, interact is not a
  // reliable way to forward input to the spawned pty.
  const expectScript = `
    log_user 1
    spawn {${process.execPath}} {${cliPath}}
    expect "SIGNAL WEAVE"
    send "unique-user-prompt\\r"
    expect "Thinking…"
    expect -exact {[state=done turns=1]}
    send "exit\\r"
    expect eof
  `;
  return spawn("expect", ["-c", expectScript], {
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

function launchRichCtrlC({ provider, memoryFile, openAiBaseUrl }: InteractiveOptions): ChildProcess {
  // Drive the signal from inside expect while the CLI is attached to its pty.
  // Sending SIGINT to the expect wrapper itself can terminate the wrapper
  // before its pty flushes the ANSI cleanup sequence.
  const expectScript = `
    log_user 1
    spawn {${process.execPath}} {${cliPath}}
    expect "SIGNAL WEAVE"
    send "interrupt-me\\r"
    expect "Thinking…"
    set childPid [exec pgrep -P [pid] -f {dist/index.js}]
    exec kill -INT $childPid
    expect "(interrupted)"
    expect eof
  `;
  return spawn("expect", ["-c", expectScript], {
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

/**
 * Resolves once the CLI has printed its banner. The banner and the `SIGINT`
 * handler are installed in the same synchronous block, so seeing the banner
 * proves the handler is in place — a fixed sleep is a race under load, and
 * signalling earlier kills the process with a signal instead of exit code 130.
 */
async function waitForReady(child: ChildProcess, output: () => string): Promise<void> {
  await waitFor(() => output().includes("Type 'exit' or 'quit' to stop."), 5000);
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error("the CLI exited before it was ready");
  }
}

/** Waits for exit, killing the child if it does not stop in time. */
async function waitForExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<{ code: number | null; signal: NodeJS.Signals | null; elapsed: number }> {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({
        code: child.exitCode,
        signal: child.signalCode,
        elapsed: Date.now() - started,
      });
      return;
    }
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
      await waitForReady(child, () => stdout);
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
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    try {
      await waitForReady(child, () => stdout);
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
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    try {
      await waitForReady(child, () => stdout);
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

test("interactive CLI exits cleanly when stdin reaches EOF", async () => {
  await withTempDir(async (dir) => {
    const child = launch({ provider: "ollama", memoryFile: join(dir, "session.json") });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    try {
      await waitForReady(child, () => stdout);
      child.stdin?.end();
      const result = await waitForExit(child, 1500);

      assert.equal(result.code, 0, stdout);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  });
});


test(
  "rich TTY does not duplicate the echoed user input and clears Thinking before streaming",
  { skip: !expectAvailable ? "expect is unavailable" : false },
  async () => {
  const provider = await startStreamingStubProvider();
  await withTempDir(async (dir) => {
    const child = launchRich({
      provider: "openai",
      openAiBaseUrl: provider.baseUrl,
      memoryFile: join(dir, "session.json"),
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    try {
      await waitFor(() => stdout.includes("READY"), 5000);
      await waitFor(() => stdout.includes("\u001b[1A\u001b[2K\r"), 5000);
      await waitFor(() => stdout.includes("Thinking…"), 2000);
      await waitFor(() => stdout.includes("[state=done turns=1]"), 5000);
      const result = await waitForExit(child, 5000);
      assert.equal(result.code, 0, stdout);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }

    assert.equal(
      stdout.split("unique-user-prompt").length - 1,
      1,
      "readline echo should be the only user-prompt rendering"
    );
    assert.match(stdout, /\u001b\[1A\u001b\[2K\r/, "Thinking should be cleared before the answer");
  });
  await provider.close();
  }
);

test(
  "rich TTY clears Thinking when Ctrl-C aborts an in-flight run",
  { skip: !expectAvailable ? "expect is unavailable" : false },
  async () => {
  const provider = await startHangingProvider();
  await withTempDir(async (dir) => {
    const child = launchRichCtrlC({
      provider: "openai",
      openAiBaseUrl: provider.baseUrl,
      memoryFile: join(dir, "session.json"),
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    try {
      await waitFor(() => stdout.includes("\u001b[1A\u001b[2K\r"), 5000);
      const result = await waitForExit(child, 3000);
      assert.equal(result.code, 0, stdout);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    assert.match(stdout, /\u001b\[1A\u001b\[2K\r/, "Ctrl-C should clear Thinking");
  });
  await provider.close();
  }
);
