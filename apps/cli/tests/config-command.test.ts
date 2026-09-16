import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

function runCli(args: readonly string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, DEV_AGENT_MODEL_PROVIDER: "ollama" },
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
  const project = await mkdtemp(join(tmpdir(), "dev-agent-config-cli-"));
  try {
    await mkdir(join(project, ".dev-agent", "sessions"), { recursive: true });
    await run(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

test("config validate reports a valid project config as JSON", async () => {
  await withProject(async (project) => {
    await writeFile(
      join(project, ".dev-agent", "config.json"),
      JSON.stringify({ defaultProvider: "ollama", maxTurns: 8, approvalMode: "review-writes" })
    );

    const result = await runCli(["config", "validate", "--cwd", project, "--project-state", "--json"], project);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "config validate");
    assert.equal(payload.valid, true);
    assert.deepEqual(payload.diagnostics, []);
  });
});

test("config validate returns a nonzero result for invalid JSON and unknown provider", async () => {
  await withProject(async (project) => {
    await writeFile(join(project, ".dev-agent", "config.json"), '{"defaultProvider":"secret-provider",');

    const result = await runCli(["config", "validate", "--cwd", project, "--project-state", "--json"], project);
    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.valid, false);
    assert.ok(payload.diagnostics.some((item: any) => item.code === "invalid_json"));
    assert.doesNotMatch(result.stdout, /secret|token|key/i);
  });
});

test("config show returns a redacted effective config without starting a provider", async () => {
  await withProject(async (project) => {
    await writeFile(
      join(project, ".dev-agent", "config.json"),
      JSON.stringify({ defaultProvider: "ollama", defaultModel: "qwen3:4b-instruct" })
    );

    const result = await runCli(["config", "show", "--cwd", project, "--project-state", "--json"], project);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "config show");
    assert.equal(payload.config.defaultProvider, "ollama");
    assert.equal(payload.config.defaultModel, "qwen3:4b-instruct");
    assert.doesNotMatch(result.stdout, /\/Users\/|\/tmp\/|api[_-]?key|token/i);
  });
});
