import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const mockBinaryPath = fileURLToPath(
  new URL("../../../packages/executor/tests/mock-executor-binary.mjs", import.meta.url)
);

function runCheckRust(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "--check-rust", mockBinaryPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`check-failed exit=${code}: ${stderr}`));
      }
    });
  });
}

test("CLI --check-rust decodes HealthCheckResult from the mock binary", async () => {
  const stdout = await runCheckRust();
  assert.match(stdout, /Runtime version: 0\.0\.0-mock/);
  assert.match(stdout, /Capabilities: run, run_sandboxed/);
});
