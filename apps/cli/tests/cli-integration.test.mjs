import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

function runCli(args, env = {}) {
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

test("CLI --version exits cleanly with version string", async () => {
  const result = await runCli(["--version"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /dev-agent/);
});

test("CLI --tools exits cleanly and lists tools", async () => {
  const result = await runCli(["--tools"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /shell/);
});

test("CLI --metadata with no prior session shows no metadata", async () => {
  const result = await runCli(["--metadata"], {
    DEV_AGENT_MEMORY_FILE: "/tmp/dev-agent-cli-test-metadata.json",
  });
  assert.equal(result.code, 0);
});
