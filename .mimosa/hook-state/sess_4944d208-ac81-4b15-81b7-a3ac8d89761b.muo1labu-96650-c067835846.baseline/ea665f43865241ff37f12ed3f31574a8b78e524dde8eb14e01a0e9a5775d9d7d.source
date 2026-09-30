import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

function runCli(args: readonly string[], cwd: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, DEV_AGENT_MODEL_PROVIDER: "ollama", DEV_AGENT_MCP_SERVERS: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dev-agent-management-cli-"));
}

test("mcp list/validate are metadata-only explicit CLI commands", async () => {
  const root = await project();
  await writeFile(join(root, "config.json"), JSON.stringify({
    mcpServers: [{ name: "files", command: "node", args: ["server.js"], env: { TOKEN: "secret" } }],
  }));

  const listed = await runCli(["mcp", "list", "--cwd", root, "--config", "config.json", "--json"], root);
  assert.equal(listed.code, 0, listed.stderr);
  const list = JSON.parse(listed.stdout);
  assert.equal(list.command, "mcp list");
  assert.equal(list.servers[0].name, "files");
  assert.equal(list.servers[0].argumentCount, 1);
  assert.doesNotMatch(listed.stdout, /server\.js|secret|TOKEN|\/Users\//);

  const validated = await runCli(["mcp", "validate", "--cwd", root, "--config", "config.json", "--json"], root);
  assert.equal(validated.code, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).status, "ok");
});

test("mcp test reports a stable failure without leaking command details", async () => {
  const root = await project();
  await writeFile(join(root, "config.json"), JSON.stringify({
    mcpServers: [{ name: "broken", command: "dev-agent-command-that-does-not-exist" }],
  }));

  const result = await runCli(["mcp", "test", "--cwd", root, "--config", "config.json", "--json"], root);
  assert.equal(result.code, 5, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "mcp test");
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, "connection_failed");
  assert.doesNotMatch(result.stdout, /dev-agent-command-that-does-not-exist|ENOENT|\/Users\//);
});

test("index refresh/status/clear form a provider-free lifecycle", async () => {
  const root = await project();
  await writeFile(join(root, "example.ts"), "export function hello(): string { return 'hi'; }\n");

  const customIndex = join(root, "cache", "custom-index.json");
  const refreshed = await runCli(["index", "refresh", "--cwd", root, "--index-file", customIndex, "--json"], root);
  assert.equal(refreshed.code, 0, refreshed.stderr);
  const refresh = JSON.parse(refreshed.stdout);
  assert.equal(refresh.command, "index refresh");
  assert.equal(refresh.files, 1);
  assert.equal(refresh.written, true);
  assert.equal(refresh.cacheHits, 0);
  assert.equal(typeof refresh.updatedAt, "string");
  assert.equal(refresh.path, undefined);

  const status = await runCli(["index", "status", "--cwd", root, "--index-file", customIndex, "--json"], root);
  assert.equal(status.code, 0, status.stderr);
  const snapshot = JSON.parse(status.stdout);
  assert.equal(snapshot.command, "index status");
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.usable, true);
  assert.equal(snapshot.fileCount, 1);
  assert.equal(snapshot.symbolCount, 1);
  assert.equal(snapshot.cacheHitRate, 0);
  assert.equal(snapshot.errorCount, 0);
  assert.equal(typeof snapshot.updatedAt, "string");
  assert.doesNotMatch(status.stdout, /example\.ts|\/Users\//);

  const blocked = await runCli(["index", "clear", "--cwd", root, "--index-file", customIndex, "--json"], root);
  assert.equal(blocked.code, 3, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).reason, "confirmation_required");

  const cleared = await runCli(["index", "clear", "--cwd", root, "--index-file", customIndex, "--confirm", "--json"], root);
  assert.equal(cleared.code, 0, cleared.stderr);
  assert.equal(JSON.parse(cleared.stdout).status, "cleared");
});
