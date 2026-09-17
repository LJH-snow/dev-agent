import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

function runCli(args: readonly string[], cwd: string, env: Record<string, string | undefined> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, DEV_AGENT_MODEL_PROVIDER: "ollama", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withProject(run: (project: string) => Promise<void>): Promise<void> {
  const project = await mkdtemp(join(tmpdir(), "dev-agent-provider-cli-"));
  try {
    await run(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

test("providers list and models current are provider-free JSON commands", async () => {
  await withProject(async (project) => {
    const listed = await runCli(["providers", "list", "--cwd", project, "--json"], project);
    assert.equal(listed.code, 0, listed.stderr);
    const providers = JSON.parse(listed.stdout);
    assert.equal(providers.command, "providers list");
    assert.equal(providers.providers.length, 4);
    assert.doesNotMatch(listed.stdout, /sk-[A-Za-z0-9]|do-not-print|secret-value/i);

    const current = await runCli(
      ["models", "current", "--cwd", project, "--json"],
      project,
      { DEV_AGENT_MODEL_PROVIDER: "openai", DEV_AGENT_MODEL: "gpt-test" },
    );
    assert.equal(current.code, 0, current.stderr);
    assert.deepEqual(JSON.parse(current.stdout), {
      ok: true,
      command: "models current",
      providers: [],
      models: [],
      currentProvider: null,
      provider: "openai",
      model: "gpt-test",
      source: "environment",
      error: null,
    });
  });
});

test("providers status exposes missing configuration without leaking credentials", async () => {
  await withProject(async (project) => {
    await writeFile(join(project, "config.json"), JSON.stringify({
      providers: { openai: { model: "gpt-test" } },
      defaultProvider: "openai",
    }));
    const result = await runCli(
      ["providers", "status", "--cwd", project, "--config", "config.json", "--provider", "openai", "--json"],
      project,
      { OPENAI_API_KEY: undefined, DEV_AGENT_MODEL_PROVIDER: undefined },
    );
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.providers[0].state, "missing_config");
    assert.equal(payload.providers[0].reason, "api_key_missing");
    assert.doesNotMatch(result.stdout, /do-not-print|secret-value/i);
  });
});

test("provider command rejects an unknown provider with a stable usage result", async () => {
  await withProject(async (project) => {
    const result = await runCli(
      ["providers", "status", "--cwd", project, "--provider", "not-real", "--json"],
      project,
    );
    assert.equal(result.code, 64);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.reason, "invalid_provider");
  });
});
