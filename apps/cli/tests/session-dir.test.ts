import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

// Unique ids only: if the code under test looks in the real home directory, it
// must not read or mutate the developer's own sessions.
const probeSession = "sessiondirprobe";

function runCli(args, env = {}): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env: { ...process.env, DEV_AGENT_MODEL_PROVIDER: "ollama", ...env },
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

function memoryEntries(count) {
  return Array.from({ length: count }, (_value, index) => ({
    id: `entry-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
}

function sessionFile(entryCount) {
  return JSON.stringify({
    version: 1,
    metadata: {
      sessionId: probeSession,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: "2026-01-02T00:00:00.000Z",
      entryCount,
    },
    entries: memoryEntries(entryCount),
  });
}

test("--metadata reads the session from DEV_AGENT_SESSION_DIR", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-sessiondir-"));
  try {
    await writeFile(join(sessionDir, `${probeSession}.json`), sessionFile(7));

    const result = await runCli(["--session", probeSession, "--metadata"], {
      DEV_AGENT_SESSION_DIR: sessionDir,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, new RegExp(`Session: ${probeSession}`));
    assert.match(result.stdout, /Entries: 7/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("--compact compacts the session inside DEV_AGENT_SESSION_DIR", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-sessiondir-"));
  try {
    await writeFile(join(sessionDir, `${probeSession}.json`), sessionFile(12));

    const result = await runCli(["--session", probeSession, "--compact", "1"], {
      DEV_AGENT_SESSION_DIR: sessionDir,
    });

    assert.equal(result.code, 0);
    // keepRecentTurns(1) * 4 = 4 kept, so 12 - 4 = 8 removed.
    assert.match(result.stdout, /removed 8 entries/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("DEV_AGENT_MEMORY_FILE takes precedence over DEV_AGENT_SESSION_DIR", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-sessiondir-"));
  const memoryDir = await mkdtemp(join(tmpdir(), "dev-agent-memoryfile-"));
  try {
    await writeFile(join(sessionDir, `${probeSession}.json`), sessionFile(1));
    const memoryFile = join(memoryDir, "custom.json");
    await writeFile(memoryFile, sessionFile(9));

    const result = await runCli(["--session", probeSession, "--metadata"], {
      DEV_AGENT_SESSION_DIR: sessionDir,
      DEV_AGENT_MEMORY_FILE: memoryFile,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Entries: 9/, "DEV_AGENT_MEMORY_FILE should win");
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
    await rm(memoryDir, { recursive: true, force: true });
  }
});
