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

async function seed(dir, sessionId) {
  await writeFile(
    join(dir, `${sessionId}.json`),
    JSON.stringify({ version: 1, entries: [] }),
    "utf8"
  );
}

test("--session-rename moves the stored session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-rename-"));
  try {
    await seed(dir, "before");

    const result = await runCli(["--session-rename", "before", "After Session", "--json"], {
      ...process.env,
      DEV_AGENT_SESSION_DIR: dir,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      from: "before",
      to: "after-session",
      renamed: true,
    });
    assert.equal(await exists(join(dir, "before.json")), false);
    assert.equal(await exists(join(dir, "after-session.json")), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--session-rename refuses to overwrite an existing session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-rename-"));
  try {
    await seed(dir, "before");
    await seed(dir, "taken");

    const result = await runCli(["--session-rename", "before", "taken", "--json"], {
      ...process.env,
      DEV_AGENT_SESSION_DIR: dir,
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /already exists/);
    assert.equal(await exists(join(dir, "before.json")), true, "the source stays");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--session-rename reports a missing session without failing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-rename-"));
  try {
    const result = await runCli(["--session-rename", "missing", "next", "--json"], {
      ...process.env,
      DEV_AGENT_SESSION_DIR: dir,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      from: "missing",
      to: "next",
      renamed: false,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
