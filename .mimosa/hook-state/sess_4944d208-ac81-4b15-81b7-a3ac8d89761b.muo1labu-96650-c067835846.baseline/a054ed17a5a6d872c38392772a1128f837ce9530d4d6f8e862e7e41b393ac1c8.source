import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
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

async function listenStub(): Promise<{ server: Server; baseUrl: string }> {
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

test("interactive CLI routes :branch through the guarded Git workflow", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dev-agent-github-workflow-cli-"));
  const provider = await listenStub();
  const child = spawn(process.execPath, [cliPath, "--no-stream"], {
    cwd: workspace,
    env: {
      ...process.env,
      DEV_AGENT_MCP_SERVERS: "[]",
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: provider.baseUrl,
      DEV_AGENT_MEMORY_FILE: join(workspace, "session.json"),
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
    await execFileAsync("git", ["init", "--quiet"], { cwd: workspace });
    await writeFile(join(workspace, "README.md"), "workflow test\n", "utf8");
    await waitFor(() => stdout.includes("Type 'exit' or 'quit' to stop."));
    child.stdin.write(":branch\n");
    await waitFor(() => stdout.includes("Branch ") && stdout.includes("changed file"));
    assert.match(stdout, /no origin remote|github\.com remote/);
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
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closeServer(provider.server);
    await rm(workspace, { recursive: true, force: true });
  }
});
