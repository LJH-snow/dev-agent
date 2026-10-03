import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

function runCli(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, DEV_AGENT_MCP_SERVERS: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("mcp add/remove manage a project config without starting a provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-mcp-config-cli-"));
  try {
    const add = await runCli(
      [
        "mcp",
        "add",
        "--cwd",
        root,
        "--project-state",
        "--json",
        "--name",
        "files",
        "--command",
        "node",
        "--arg",
        "-y",
        "--arg",
        "server.js",
        "--env",
        "TOKEN=secret",
        "--timeout-ms",
        "2500",
      ],
      root,
    );
    assert.equal(add.code, 0, add.stderr);
    const added = JSON.parse(add.stdout);
    assert.equal(added.command, "mcp add");
    assert.equal(added.status, "added");
    assert.equal(added.name, "files");
    assert.doesNotMatch(add.stdout, /secret|server\.js/);

    const configPath = join(root, ".dev-agent", "config.json");
    const stored = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(stored.mcpServers[0].env.TOKEN, "secret");
    assert.deepEqual(stored.mcpServers[0].args, ["-y", "server.js"]);

    const removed = await runCli(
      ["mcp", "remove", "--cwd", root, "--project-state", "--json", "--name", "files"],
      root,
    );
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(JSON.parse(removed.stdout).status, "removed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mcp remove returns a stable nonzero result for an unknown server", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-mcp-config-cli-"));
  try {
    const result = await runCli(
      ["mcp", "remove", "--cwd", root, "--project-state", "--json", "--name", "missing"],
      root,
    );
    assert.equal(result.code, 4, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "not_found");
    assert.equal(payload.name, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mcp enable and disable work against project-scoped configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-mcp-config-cli-"));
  try {
    await runCli(
      [
        "mcp",
        "add",
        "--cwd",
        root,
        "--project-state",
        "--json",
        "--name",
        "files",
        "--command",
        "node",
      ],
      root,
    );
    const disabled = await runCli(
      ["mcp", "disable", "--cwd", root, "--project-state", "--json", "--name", "files"],
      root,
    );
    assert.equal(disabled.code, 0, disabled.stderr);
    assert.equal(JSON.parse(disabled.stdout).status, "disabled");

    const enabled = await runCli(
      ["mcp", "enable", "--cwd", root, "--project-state", "--json", "--name", "files"],
      root,
    );
    assert.equal(enabled.code, 0, enabled.stderr);
    assert.equal(JSON.parse(enabled.stdout).status, "enabled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mcp health and templates are available as explicit provider-free commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-mcp-health-cli-"));
  try {
    const templates = await runCli(["mcp", "templates", "--cwd", root, "--json"], root);
    assert.equal(templates.code, 0, templates.stderr);
    assert.match(templates.stdout, /filesystem/);

    const health = await runCli(["mcp", "health", "--cwd", root, "--json"], root);
    assert.equal(health.code, 0, health.stderr);
    assert.equal(JSON.parse(health.stdout).command, "mcp health");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
