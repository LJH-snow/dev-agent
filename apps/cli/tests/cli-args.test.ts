import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

function runCli(args: readonly string[], sessionDir: string): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env: {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_SESSION_DIR: sessionDir,
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
    child.stdin.end();
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withSessionDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-args-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("an unknown flag is rejected instead of silently ignored", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--nope"], dir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unknown option '--nope'/);
    assert.equal(result.stdout, "", "must not start an interactive session");
  });
});

test("a flag cannot be consumed as another flag's value", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--session", "--once", "hi"], dir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /--session requires a value/);
    assert.deepEqual(
      await readdir(dir),
      [],
      "no session named after the swallowed flag may be created"
    );
  });
});

test("--once does not treat the next flag as its prompt", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--once", "--json"], dir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /--once requires a value/);
  });
});

test("a stray positional argument is rejected", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["hello"], dir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unexpected argument 'hello'/);
  });
});

test("valid flag combinations still run", async () => {
  await withSessionDir(async (dir) => {
    const version = await runCli(["--version"], dir);
    assert.equal(version.code, 0);
    assert.match(version.stdout, /dev-agent 0\.1\.0/);

    const short = await runCli(["-v"], dir);
    assert.equal(short.code, 0);

    const tools = await runCli(["--session", "demo", "--tools"], dir);
    assert.equal(tools.code, 0, tools.stderr);
    assert.match(tools.stdout, /code-search/);
  });
});

test("optional-value flags still work without a value", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--compact"], dir);

    assert.doesNotMatch(result.stderr, /Unknown option|requires a value/);
  });
});
