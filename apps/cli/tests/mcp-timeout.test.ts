import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");
const silentServer = fileURLToPath(
  new URL("../../../packages/mcp/tests/silent-mcp-server.mjs", import.meta.url)
);

function runCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
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

test("a silent MCP server fails fast instead of hanging the CLI at startup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-timeout-"));
  try {
    const started = Date.now();
    const result = await runCli(["--tools"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_SESSION_DIR: dir,
      DEV_AGENT_MCP_TIMEOUT_MS: "700",
      DEV_AGENT_MCP_SERVERS: JSON.stringify([
        { name: "silent", command: process.execPath, args: [silentServer] },
      ]),
    });
    const elapsed = Date.now() - started;

    assert.notEqual(result.code, 0, "a server that never answers is a failure");
    assert.match(result.stderr, /timed out after 700ms/);
    assert.match(result.stderr, /initialize/);
    assert.ok(elapsed < 5000, `the CLI must not hang (took ${elapsed}ms)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
