import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BackgroundJobStore } from "../dist/background-jobs.js";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = join(cliRoot, "dist", "cli-entry.js");

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function startHeldOpenAiProvider(): Promise<{
  readonly baseUrl: string;
  readonly requestReceived: Promise<Record<string, unknown>>;
  readonly secondRequestReceived: Promise<Record<string, unknown>>;
  release(): void;
  close(): Promise<void>;
}> {
  const received = deferred<Record<string, unknown>>();
  const secondReceived = deferred<Record<string, unknown>>();
  const responseGate = deferred<void>();
  let requestCount = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      requestCount += 1;
      if (requestCount === 1) received.resolve(parsed);
      else if (requestCount === 2) secondReceived.resolve(parsed);
      const sendAnswer = (): void => {
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "chatcmpl-background-test",
          object: "chat.completion",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        }));
      };
      if (requestCount === 1) void responseGate.promise.then(sendAnswer);
      else sendAnswer();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock provider did not bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requestReceived: received.promise,
    secondRequestReceived: secondReceived.promise,
    release: () => responseGate.resolve(),
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function runInteractive(
  args: readonly string[],
  command: string,
  commandOutputMarker: RegExp,
  env: NodeJS.ProcessEnv,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const child = spawn(process.execPath, [cliEntry, ...args], {
    cwd: cliRoot,
    env: { ...process.env, DEV_AGENT_MCP_SERVERS: "[]", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let closedCode: number | null | undefined;
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      closedCode = code;
      resolve();
    });
  });
  const waitForOutput = async (matches: (value: string) => boolean, description: string): Promise<void> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (matches(stdout)) return;
      if (closedCode !== undefined) throw new Error(`CLI closed before ${description}; stdout=${stdout}; stderr=${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`timed out waiting for ${description}; stdout=${stdout}; stderr=${stderr}`);
  };

  try {
    await waitForOutput((value) => value.includes("dev-agent CLI."), "interactive CLI readiness");
    child.stdin.write(`${command}\n`);
    await waitForOutput((value) => commandOutputMarker.test(value), "interactive command result");
    child.stdin.end("exit\n");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("interactive CLI timed out while exiting")), 10_000);
      void closed.then(() => {
        clearTimeout(timeout);
        resolve();
      }, (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return { code: closedCode ?? 1, stdout, stderr };
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

async function waitFor<T>(description: string, read: () => Promise<T | undefined>, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function initializeGitRepository(directory: string): void {
  execFileSync("git", ["init", "-q", directory]);
  execFileSync("git", ["-C", directory, "config", "user.name", "CLI Test"]);
  execFileSync("git", ["-C", directory, "config", "user.email", "cli-test@example.invalid"]);
  execFileSync("git", ["-C", directory, "add", "README.md"]);
  execFileSync("git", ["-C", directory, "-c", "commit.gpgsign=false", "commit", "-qm", "initial commit"]);
}

test("detached background job survives its CLI and is visible from a fresh CLI session", { timeout: 45_000 }, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dev-agent-background-e2e-"));
  const home = join(temporaryRoot, "home");
  const repository = join(temporaryRoot, "repo");
  await Promise.all([mkdir(home), mkdir(repository)]);
  await writeFile(join(repository, "README.md"), "temporary test repository\n", "utf8");
  initializeGitRepository(repository);
  const provider = await startHeldOpenAiProvider();
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    DEV_AGENT_HOME: home,
    DEV_AGENT_MODEL_PROVIDER: "openai",
    DEV_AGENT_CONFIG_FILE: join(home, "missing-config.json"),
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
  };
  const store = new BackgroundJobStore(join(home, ".dev-agent", "jobs"));

  try {
    const parent = await runInteractive(
      ["--cwd", repository, "--provider", "openai", "--model", "test-model", "--approval", "deny-dangerous"],
      ":job start answer with a short greeting",
      /Started background job job-[a-f0-9]{16}/u,
      env,
    );
    assert.equal(parent.code, 0, parent.stderr);
    assert.match(parent.stdout, /Started background job job-[a-f0-9]{16}/);
    const id = /Started background job (job-[a-f0-9]{16})/u.exec(parent.stdout)?.[1];
    assert.ok(id, parent.stdout);

    const job = await waitFor("the detached worker's provider request", async () => {
      const request = await Promise.race([
        provider.requestReceived,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 30)),
      ]);
      return request;
    });
    const messages = job.messages as readonly { readonly content?: unknown }[];
    assert.ok(messages.some((message) => String(message.content ?? "").includes("answer with a short greeting")));

    const running = await waitFor("the running job record", async () => {
      const snapshot = await store.get(id);
      return snapshot?.status === "running" ? snapshot : undefined;
    });
    const jobFile = await readFile(join(home, ".dev-agent", "jobs", id, "job.json"), "utf8");
    assert.doesNotMatch(jobFile, /answer with a short greeting/);
    assert.equal((await stat(join(home, ".dev-agent", "jobs", id))).mode & 0o777, 0o700);
    const requestPath = join(home, ".dev-agent", "jobs", id, "request.json");
    assert.equal((await stat(requestPath)).mode & 0o777, 0o600);

    const freshSession = await runInteractive(
      ["--cwd", repository, "--provider", "openai", "--model", "test-model", "--approval", "deny-dangerous"],
      ":jobs",
      /Background jobs:/u,
      env,
    );
    assert.equal(freshSession.code, 0, freshSession.stderr);
    assert.match(freshSession.stdout, new RegExp(`${id} \\u00b7 running`, "u"));
    assert.doesNotMatch(freshSession.stdout, /answer with a short greeting/);
    assert.equal(running.id, id);

    provider.release();
    const completed = await waitFor("the worker to finish after its parent CLI exited", async () => {
      const snapshot = await store.get(id);
      return snapshot?.status === "completed" ? snapshot : undefined;
    });
    assert.equal(completed.runCount, 1);

    const completedListing = await runInteractive(
      ["--cwd", repository, "--provider", "openai", "--model", "test-model", "--approval", "deny-dangerous"],
      ":jobs",
      /Background jobs:/u,
      env,
    );
    assert.equal(completedListing.code, 0, completedListing.stderr);
    assert.match(completedListing.stdout, new RegExp(`${id} \\u00b7 completed`, "u"));
  } finally {
    provider.release();
    await provider.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});


test("explicit resume continues a cancelled background session instead of replaying its original request", { timeout: 45_000 }, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dev-agent-background-resume-e2e-"));
  const home = join(temporaryRoot, "home");
  const repository = join(temporaryRoot, "repo");
  await Promise.all([mkdir(home), mkdir(repository)]);
  await writeFile(join(repository, "README.md"), "temporary test repository\n", "utf8");
  initializeGitRepository(repository);
  const provider = await startHeldOpenAiProvider();
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    DEV_AGENT_HOME: home,
    DEV_AGENT_MODEL_PROVIDER: "openai",
    DEV_AGENT_CONFIG_FILE: join(home, "missing-config.json"),
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
  };
  const store = new BackgroundJobStore(join(home, ".dev-agent", "jobs"));

  try {
    const parent = await runInteractive(
      ["--cwd", repository, "--provider", "openai", "--model", "test-model", "--approval", "deny-dangerous"],
      ":job start continue the requested task safely\n",
      /Started background job job-[a-f0-9]{16}/u,
      env,
    );
    assert.equal(parent.code, 0, parent.stderr);
    const id = /Started background job (job-[a-f0-9]{16})/u.exec(parent.stdout)?.[1];
    assert.ok(id, parent.stdout);
    await provider.requestReceived;

    const cancelledCli = await runInteractive(
      ["--cwd", repository, "--provider", "openai", "--model", "test-model", "--approval", "deny-dangerous"],
      `:job cancel ${id}`,
      new RegExp(`Cancellation requested for background job ${id}`, "u"),
      env,
    );
    assert.equal(cancelledCli.code, 0, cancelledCli.stderr);
    const cancelled = await waitFor("the worker to stop after cross-session cancellation", async () => {
      const snapshot = await store.get(id);
      return snapshot?.status === "cancelled" ? snapshot : undefined;
    });
    assert.equal(cancelled.runCount, 1);

    const resumedCli = await runInteractive(
      ["--cwd", repository, "--provider", "openai", "--model", "test-model", "--approval", "deny-dangerous"],
      `:job resume ${id}`,
      new RegExp(`Explicit continuation started for background job ${id}`, "u"),
      env,
    );
    assert.equal(resumedCli.code, 0, resumedCli.stderr);
    const resumedRequest = await waitFor("the explicit continuation model request", async () => {
      const request = await Promise.race([
        provider.secondRequestReceived,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 30)),
      ]);
      return request;
    });
    const messages = resumedRequest.messages as readonly { readonly role?: string; readonly content?: unknown }[];
    assert.ok(messages.some((message) => String(message.content ?? "").includes("Continue the previously started task")));
    assert.equal(messages.filter((message) => String(message.content ?? "").includes("continue the requested task safely")).length, 1);

    const completed = await waitFor("the explicitly resumed job to complete", async () => {
      const snapshot = await store.get(id);
      return snapshot?.status === "completed" ? snapshot : undefined;
    });
    assert.equal(completed.runCount, 2);
  } finally {
    provider.release();
    await provider.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
