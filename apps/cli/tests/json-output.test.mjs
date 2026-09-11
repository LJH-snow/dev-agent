import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("--tools --json prints the tool list as JSON", async () => {
  const result = await runCli(["--tools", "--json"]);

  assert.equal(result.code, 0, result.stderr);
  const tools = JSON.parse(result.stdout);
  assert.ok(Array.isArray(tools));
  const names = tools.map((tool) => tool.name);
  for (const expected of ["filesystem", "shell", "git", "search", "code-search"]) {
    assert.ok(names.includes(expected), `expected ${expected} in ${names.join(", ")}`);
  }
});

test("--metadata --json prints null when the session has no file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-json-"));
  try {
    const result = await runCli(["--metadata", "--json"], {
      ...process.env,
      DEV_AGENT_SESSION_DIR: dir,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--session-list --json prints the session files as JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-json-"));
  try {
    await writeFile(
      join(dir, "demo.json"),
      JSON.stringify({ version: 1, entries: [] }),
      "utf8"
    );

    const result = await runCli(["--session-list", "--json"], {
      ...process.env,
      DEV_AGENT_SESSION_DIR: dir,
    });

    assert.equal(result.code, 0, result.stderr);
    const sessions = JSON.parse(result.stdout);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].file, "demo.json");
    assert.ok(typeof sessions[0].size === "number");
    assert.ok(!Number.isNaN(Date.parse(sessions[0].modifiedAt)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--once --json prints one machine-readable result object", async () => {
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "hello from the model" } }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-json-"));

  try {
    const result = await runCli(["--once", "hi", "--json"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "done");
    assert.equal(payload.turns, 1);
    assert.equal(payload.content, "hello from the model");
    assert.deepEqual(payload.usage, {
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
    });
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
