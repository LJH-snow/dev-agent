import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

function runCli(args, env = {}): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env: { ...process.env, DEV_AGENT_MODEL_PROVIDER: "ollama", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("CLI --session-list prints no sessions when directory is empty", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-sessions-"));
  try {
    const result = await runCli(["--session-list"], {
      DEV_AGENT_SESSION_DIR: sessionDir,
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /No sessions found/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("CLI --session-list lists session files with metadata", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-sessions-"));
  try {
    await writeFile(join(sessionDir, "default.json"), "{\"version\":1,\"entries\":[]}");
    await writeFile(join(sessionDir, "work.json"), "{\"version\":1,\"entries\":[]}");
    const result = await runCli(["--session-list"], {
      DEV_AGENT_SESSION_DIR: sessionDir,
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Sessions \(2\)/);
    assert.match(result.stdout, /default\.json/);
    assert.match(result.stdout, /work\.json/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("CLI --session-list keeps the newest 256 sessions in a bounded JSON envelope", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-sessions-bounded-"));
  try {
    const session = JSON.stringify({ version: 1, entries: [] });
    const baseTime = Date.now() / 1000;
    await Promise.all(
      Array.from({ length: 300 }, (_, index) =>
        writeFile(
          join(sessionDir, `session-${String(index).padStart(3, "0")}.json`),
          session
        )
      )
    );
    await Promise.all(
      Array.from({ length: 300 }, (_, index) => {
        const timestamp = baseTime + index;
        return utimes(
          join(sessionDir, `session-${String(index).padStart(3, "0")}.json`),
          timestamp,
          timestamp
        );
      })
    );

    const result = await runCli(["--session-list", "--json"], {
      DEV_AGENT_SESSION_DIR: sessionDir,
    });
    assert.equal(result.code, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.total, 300);
    assert.equal(payload.truncated, true);
    assert.equal(payload.sessions.length, 256);
    assert.deepEqual(
      payload.sessions.map((row) => row.file),
      Array.from(
        { length: 256 },
        (_, index) => `session-${String(299 - index).padStart(3, "0")}.json`
      ),
    );
    assert.ok(!payload.sessions.some((row) => row.file === "session-000.json"));
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("CLI --no-stream is accepted as a valid flag", async () => {
  const result = await runCli(["--no-stream", "--tools"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /shell/);
});
