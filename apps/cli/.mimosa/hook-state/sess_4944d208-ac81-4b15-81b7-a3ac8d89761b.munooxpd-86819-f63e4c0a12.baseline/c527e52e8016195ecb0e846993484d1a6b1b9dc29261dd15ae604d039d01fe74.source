import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition was not met before the timeout");
}

async function startProvider(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

test("interactive CLI persists confirmed project memory and searches it", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dev-agent-project-memory-cli-"));
  const provider = await startProvider();
  const memoryFile = join(workspace, "project-memory.json");
  const child = spawn(process.execPath, [cliPath, "--no-stream"], {
    cwd: workspace,
    env: {
      ...process.env,
      DEV_AGENT_MCP_SERVERS: "[]",
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: provider.baseUrl,
      DEV_AGENT_MEMORY_FILE: join(workspace, "session.json"),
      DEV_AGENT_PROJECT_MEMORY_FILE: memoryFile,
      INIT_CWD: workspace,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    await waitFor(() => stdout.includes("Type 'exit' or 'quit' to stop."));
    child.stdin.write(':memory add --source docs --confidence high "Run focused tests"\n');
    await waitFor(() => stdout.includes("Save project memory"), 10_000).catch(() => { throw new Error(`save prompt missing; output=${stdout}; error=${stderr}`); });
    child.stdin.write("y\n");
    await waitFor(() => stdout.includes("Saved project memory memory-"));
    child.stdin.write(":memory search focused\n");
    await waitFor(() => stdout.includes("Project memory search · focused") && stdout.includes("Run focused tests"));
    child.stdin.write("exit\n");
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`CLI did not exit. stderr=${stderr}`));
      }, 10_000);
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    assert.equal(code, 0, stderr);
    const stored = JSON.parse(await readFile(memoryFile, "utf8")) as {
      readonly records?: readonly { readonly source?: string; readonly confidence?: string }[];
    };
    assert.deepEqual(stored.records?.[0] && {
      source: stored.records[0].source,
      confidence: stored.records[0].confidence,
    }, { source: "docs", confidence: "high" });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closeServer(provider.server);
    await rm(workspace, { recursive: true, force: true });
  }
});
