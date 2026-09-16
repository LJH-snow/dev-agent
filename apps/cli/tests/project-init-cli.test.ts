import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
      env: {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_SESSION_DIR: join(cwd, "unused-sessions"),
      },
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
  const project = await mkdtemp(join(tmpdir(), "dev-agent-init-cli-"));
  try {
    await run(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

test("init creates project state without loading a model provider", async () => {
  await withProject(async (project) => {
    const result = await runCli(["init", "--cwd", project, "--json"], project);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "init");
    assert.equal(payload.projectState, true);
    assert.equal(payload.dryRun, false);
    assert.equal(payload.config.created, true);
    assert.equal(payload.sessions.created, true);
    assert.deepEqual(JSON.parse(await readFile(join(project, ".dev-agent", "config.json"), "utf8")), {});
    assert.deepEqual(await readdir(join(project, ".dev-agent", "sessions")), []);
  });
});

test("init is idempotent and does not overwrite an existing config", async () => {
  await withProject(async (project) => {
    const first = await runCli(["init", "--cwd", project, "--json"], project);
    assert.equal(first.code, 0, first.stderr);
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(join(project, ".dev-agent", "config.json"), '{"defaultModel":"keep-me"}\n')
    );

    const second = await runCli(["init", "--cwd", project, "--json"], project);
    assert.equal(second.code, 0, second.stderr);
    const payload = JSON.parse(second.stdout);
    assert.equal(payload.config.created, false);
    assert.equal(payload.config.existing, true);
    assert.equal(await readFile(join(project, ".dev-agent", "config.json"), "utf8"), '{"defaultModel":"keep-me"}\n');
  });
});

test("init --gitignore adds an idempotent project-state rule", async () => {
  await withProject(async (project) => {
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(join(project, ".gitignore"), "node_modules/\ncustom/\n")
    );

    const first = await runCli(["init", "--cwd", project, "--gitignore", "--json"], project);
    assert.equal(first.code, 0, first.stderr);
    assert.match(await readFile(join(project, ".gitignore"), "utf8"), /node_modules\/\ncustom\/\n\.dev-agent\/\n/);

    const second = await runCli(["init", "--cwd", project, "--gitignore", "--json"], project);
    assert.equal(second.code, 0, second.stderr);
    const ignored = await readFile(join(project, ".gitignore"), "utf8");
    assert.equal((ignored.match(/^\.dev-agent\/$/gm) ?? []).length, 1);
  });
});

test("init --dry-run reports changes without creating files", async () => {
  await withProject(async (project) => {
    const result = await runCli(["init", "--cwd", project, "--dry-run", "--json"], project);

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.config.created, false);
    assert.equal(payload.config.wouldCreate, true);
    await assert.rejects(() => readFile(join(project, ".dev-agent", "config.json")));
  });
});
