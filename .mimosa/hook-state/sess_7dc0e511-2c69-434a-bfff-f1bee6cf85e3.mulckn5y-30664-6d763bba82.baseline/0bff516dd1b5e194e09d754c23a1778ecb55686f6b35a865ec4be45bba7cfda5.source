import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

function runSetup(
  directory: string,
  args: readonly string[],
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env: {
        ...process.env,
        DEV_AGENT_MCP_SERVERS: "[]",
        DEV_AGENT_MODEL_PROVIDER: "ollama",
      },
      cwd: directory,
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

test("setup command writes a project config without starting a provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-setup-cli-"));
  try {
    const result = await runSetup(directory, [
      "setup",
      "--cwd",
      directory,
      "--project-state",
      "--provider",
      "openai",
      "--model",
      "gpt-4.1-mini",
      "--non-interactive",
      "--json",
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      command: "setup",
      scope: "project",
      provider: "openai",
      model: "gpt-4.1-mini",
      created: true,
      credentialHint: "Set OPENAI_API_KEY in your environment before starting dev-agent.",
    });
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, ".dev-agent", "config.json"), "utf8")),
      {
        defaultProvider: "openai",
        defaultModel: "gpt-4.1-mini",
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("setup rejects an unsupported provider before writing configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-setup-invalid-"));
  try {
    const result = await runSetup(directory, [
      "setup",
      "--cwd",
      directory,
      "--config",
      "config.json",
      "--provider",
      "unknown",
      "--model",
      "test",
      "--non-interactive",
      "--json",
    ]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.match(JSON.parse(result.stdout).error, /one of: ollama, openai, anthropic, gemini/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
