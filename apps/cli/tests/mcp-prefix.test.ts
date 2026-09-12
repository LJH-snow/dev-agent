import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");
const fixture = fileURLToPath(
  new URL("../../../packages/mcp/tests/fake-mcp-server.mjs", import.meta.url)
);

/** Lists the tool names the CLI registers for the given MCP server config. */
async function listToolNames(
  servers: readonly Record<string, unknown>[],
  dir: string
): Promise<string[]> {
  const result: any = await new Promise((resolve) => {
    const child = spawn("node", [cliPath, "--tools"], {
      env: {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_SESSION_DIR: dir,
        DEV_AGENT_MCP_SERVERS: JSON.stringify(servers),
      },
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

  assert.equal(result.code, 0, result.stderr);
  return result.stdout
    .split("\n")
    .map((line: string) => line.split(":")[0])
    .filter(Boolean);
}

function server(): Record<string, unknown> {
  return { command: process.execPath, args: [fixture] };
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-prefix-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("two unnamed servers get distinct prefixes instead of erasing each other", async () => {
  await withTempDir(async (dir) => {
    const names = await listToolNames([server(), server()], dir);
    const mcp = names.filter((name) => name === "mcp" || /^mcp-\d+$/.test(name));

    // Each fixture server contributes five MCP tools; before the fix the second
    // server's tools overwrote the first, leaving five instead of ten.
    assert.equal(mcp.length, 10, `expected ten MCP tools, got ${mcp.join(", ")}`);
    assert.ok(mcp.includes("mcp-1"), `expected mcp-1 in ${mcp.join(", ")}`);
    assert.ok(mcp.includes("mcp-2"), `expected mcp-2 in ${mcp.join(", ")}`);
    assert.ok(!mcp.includes("mcp"), "an ambiguous shared prefix must not be used");
  });
});

test("two servers with the same explicit name are disambiguated", async () => {
  await withTempDir(async (dir) => {
    const names = await listToolNames(
      [ { ...server(), name: "files" }, { ...server(), name: "files" } ],
      dir
    );
    const mcp = names.filter((name) => name === "files" || name.startsWith("files-"));

    assert.equal(mcp.length, 10, `expected ten MCP tools, got ${mcp.join(", ")}`);
    assert.ok(mcp.includes("files"));
    assert.ok(mcp.includes("files-2"), "the duplicate name must be disambiguated");
  });
});

test("a single unnamed server keeps the historical mcp prefix", async () => {
  await withTempDir(async (dir) => {
    const names = await listToolNames([server()], dir);
    const mcp = names.filter((name) => name.startsWith("mcp"));

    assert.equal(mcp.length, 5);
    assert.ok(
      mcp.every((name) => name === "mcp"),
      `single unnamed server should stay on 'mcp', got ${mcp.join(", ")}`
    );
  });
});
