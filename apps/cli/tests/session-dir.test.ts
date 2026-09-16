import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("--session-list human output sanitizes the session directory path", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dev-agent-sessiondir-"));
  const sessionDir = join(parent, "sessions\u001b[31m");
  try {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, `${probeSession}.json`), sessionFile(1));

    const result = await runCli(["--session-list"], {
      DEV_AGENT_SESSION_DIR: sessionDir,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /\u001b/);
    assert.match(result.stdout, /Sessions \(1\)/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("--metadata human errors sanitize an invalid memory path", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dev-agent-sessiondir-"));
  const memoryFile = join(parent, "memory\u001b[31m.json");
  try {
    await writeFile(memoryFile, "{not-json", "utf8");

    const result = await runCli(["--metadata"], {
      DEV_AGENT_MEMORY_FILE: memoryFile,
    });

    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /\u001b/);
    assert.match(result.stderr, /Invalid memory file/);
  } finally {
    await rm(parent, { recursive: true, force: true });
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

test("two explicit session directories keep the same session id isolated", async () => {
  const firstDir = await mkdtemp(join(tmpdir(), "dev-agent-sessiondir-first-"));
  const secondDir = await mkdtemp(join(tmpdir(), "dev-agent-sessiondir-second-"));
  try {
    await writeFile(join(firstDir, `${probeSession}.json`), sessionFile(2));
    await writeFile(join(secondDir, `${probeSession}.json`), sessionFile(11));

    const first = await runCli(["--session", probeSession, "--metadata"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_SESSION_DIR: firstDir,
    });
    const second = await runCli(["--session", probeSession, "--metadata"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_SESSION_DIR: secondDir,
    });

    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
    assert.match(first.stdout, /Entries: 2/);
    assert.match(second.stdout, /Entries: 11/);
  } finally {
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
});

test("--project-state reads sessions from the final project directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "dev-agent-project-state-home-"));
  const firstProject = await mkdtemp(join(tmpdir(), "dev-agent-project-state-first-"));
  const secondProject = await mkdtemp(join(tmpdir(), "dev-agent-project-state-second-"));
  try {
    await mkdir(join(firstProject, ".dev-agent", "sessions"), { recursive: true });
    await mkdir(join(secondProject, ".dev-agent", "sessions"), { recursive: true });
    await writeFile(
      join(firstProject, ".dev-agent", "sessions", `${probeSession}.json`),
      sessionFile(3)
    );
    await writeFile(
      join(secondProject, ".dev-agent", "sessions", `${probeSession}.json`),
      sessionFile(13)
    );

    const baseEnv = {
      HOME: home,
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_SESSION_DIR: "",
      DEV_AGENT_MEMORY_FILE: "",
      DEV_AGENT_CONFIG_FILE: "",
    };
    const first = await runCli(
      ["--cwd", firstProject, "--project-state", "--session", probeSession, "--metadata"],
      baseEnv
    );
    const second = await runCli(
      ["--cwd", secondProject, "--project-state", "--session", probeSession, "--metadata"],
      baseEnv
    );

    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    assert.match(first.stdout, /Entries: 3/);
    assert.match(second.stdout, /Entries: 13/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(firstProject, { recursive: true, force: true });
    await rm(secondProject, { recursive: true, force: true });
  }
});

test("explicit memory and session paths still override --project-state", async () => {
  const home = await mkdtemp(join(tmpdir(), "dev-agent-project-state-override-home-"));
  const project = await mkdtemp(join(tmpdir(), "dev-agent-project-state-override-project-"));
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-project-state-override-sessions-"));
  const memoryDir = await mkdtemp(join(tmpdir(), "dev-agent-project-state-override-memory-"));
  try {
    await mkdir(join(project, ".dev-agent", "sessions"), { recursive: true });
    await writeFile(
      join(project, ".dev-agent", "sessions", `${probeSession}.json`),
      sessionFile(2)
    );
    await writeFile(join(sessionDir, `${probeSession}.json`), sessionFile(7));
    const memoryFile = join(memoryDir, "custom.json");
    await writeFile(memoryFile, sessionFile(19));

    const sessionResult = await runCli(
      ["--cwd", project, "--project-state", "--session", probeSession, "--metadata"],
      {
        HOME: home,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_SESSION_DIR: sessionDir,
        DEV_AGENT_MEMORY_FILE: "",
      }
    );
    const memoryResult = await runCli(
      ["--cwd", project, "--project-state", "--session", probeSession, "--metadata"],
      {
        HOME: home,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_SESSION_DIR: sessionDir,
        DEV_AGENT_MEMORY_FILE: memoryFile,
      }
    );

    assert.equal(sessionResult.code, 0, sessionResult.stderr);
    assert.equal(memoryResult.code, 0, memoryResult.stderr);
    assert.match(sessionResult.stdout, /Entries: 7/);
    assert.match(memoryResult.stdout, /Entries: 19/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    await rm(sessionDir, { recursive: true, force: true });
    await rm(memoryDir, { recursive: true, force: true });
  }
});
