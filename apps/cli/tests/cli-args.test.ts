import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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

test("--help prints command usage without starting a session", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--help"], dir);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Usage: dev-agent/);
    assert.match(result.stdout, /\breview\b/);
    assert.deepEqual(await readdir(dir), []);
  });
});

test("global options may precede an explicit command", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--cwd", dir, "review", "--json", "--non-interactive"], dir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      command: "review",
      mode: "working-tree",
      status: "skipped",
      changedFiles: [],
      summary: {
        changedFiles: 0,
        additions: 0,
        deletions: 0,
        reason: "not_git_repository",
      },
      warnings: ["not_git_repository"],
    });
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

test("--cwd requires a directory path instead of consuming another flag", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--cwd", "--tools"], dir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /--cwd requires a value/);
    assert.equal(result.stdout, "", "must not start a CLI operation");
  });
});

test("--cwd is accepted alongside a normal operation", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--cwd", dir, "--tools"], dir);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /code-search/);
  });
});

test("--once does not treat the next flag as its prompt", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--once", "--json"], dir);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { error: "--once requires a value." });
  });
});

test("a stray positional argument is rejected", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["hello"], dir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unexpected argument 'hello'/);
  });
});

test("human CLI errors sanitize untrusted argument text", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["hello\u001b[31m"], dir);

    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /\u001b/);
    assert.match(result.stderr, /Unexpected argument/);
  });
});

test("valid flag combinations still run", async () => {
  await withSessionDir(async (dir) => {
    const version = await runCli(["--version"], dir);
    assert.equal(version.code, 0);
    const manifest = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf8"));
    assert.equal(version.stdout.trim(), `dev-agent ${manifest.version}`);

    const short = await runCli(["-v"], dir);
    assert.equal(short.code, 0);

    const tools = await runCli(["--session", "demo", "--tools"], dir);
    assert.equal(tools.code, 0, tools.stderr);
    assert.match(tools.stdout, /code-search/);

    const projectState = await runCli(["--project-state", "--tools"], dir);
    assert.equal(projectState.code, 0, projectState.stderr);
    assert.match(projectState.stdout, /code-search/);
  });
});

test("review-writes is accepted as an approval mode", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--approval", "review-writes", "--tools"], dir);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /filesystem/);
    assert.doesNotMatch(result.stderr, /Unknown approval mode/);
  });
});

test("optional-value flags still work without a value", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--compact"], dir);

    assert.doesNotMatch(result.stderr, /Unknown option|requires a value/);
  });
});

test("--config requires a file path instead of consuming another flag", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--config", "--tools"], dir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /--config requires a value/);
    assert.equal(result.stdout, "");
  });
});

test("blank --cwd and --config values are rejected", async () => {
  await withSessionDir(async (dir) => {
    const cwdResult = await runCli(["--cwd", "", "--tools"], dir);
    assert.equal(cwdResult.code, 1);
    assert.match(cwdResult.stderr, /--cwd requires a directory path/);

    const configResult = await runCli(["--config", "", "--tools"], dir);
    assert.equal(configResult.code, 1);
    assert.match(configResult.stderr, /--config requires a file path/);
  });
});

test("--exclude requires an index operation", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(["--exclude", "generated", "--json"], dir);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.match(JSON.parse(result.stdout).error, /--exclude.*--index/i);
  });
});

test("--preview-evidence cannot be combined with --exclude", async () => {
  await withSessionDir(async (dir) => {
    const result = await runCli(
      ["--preview-evidence", "--exclude", "generated", "--json"],
      dir
    );

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /preview-evidence.*exclude/i);
  });
});
