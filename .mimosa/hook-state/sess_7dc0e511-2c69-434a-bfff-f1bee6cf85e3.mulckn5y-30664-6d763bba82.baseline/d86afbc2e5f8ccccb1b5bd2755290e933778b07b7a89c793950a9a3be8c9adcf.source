import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = join(fileURLToPath(new URL("..", import.meta.url)), "dist", "index.js");
async function startProvider(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}
function waitFor(text: () => string, expected: string, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (text().includes(expected)) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`missing ${expected}; output=${text()}`));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test("interactive CLI auto-routes greetings and allows an explicit manual override", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dev-agent-route-cli-"));
  const provider = await startProvider();
  const child = spawn(process.execPath, [cliPath, "--no-stream"], {
    cwd: workspace,
    env: { ...process.env, DEV_AGENT_MCP_SERVERS: "[]", DEV_AGENT_MODEL_PROVIDER: "openai", OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: provider.baseUrl, INIT_CWD: workspace },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  try {
    await waitFor(() => stdout, "Type 'exit' or 'quit' to stop.");
    child.stdin.write("hi\n");
    await waitFor(() => stdout, "[state=done turns=1]");
    child.stdin.write(":mode deep\n");
    await waitFor(() => stdout, "Speed mode: deep");
    child.stdin.write(":route\n");
    await waitFor(() => stdout, "Routing: manual · mode=deep");
    child.stdin.write("exit\n");
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    assert.equal(code, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    provider.server.closeAllConnections?.();
    await new Promise<void>((resolve) => provider.server.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
});
