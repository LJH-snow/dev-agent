import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

function runCli(args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env,
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

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("--session-delete removes a stored session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-delete-"));
  try {
    const file = join(dir, "doomed.json");
    await writeFile(file, JSON.stringify({ version: 1, entries: [] }), "utf8");

    const result = await runCli(["--session-delete", "doomed", "--json"], {
      ...process.env,
      DEV_AGENT_SESSION_DIR: dir,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { sessionId: "doomed", deleted: true });
    assert.equal(await exists(file), false, "the memory file should be gone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--session-delete reports a missing session without failing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-delete-"));
  try {
    const result = await runCli(["--session-delete", "missing", "--json"], {
      ...process.env,
      DEV_AGENT_SESSION_DIR: dir,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { sessionId: "missing", deleted: false });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
