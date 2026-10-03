import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executeMcpConfigCommand } from "../dist/mcp-config-command.js";

async function withConfig(
  run: (configPath: string, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-mcp-config-"));
  try {
    await run(join(root, "config.json"), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("mcp add creates a private config entry and preserves unrelated settings", async () => {
  await withConfig(async (configPath) => {
    await writeFile(
      configPath,
      JSON.stringify({ defaultProvider: "ollama", mcpServers: [] }),
      "utf8",
    );

    const result = await executeMcpConfigCommand({
      action: "add",
      configPath,
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      environment: ["MCP_TOKEN=secret", "LOG_LEVEL=debug"],
      timeoutMs: 5000,
    });

    assert.equal(result.status, "added");
    assert.equal(result.serverCount, 1);
    assert.equal(result.argumentCount, 3);
    assert.equal(result.environmentVariableCount, 2);
    assert.doesNotMatch(JSON.stringify(result), /secret|server-filesystem|\/tmp/);

    const stored = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(stored.defaultProvider, "ollama");
    assert.deepEqual(stored.mcpServers[0], {
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: { MCP_TOKEN: "secret", LOG_LEVEL: "debug" },
      timeoutMs: 5000,
    });
    assert.equal((await lstat(configPath)).mode & 0o777, 0o600);
  });
});

test("mcp add rejects duplicate names and invalid environment assignments", async () => {
  await withConfig(async (configPath) => {
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: [{ name: "files", command: "node" }] }),
      "utf8",
    );

    await assert.rejects(
      executeMcpConfigCommand({
        action: "add",
        configPath,
        name: "files",
        command: "node",
      }),
      /already exists/,
    );
    await assert.rejects(
      executeMcpConfigCommand({
        action: "add",
        configPath,
        name: "other",
        command: "node",
        environment: ["not valid=secret"],
      }),
      /environment names/,
    );
  });
});

test("mcp remove updates the config and is idempotently reported when absent", async () => {
  await withConfig(async (configPath) => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: [
          { name: "one", command: "node", args: ["one"] },
          { name: "two", command: "node" },
        ],
      }),
      "utf8",
    );

    const removed = await executeMcpConfigCommand({
      action: "remove",
      configPath,
      name: "one",
    });
    assert.equal(removed.status, "removed");
    assert.equal(removed.serverCount, 1);
    assert.equal(removed.argumentCount, 1);

    const missing = await executeMcpConfigCommand({
      action: "remove",
      configPath,
      name: "one",
    });
    assert.equal(missing.status, "not_found");
    assert.equal(missing.serverCount, 1);
  });
});

test("mcp enable and disable toggle one named server without changing its launch settings", async () => {
  await withConfig(async (configPath) => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: [
          { name: "files", command: "node", args: ["server.js"], enabled: true },
          { name: "other", command: "node" },
        ],
      }),
      "utf8",
    );

    const disabled = await executeMcpConfigCommand({
      action: "disable",
      configPath,
      name: "files",
    });
    assert.equal(disabled.status, "disabled");
    const afterDisable = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(afterDisable.mcpServers[0], {
      name: "files",
      command: "node",
      args: ["server.js"],
      enabled: false,
    });

    const enabled = await executeMcpConfigCommand({
      action: "enable",
      configPath,
      name: "files",
    });
    assert.equal(enabled.status, "enabled");
    const afterEnable = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(afterEnable.mcpServers[0], {
      name: "files",
      command: "node",
      args: ["server.js"],
      enabled: true,
    });
  });
});

test("mcp add can materialize a safe built-in template without storing credentials", async () => {
  await withConfig(async (configPath, root) => {
    const result = await executeMcpConfigCommand({
      action: "add",
      configPath,
      name: "workspace",
      template: "filesystem",
      workingDirectory: root,
    });
    assert.equal(result.status, "added");
    assert.equal(result.template, "filesystem");
    const stored = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(stored.mcpServers[0].name, "workspace");
    assert.equal(stored.mcpServers[0].command, "npx");
    assert.deepEqual(stored.mcpServers[0].args.slice(0, 2), [
      "-y",
      "@modelcontextprotocol/server-filesystem",
    ]);
    assert.equal(stored.mcpServers[0].args.at(-1), root);
    assert.equal("env" in stored.mcpServers[0], false);
  });
});

test("mcp management refuses to overwrite a symlinked config target", async () => {
  await withConfig(async (configPath, root) => {
    const target = join(root, "real.json");
    await writeFile(target, JSON.stringify({}), "utf8");
    await symlink(target, configPath);

    await assert.rejects(
      executeMcpConfigCommand({
        action: "add",
        configPath,
        name: "files",
        command: "node",
      }),
      /symbolic link/,
    );
  });
});
