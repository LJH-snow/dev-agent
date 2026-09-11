import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = join(cliRoot, "dist", "index.js");

function runCli(args, env = {}): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: cliRoot,
      env: { ...process.env, DEV_AGENT_MODEL_PROVIDER: "ollama", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ stdout, stderr: `${stderr}\n${error.message}`, code: 1 });
    });
    child.on("exit", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

test("CLI --tools lists built-in tools without provider", async () => {
  const { stdout, code } = await runCli(["--tools"]);
  assert.equal(code, 0);
  assert.match(stdout, /code-search:/);
  assert.match(stdout, /filesystem:/);
  assert.match(stdout, /shell:/);
  assert.match(stdout, /git:/);
});

test("CLI --version prints version", async () => {
  const { stdout, code } = await runCli(["--version"]);
  assert.equal(code, 0);
  assert.match(stdout, /dev-agent 0\.1\.0/);
});

test("CLI --metadata shows no metadata for fresh session", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-cli-"));
  const sessionFile = join(sessionDir, "e2e.json");
  try {
    const { stdout, code } = await runCli(["--metadata"], {
      DEV_AGENT_MEMORY_FILE: sessionFile,
    });
    assert.equal(code, 0);
    assert.match(stdout, /No session metadata found/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("CLI --metadata reports a corrupt memory file", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-cli-"));
  const sessionFile = join(sessionDir, "broken.json");
  try {
    await writeFile(sessionFile, "{ not json", "utf8");

    const { stdout, stderr, code } = await runCli(["--metadata"], {
      DEV_AGENT_MEMORY_FILE: sessionFile,
    });

    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /Invalid memory file/);
    assert.match(stderr, /--reset-memory/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("CLI --metadata --json reports a corrupt memory file", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-cli-"));
  const sessionFile = join(sessionDir, "broken.json");
  try {
    await writeFile(sessionFile, "{ not json", "utf8");

    const { stdout, code } = await runCli(["--metadata", "--json"], {
      DEV_AGENT_MEMORY_FILE: sessionFile,
    });

    assert.equal(code, 1);
    const payload = JSON.parse(stdout);
    assert.equal(payload.error, "invalid memory file");
    assert.equal(payload.path, sessionFile);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("CLI --metadata accepts a valid file without metadata", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-cli-"));
  const sessionFile = join(sessionDir, "plain.json");
  try {
    await writeFile(sessionFile, JSON.stringify({ version: 1, entries: [] }), "utf8");

    const { stdout, code } = await runCli(["--metadata"], {
      DEV_AGENT_MEMORY_FILE: sessionFile,
    });

    assert.equal(code, 0);
    assert.match(stdout, /No session metadata found/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("CLI --metadata prints the accumulated usage", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-cli-"));
  const sessionFile = join(sessionDir, "usage.json");
  try {
    await writeFile(
      sessionFile,
      JSON.stringify({
        version: 1,
        metadata: {
          sessionId: "usage",
          createdAt: "2026-09-11T00:00:00.000Z",
          lastActiveAt: "2026-09-11T00:05:00.000Z",
          entryCount: 2,
          usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
        },
        entries: [],
      }),
      "utf8"
    );

    const { stdout, code } = await runCli(["--metadata"], {
      DEV_AGENT_MEMORY_FILE: sessionFile,
    });

    assert.equal(code, 0);
    assert.match(stdout, /Usage: prompt=12 completion=5 total=17/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("CLI --compact reports zero removals for empty session", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-cli-"));
  const sessionFile = join(sessionDir, "e2e.json");
  try {
    const { stdout, code } = await runCli(["--compact", "3"], {
      DEV_AGENT_MEMORY_FILE: sessionFile,
    });
    assert.equal(code, 0);
    assert.match(stdout, /removed 0 entries/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("CLI --compact requires a positive integer", async () => {
  const { stderr, code } = await runCli(["--compact", "abc"]);
  assert.notEqual(code, 0);
  assert.match(stderr, /positive integer/);
});
