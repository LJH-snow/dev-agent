import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const TEST_MCP_SERVERS = "[]";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return `http://127.0.0.1:${(server.address() as any).port}/v1`;
}

function closeServer(server: Server): Promise<void> {
  // A stub that never answers would otherwise keep the socket open.
  server.closeAllConnections?.();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

async function startQueuedStreamingStubProvider(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  requests: string[];
}> {
  const requests: string[] = [];
  let requestIndex = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      requests.push(body);
      const response = requestIndex === 0 ? "FIRST_RESPONSE" : "SECOND_RESPONSE";
      const delayMs = requestIndex === 0 ? 300 : 10;
      requestIndex += 1;
      res.writeHead(200, { "content-type": "text/event-stream" });
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: response } }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          })}\n\n`
        );
        res.end("data: [DONE]\n\n");
      }, delayMs);
    });
  });
  const baseUrl = await listen(server);
  return { baseUrl, close: () => closeServer(server), requests };
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

async function startRequestCaptureProvider(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  requests: string[];
}> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      requests.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "captured-answer" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );
    });
  });
  const baseUrl = await listen(server);
  return { baseUrl, close: () => closeServer(server), requests };
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
  readonly model?: string;
  readonly openAiBaseUrl?: string;
  readonly cwd?: string;
  readonly devAgentHome?: string;
  readonly streaming?: boolean;
}

function launch({ provider, memoryFile, model, openAiBaseUrl, cwd, devAgentHome, streaming = false }: InteractiveOptions): ChildProcess {
  return spawn("node", [
    cliPath,
    ...(streaming ? [] : ["--no-stream"]),
    ...(model === undefined ? [] : ["--model", model]),
  ], {
    ...(cwd === undefined ? {} : { cwd }),
    env: {
      ...process.env,
      DEV_AGENT_MCP_SERVERS: TEST_MCP_SERVERS,
      ...(cwd === undefined ? {} : { DEV_AGENT_WORKING_DIRECTORY: cwd }),
      ...(devAgentHome === undefined ? {} : { DEV_AGENT_HOME: devAgentHome }),
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

const PTY_EXIT_TIMEOUT_MS = 10_000;

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-interactive-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function launchSessionDirectory(sessionDirectory: string): ChildProcess {
  return spawn("node", [cliPath, "--no-stream"], {
    env: {
      ...process.env,
      DEV_AGENT_MCP_SERVERS: TEST_MCP_SERVERS,
      DEV_AGENT_TUI: "ink",
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_SESSION_DIR: sessionDirectory,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
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

test("line-oriented interactive mode lists and resumes a stored session", async () => {
  await withTempDir(async (dir) => {
    const sessionDirectory = join(dir, "sessions");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(
      join(sessionDirectory, "work.json"),
      JSON.stringify({
        version: 1,
        metadata: {
          sessionId: "work",
          createdAt: "2026-09-21T00:00:00.000Z",
          lastActiveAt: "2026-09-21T00:01:00.000Z",
          entryCount: 0,
        },
        entries: [],
      }),
      "utf8",
    );

    const child = launchSessionDirectory(sessionDirectory);
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    try {
      await waitForReady(child, () => stdout);
      child.stdin?.write(":sessions\n");
      await waitFor(() => stdout.includes("work · 0 entries"), 4000);
      child.stdin?.write(":resume work\n");
      await waitFor(() => stdout.includes("Resumed session work."), 4000);
      child.stdin?.write("exit\n");
      const result = await waitForExit(child, 5000);
      assert.equal(result.code, 0, stdout);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  });
});

test("interactive prompts accumulate turns and usage", async (t) => {
  const provider = await startStubProvider();
  t.after(() => provider.close());
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
});

test("interactive prompts attach @file context without rewriting the submitted prompt", async () => {
  const provider = await startRequestCaptureProvider();
  try {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "src.ts"), "export const answer = 42;\n", "utf8");
      const child = launch({
        provider: "openai",
        openAiBaseUrl: provider.baseUrl,
        memoryFile: join(dir, "session.json"),
        cwd: dir,
      });
      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      try {
        await waitForReady(child, () => stdout);
        child.stdin?.write("explain @src.ts\n");
        await waitFor(() => stdout.includes("[state=done turns=1]"), 4000);
        child.stdin?.write("exit\n");
        const result = await waitForExit(child, 5000);
        assert.equal(result.code, 0, stdout);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }

      assert.equal(provider.requests.length, 1);
      const request = JSON.parse(provider.requests[0] ?? "{}") as {
        readonly messages?: readonly { readonly content?: string }[];
      };
      const requestText = request.messages?.map((message) => message.content ?? "").join("\n") ?? "";
      const attachment = request.messages?.find((message) =>
        message.content?.includes("<dev-agent-context>"),
      )?.content ?? "";
      assert.match(requestText, /explain @src\.ts/);
      assert.match(attachment, /export const answer = 42/);
      assert.doesNotMatch(
        attachment,
        new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    });
  } finally {
    await provider.close();
  }
});

test("interactive CLI discovers and explicitly activates a project skill", async () => {
  const provider = await startRequestCaptureProvider();
  try {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, ".dev-agent", "skills", "review"), { recursive: true });
      await writeFile(
        join(dir, ".dev-agent", "skills", "review", "SKILL.md"),
        [
          "---",
          "name: review",
          "description: Review changed files",
          "---",
          "When active, inspect changed files and cite exact path and line evidence.",
        ].join("\n")
      );

      const child = launch({
        provider: "openai",
        openAiBaseUrl: provider.baseUrl,
        memoryFile: join(dir, "session.json"),
        cwd: dir,
      });
      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      try {
        await waitForReady(child, () => stdout);
        child.stdin?.write(":skills\n");
        await waitFor(() => stdout.includes("Available skills") && stdout.includes("review"), 4000);

        child.stdin?.write(":skill review\n");
        await waitFor(() => stdout.includes("Skill activated: review"), 4000);

        child.stdin?.write("inspect this\n");
        await waitFor(() => stdout.includes("[state=done turns=1]"), 4000);

        child.stdin?.write(":skill off\n");
        await waitFor(() => stdout.includes("Skill deactivated."), 4000);
        child.stdin?.write("inspect again\n");
        await waitFor(() => stdout.includes("[state=done turns=2]"), 4000);

        child.stdin?.write("exit\n");
        const result = await waitForExit(child, 5000);
        assert.equal(result.code, 0, stdout);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }

      assert.equal(provider.requests.length, 2);
      assert.match(provider.requests[0] ?? "", /Active skill: review/);
      assert.match(
        provider.requests[0] ?? "",
        /inspect changed files and cite exact path and line evidence/
      );
      assert.doesNotMatch(provider.requests[1] ?? "", /Active skill: review/);
    });
  } finally {
    await provider.close();
  }
});

test("interactive CLI can rewind conversation history without changing workspace evidence", async () => {
  const provider = await startStubProvider();
  try {
    await withTempDir(async (dir) => {
      const memoryFile = join(dir, "session.json");
      const child = launch({
        provider: "openai",
        openAiBaseUrl: provider.baseUrl,
        memoryFile,
      });
      let stdout = "";
      let checkpointId = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      try {
        await waitForReady(child, () => stdout);
        child.stdin?.write("first prompt\n");
        await waitFor(() => stdout.includes("[state=done turns=1]"), 4000);

        child.stdin?.write(":checkpoint\n");
        await waitFor(() => stdout.includes("Checkpoint created:"), 4000);
        checkpointId = stdout.match(/Checkpoint created: (checkpoint-[a-f0-9-]+)/)?.[1] ?? "";
        assert.ok(checkpointId, stdout);

        child.stdin?.write("second prompt\n");
        await waitFor(() => stdout.includes("[state=done turns=2]"), 4000);
        child.stdin?.write(`:rewind ${checkpointId}\n`);
        await waitFor(() => stdout.includes("Rewound conversation"), 4000);
        child.stdin?.write(":checkpoints\n");
        await waitFor(() => stdout.includes(`- ${checkpointId}`), 4000).catch(() => {
          throw new Error(`checkpoint list was not rendered:\n${stdout}`);
        });

        child.stdin?.write("exit\n");
        const result = await waitForExit(child, 5000);
        assert.equal(result.code, 0, stdout);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }

      const persisted = JSON.parse(await readFile(memoryFile, "utf8")) as {
        entries: { content: string }[];
        checkpoints?: { id: string }[];
      };
      assert.equal(persisted.entries.some((entry) => entry.content === "second prompt"), false);
      assert.deepEqual(
        persisted.checkpoints?.map((checkpoint) => checkpoint.id),
        [checkpointId],
      );
    });
  } finally {
    await provider.close();
  }
});

test("interactive CLI injects scoped AGENTS instructions and project metadata, separately from README context", async (t) => {
  const provider = await startRequestCaptureProvider();
  t.after(() => provider.close());
  await withTempDir(async (dir) => {
    const workspace = join(dir, "workspace");
    const home = join(dir, "dev-agent-home");
    await mkdir(join(workspace, ".git"), { recursive: true });
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "AGENTS.md"), "User-level rule", "utf8");
    await writeFile(join(workspace, "AGENTS.md"), "Project-root rule", "utf8");
    await writeFile(join(workspace, "src", "AGENTS.md"), "Source-subtree rule", "utf8");
    await writeFile(join(workspace, "README.md"), "README reference, not instruction", "utf8");
    await writeFile(join(workspace, "package.json"), JSON.stringify({
      name: "context-fixture",
      packageManager: "pnpm@12.3.4",
      dependencies: { react: "1" },
      scripts: { test: "must-not-be-forwarded" },
    }), "utf8");
    await writeFile(join(workspace, "pnpm-lock.yaml"), "", "utf8");

    const child = launch({
      provider: "openai",
      openAiBaseUrl: provider.baseUrl,
      memoryFile: join(dir, "session.json"),
      cwd: workspace,
      devAgentHome: home,
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    try {
      await waitForReady(child, () => stdout);
      child.stdin?.write(":instructions\n");
      await waitFor(() => stdout.includes("src/AGENTS.md"), 4000);
      child.stdin?.write(":project\n");
      await waitFor(() => stdout.includes("context-fixture"), 4000);
      child.stdin?.write("change src/index.ts\n");
      await waitFor(() => stdout.includes("[state=done turns=1]"), 4000);
      child.stdin?.write("exit\n");
      const result = await waitForExit(child, 5000);
      assert.equal(result.code, 0, stdout);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }

    const request = JSON.parse(provider.requests[0] ?? "{}") as {
      messages?: { role: string; content: string }[];
    };
    const system = request.messages?.filter((message) => message.role === "system")
      .map((message) => message.content).join("\n") ?? "";
    assert.match(system, /User-level rule/);
    assert.match(system, /Project-root rule/);
    assert.match(system, /Source-subtree rule/);
    assert.match(system, /applies to the src subtree only/);
    assert.match(system, /Active project root:/);
    assert.match(system, /React/);
    assert.match(system, /Package manager: pnpm/);
    assert.match(system, /Root scripts: test/);
    assert.doesNotMatch(system, /README reference, not instruction|must-not-be-forwarded/);
    assert.match(stdout, /scope=directory:src/);
    assert.match(stdout, /Package manager: pnpm/);
  });
});

test("interactive CLI exposes answer, stage, and total timings in a metadata-only trace", async (t) => {
  const provider = await startQueuedStreamingStubProvider();
  t.after(() => provider.close());
  await withTempDir(async (dir) => {
    const child = launch({
      provider: "openai",
      openAiBaseUrl: provider.baseUrl,
      memoryFile: join(dir, "session.json"),
      streaming: true,
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    try {
      await waitForReady(child, () => stdout);
      child.stdin?.write("trace-prompt\n");
      await waitFor(() => stdout.includes("[state=done turns=1]"), 4000);
      child.stdin?.write(":trace\n");
      await waitFor(() => stdout.includes("[trace]"), 4000);
      child.stdin?.write("exit\n");
      const result = await waitForExit(child, 5000);
      assert.equal(result.code, 0, stdout);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }

    assert.match(stdout, /\[trace\] run=run-[a-f0-9-]+ status=completed/);
    assert.match(stdout, /spans=model:1 tool:0/);
    assert.match(stdout, /tokens=prompt:10 completion:5 total:15/);
    assert.match(stdout, /\[trace\] timing queue=\d+ms first-token=\d+ms model=\d+ms tool=n\/a other=\d+ms total=\d+ms/);
    assert.match(stdout, /\[trace\] slow-stage=model \(\d+% of total\)/);
    assert.match(stdout, /\[timing\] queue=\d+ms first-token=\d+ms model=\d+ms tool=n\/a total=\d+ms/);
    assert.doesNotMatch(stdout, /prompt text|tool output|workingDirectory/i);
  });
});

test("interactive speed mode and :bench measure provider latency without saving a turn", async (t) => {
  const provider = await startQueuedStreamingStubProvider();
  t.after(() => provider.close());
  await withTempDir(async (dir) => {
    const memoryFile = join(dir, "session.json");
    const child = launch({
      provider: "openai",
      model: "gpt-5.6",
      openAiBaseUrl: provider.baseUrl,
      memoryFile,
      streaming: true,
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    try {
      await waitForReady(child, () => stdout);
      child.stdin?.write(":mode fast\n");
      await waitFor(() => stdout.includes("Speed mode: fast · reasoning effort low"), 4000);
      child.stdin?.write("measure normal turn\n");
      await waitFor(() => stdout.includes("[state=done turns=1]"), 4000);
      child.stdin?.write(":bench hi\n");
      await waitFor(() => /\[bench\] scope=provider-only model=gpt-5\.6 mode=fast first-token=\d+ms total=\d+ms/.test(stdout), 4000);
      child.stdin?.write("exit\n");
      const result = await waitForExit(child, 5000);
      assert.equal(result.code, 0, stdout);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }

    assert.equal(provider.requests.length, 2);
    const requests = provider.requests.map((body) => JSON.parse(body) as {
      model: string;
      reasoning_effort?: string;
      messages: { role: string; content: string }[];
    });
    assert.ok(requests.every((request) => request.model === "gpt-5.6"));
    assert.ok(requests.every((request) => request.reasoning_effort === "low"));
    assert.equal(requests[1]?.messages.length, 1);
    assert.equal(requests[1]?.messages[0]?.content, "hi");

    const persisted = JSON.parse(await readFile(memoryFile, "utf8")) as {
      entries: { content: string }[];
    };
    assert.equal(persisted.entries.some((entry) => entry.content === "hi"), false);
  });
});

test("interactive CLI exposes bounded persisted session history", async () => {
  const provider = await startStubProvider();
  try {
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
        child.stdin?.write("history prompt\n");
        await waitFor(() => stdout.includes("[state=done turns=1]"), 4000);
        child.stdin?.write(":history 2\n");
        await waitFor(() => stdout.includes("History: showing 2 of 2 entries"), 4000);

        assert.match(stdout, /You: history prompt/);
        assert.match(stdout, /Agent: ok/);

        child.stdin?.write(":search history\n");
        await waitFor(() => stdout.includes('Search: "history" · showing 1 of 1 matches'), 4000);
        assert.match(stdout, /You: history prompt/);

        child.stdin?.write("exit\n");
        const result = await waitForExit(child, 5000);
        assert.equal(result.code, 0, stdout);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    });
  } finally {
    await provider.close();
  }
});

test("interactive CLI exposes ordered task lifecycle metadata", async () => {
  const provider = await startStubProvider();
  try {
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
        child.stdin?.write("first task prompt\n");
        await waitFor(() => stdout.includes("[state=done turns=1]"), 4000);
        child.stdin?.write("second task prompt\n");
        await waitFor(() => stdout.includes("[state=done turns=2]"), 4000);
        child.stdin?.write(":tasks\n");
        await waitFor(() => stdout.includes("Tasks:"), 4000);
        child.stdin?.write("exit\n");
        const result = await waitForExit(child, 5000);
        assert.equal(result.code, 0, stdout);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }

      assert.match(stdout, /- task-1 · completed/);
      assert.match(stdout, /- task-2 · completed/);
      assert.doesNotMatch(stdout, /secret model output|\/Users\/Admin\/Desktop/);
    });
  } finally {
    await provider.close();
  }
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
      const result = await waitForExit(child, 5000);

      assert.equal(result.code, 0, stdout);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  });
});

test("interactive CLI executes a team review and asks before merging", async () => {
  const provider = await startStubProvider();
  try {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "README.md"), "team test\n");
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "dev-agent-test@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "Dev Agent Test"], { cwd: dir });
      execFileSync("git", ["add", "README.md"], { cwd: dir });
      execFileSync("git", ["commit", "-qm", "initial"], { cwd: dir });

      const child = launch({
        provider: "openai",
        openAiBaseUrl: provider.baseUrl,
        memoryFile: join(dir, "session.json"),
        cwd: dir,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      try {
        await waitForReady(child, () => stdout);
        child.stdin?.write(":team implement the requested change\n");
        await waitFor(() => /TEAM TASK TOOL SCOPE REVIEW 1\/(\d+)/.test(stdout), 15_000);
        const taskCount = Number(
          stdout.match(/TEAM TASK TOOL SCOPE REVIEW 1\/(\d+)/)?.[1],
        );
        assert.ok(Number.isInteger(taskCount) && taskCount > 0, stdout);
        for (let taskIndex = 1; taskIndex <= taskCount; taskIndex += 1) {
          await waitFor(
            () => stdout.includes(`TEAM TASK TOOL SCOPE REVIEW ${taskIndex}/${taskCount}`),
            5_000,
          );
          child.stdin?.write("all\n");
        }
        await waitFor(() => stdout.includes("Confirm this exact ordered plan and every tool scope"), 5_000);
        child.stdin?.write("yes\n");
        await waitFor(() => stdout.includes("TEAM EXECUTION"), 15_000);
        assert.match(stdout, /TEAM EXECUTION · REVIEW/);

        child.stdin?.write(":team apply\n");
        await waitFor(() => stdout.includes("Merge the reviewed team changes"), 5_000);
        child.stdin?.write("n\n");
        await waitFor(() => stdout.includes("Team review kept. No files were changed."), 5_000);
        child.stdin?.write("exit\n");
        const result = await waitForExit(child, 10_000);
        assert.equal(result.code, 0, stdout);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\n--- CLI stdout ---\n${stdout}\n--- CLI stderr ---\n${stderr}`);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    });
  } finally {
    await provider.close();
  }
});


test(
  "Ink TTY queues prompts during an active run and keeps each answer with its prompt",
  { skip: !expectAvailable ? "expect is unavailable" : false },
  async () => {
    const provider = await startQueuedStreamingStubProvider();
    await withTempDir(async (dir) => {
      const expectScript = `
        log_user 1
        spawn {${process.execPath}} {${cliPath}}
        expect "SIGNAL LOOM"
        expect "Type your message"
        sleep 1
        send "first-prompt\\r"
        expect "Working"
        send "second-prompt\\r"
        expect "WAITING QUEUE"
        expect "FIRST_RESPONSE"
        expect "SECOND_RESPONSE"
        expect "\\[state=done turns=2\\]"
        send "exit\\r"
        expect eof
      `;
      const child = spawn("expect", ["-c", expectScript], {
        env: {
          ...process.env,
          DEV_AGENT_MCP_SERVERS: TEST_MCP_SERVERS,
          DEV_AGENT_TUI: "ink",
          DEV_AGENT_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key",
          OPENAI_BASE_URL: provider.baseUrl,
          DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      try {
        const result = await waitForExit(child, 7000);
        assert.equal(result.code, 0, stdout);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
      assert.equal(provider.requests.length, 2, "the queued prompt should create exactly one later request");
      assert.match(provider.requests[0] ?? "", /first-prompt/);
      assert.match(provider.requests[1] ?? "", /second-prompt/);
      assert.match(stdout, /FIRST_RESPONSE/);
      assert.match(stdout, /SECOND_RESPONSE/);
    });
    await provider.close();
  }
);

test(
  "Ink TTY buffers text typed before the first composer frame",
  { skip: !expectAvailable ? "expect is unavailable" : false },
  async () => {
    const provider = await startQueuedStreamingStubProvider();
    await withTempDir(async (dir) => {
      const expectScript = `
        log_user 1
        spawn {${process.execPath}} {${cliPath}}
        send "你是"
        sleep 0.25
        expect "Type your message"
        send "什么模型\\r"
        expect "FIRST_RESPONSE"
        send "exit\\r"
        expect eof
      `;
      const child = spawn("expect", ["-c", expectScript], {
        env: {
          ...process.env,
          DEV_AGENT_MCP_SERVERS: TEST_MCP_SERVERS,
          DEV_AGENT_TUI: "ink",
          DEV_AGENT_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key",
          OPENAI_BASE_URL: provider.baseUrl,
          DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      try {
        const result = await waitForExit(child, 7000);
        assert.equal(result.code, 0, stdout);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }

      assert.equal(provider.requests.length, 1, "early input must submit one prompt");
      const request = JSON.parse(provider.requests[0] ?? "{}") as {
        messages?: readonly { role?: string; content?: string }[];
      };
      const userMessage = [...(request.messages ?? [])]
        .reverse()
        .find((message) => message.role === "user");
      assert.equal(userMessage?.content, "你是什么模型");
      assert.equal((stdout.match(/FIRST_RESPONSE/g) ?? []).length, 1);
    });
    await provider.close();
  }
);

test(
  "Ink TTY discovers and activates skills through slash command aliases",
  { skip: !expectAvailable ? "expect is unavailable" : false },
  async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, ".dev-agent", "skills", "review"), { recursive: true });
      await writeFile(
        join(dir, ".dev-agent", "skills", "review", "SKILL.md"),
        [
          "---",
          "name: review",
          "description: Review changed files",
          "---",
          "When active, inspect changed files and cite exact path and line evidence.",
        ].join("\n")
      );

      const expectScript = `
        log_user 1
        spawn {${process.execPath}} {${cliPath}} {--no-stream}
        expect "SIGNAL LOOM"
        expect "Type your message"
        send "/skills\\r"
        expect "Available skills"
        expect "review"
        send "/skill review\\r"
        expect "Skill activated: review"
        sleep 1
        send "\\003"
        expect eof
      `;
      const child = spawn("expect", ["-c", expectScript], {
        cwd: dir,
        env: {
          ...process.env,
          DEV_AGENT_MCP_SERVERS: TEST_MCP_SERVERS,
          DEV_AGENT_TUI: "ink",
          DEV_AGENT_MODEL_PROVIDER: "ollama",
          DEV_AGENT_WORKING_DIRECTORY: dir,
          DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      try {
        const result = await waitForExit(child, 7000);
        assert.equal(result.code, 0, stdout);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    });
  }
);

test(
  "Ink TTY treats idle Ctrl-C as a normal user exit",
  { skip: !expectAvailable ? "expect is unavailable" : false },
  async () => {
    await withTempDir(async (dir) => {
      const expectScript = `
        log_user 1
        spawn {${process.execPath}} {${cliPath}}
        expect "Type your message"
        sleep 1
        send "\\003"
        expect eof
        puts "CHILD_STATUS=[wait]"
      `;
      const child = spawn("expect", ["-c", expectScript], {
        env: {
          ...process.env,
          DEV_AGENT_MCP_SERVERS: TEST_MCP_SERVERS,
          DEV_AGENT_TUI: "ink",
          DEV_AGENT_MODEL_PROVIDER: "ollama",
          DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      try {
        const result = await waitForExit(child, PTY_EXIT_TIMEOUT_MS);
        assert.equal(result.code, 0, stdout);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
      assert.match(stdout, /CHILD_STATUS=.*\b0 0\b/, stdout);
    });
  }
);

test(
  "Ink run summary and :trace expose timing metadata after a streamed answer",
  { skip: !expectAvailable ? "expect is unavailable" : false },
  async () => {
    const provider = await startQueuedStreamingStubProvider();
    try {
      await withTempDir(async (dir) => {
        const expectScript = `
          log_user 1
          set timeout 5
          spawn {${process.execPath}} {${cliPath}}
          if {[catch {
            expect "SIGNAL LOOM"
            expect "Type your message"
            sleep 1
            send "first-prompt\\r"
            expect "FIRST_RESPONSE"
            expect -re {\\[timing\\] queue=[0-9]+ms first-token=[0-9]+ms model=[0-9]+ms tool=(n/a|[0-9]+ms) total=[0-9]+ms}
            send ":trace\\r"
            expect -re {\\[trace\\] timing queue=[0-9]+ms first-token=[0-9]+ms model=[0-9]+ms tool=(n/a|[0-9]+ms) other=[0-9]+ms total=[0-9]+ms}
            send "exit\\r"
            expect eof
          } error]} {
            puts stderr "TRACE_TEST_EXPECT_FAILED=$error"
            send "\\003"
            expect eof
            exit 2
          }
        `;
        const child = spawn("expect", ["-c", expectScript], {
          cwd: dir,
          env: {
            ...process.env,
            DEV_AGENT_MCP_SERVERS: TEST_MCP_SERVERS,
            DEV_AGENT_TUI: "ink",
            DEV_AGENT_MODEL_PROVIDER: "openai",
            OPENAI_API_KEY: "test-key",
            OPENAI_BASE_URL: provider.baseUrl,
            DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
        try {
          const result = await waitForExit(child, 10_000);
          assert.equal(result.code, 0, `${stdout}\n${stderr}`);
        } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
        assert.match(stdout, /first-token=[0-9]+ms/);
        assert.match(stdout, /total=[0-9]+ms/);
        assert.match(stdout, /slow-stage=(?:model|tools|other|queue)/);
      });
    } finally {
      await provider.close();
    }
  },
);
