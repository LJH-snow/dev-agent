import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

function spawnServer(env, extraArgs = []) {
  const child = spawn("node", [cliPath, "--mcp-server", ...extraArgs], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const send = startHost(child);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, send, stderr: () => stderr };
}

async function closeServer(child) {
  child.stdin.end();
  await new Promise<void>((resolve) => child.on("close", () => resolve()));
}

/** Minimal MCP host: writes newline-delimited JSON-RPC and matches responses by id. */
function startHost(child) {
  let buffer = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line);
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  });

  return (message) =>
    new Promise<any>((resolve) => {
      pending.set(message.id, resolve);
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });
}

test("CLI --mcp-server serves its built-in tools to a host over stdio", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-server-"));
  const file = join(dir, "note.txt");
  await writeFile(file, "hello from mcp\n", "utf8");

  const child = spawn("node", [cliPath, "--mcp-server"], {
    env: { ...process.env, DEV_AGENT_MEMORY_FILE: join(dir, "session.json") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const send = startHost(child);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const initialize = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(initialize.result.serverInfo.name, "dev-agent");
    assert.equal(initialize.result.protocolVersion, "2024-11-05");

    const list = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = list.result.tools.map((tool) => tool.name);
    for (const expected of ["filesystem", "shell", "git", "search", "code-search"]) {
      assert.ok(names.includes(expected), `expected ${expected} in ${names.join(", ")}`);
    }

    const call = await send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "filesystem", arguments: { action: "read", path: file } },
    });
    assert.equal(call.result.isError, undefined);
    assert.match(call.result.content[0].text, /hello from mcp/);

    const failure = await send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "filesystem",
        arguments: { action: "read", path: join(dir, "missing.txt") },
      },
    });
    assert.equal(failure.result.isError, true);

    const resources = await send({ jsonrpc: "2.0", id: 5, method: "resources/list" });
    const uris = resources.result.resources.map((resource) => resource.uri);
    assert.ok(uris.includes("dev-agent://session"), `expected the session resource in ${uris}`);
    assert.ok(uris.includes("dev-agent://workspace"), `expected the workspace resource in ${uris}`);

    const sessionResource = await send({
      jsonrpc: "2.0",
      id: 6,
      method: "resources/read",
      params: { uri: "dev-agent://session" },
    });
    assert.match(sessionResource.result.contents[0].text, /session: default/);

    const prompts = await send({ jsonrpc: "2.0", id: 7, method: "prompts/list" });
    const promptNames = prompts.result.prompts.map((prompt) => prompt.name);
    assert.ok(promptNames.includes("review-changes"));
    assert.ok(promptNames.includes("explain-codebase"));

    const prompt = await send({
      jsonrpc: "2.0",
      id: 8,
      method: "prompts/get",
      params: { name: "explain-codebase", arguments: { focus: "the executor" } },
    });
    assert.match(prompt.result.messages[0].content.text, /the executor/);
  } finally {
    child.stdin.end();
    await new Promise<void>((resolve) => child.on("close", () => resolve()));
    assert.equal(stderr, "");
    await rm(dir, { recursive: true, force: true });
  }
});

test("--approval deny-dangerous gates MCP tool calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-approval-"));
  const outside = join(dir, "outside.txt");
  const { child, send, stderr } = spawnServer(
    { DEV_AGENT_MEMORY_FILE: join(dir, "session.json") },
    ["--approval", "deny-dangerous"]
  );

  try {
    await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

    const denied = await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "filesystem",
        arguments: { action: "write", path: outside, content: "nope" },
      },
    });
    assert.equal(denied.result.isError, true);
    assert.match(denied.result.content[0].text, /denied by approval policy/);
    assert.equal(existsSync(outside), false, "a denied write must not reach disk");

    const allowed = await send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "shell", arguments: { command: "echo", args: ["ok"] } },
    });
    assert.equal(allowed.result.isError, undefined);
    assert.match(allowed.result.content[0].text, /ok/);
  } finally {
    await closeServer(child);
    assert.equal(stderr(), "");
    await rm(dir, { recursive: true, force: true });
  }
});

test("--approval allow keeps MCP tool calls ungated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-allow-"));
  const outside = join(dir, "outside.txt");
  const { child, send, stderr } = spawnServer(
    { DEV_AGENT_MEMORY_FILE: join(dir, "session.json") },
    ["--approval", "allow"]
  );

  try {
    await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

    const call = await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "filesystem",
        arguments: { action: "write", path: outside, content: "written" },
      },
    });
    assert.equal(call.result.isError, undefined);
    assert.equal(await readFile(outside, "utf8"), "written");
  } finally {
    await closeServer(child);
    assert.equal(stderr(), "");
    await rm(dir, { recursive: true, force: true });
  }
});

test("the approval allowlist is honoured by the MCP server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-allowlist-"));
  const home = join(dir, "home");
  const target = join(dir, "mode.txt");
  await mkdir(join(home, ".dev-agent"), { recursive: true });
  await writeFile(
    join(home, ".dev-agent", "config.json"),
    JSON.stringify({ approval: { allow: ["chmod 777"] } }),
    "utf8"
  );
  await writeFile(target, "x", "utf8");

  const { child, send, stderr } = spawnServer(
    { HOME: home, DEV_AGENT_MEMORY_FILE: join(dir, "session.json") },
    ["--approval", "deny-dangerous"]
  );

  try {
    await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

    const call = await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "shell", arguments: { command: "chmod", args: ["777", target] } },
    });
    assert.equal(call.result.isError, undefined);
    assert.equal((await stat(target)).mode & 0o777, 0o777);
  } finally {
    await closeServer(child);
    assert.equal(stderr(), "");
    await rm(dir, { recursive: true, force: true });
  }
});
