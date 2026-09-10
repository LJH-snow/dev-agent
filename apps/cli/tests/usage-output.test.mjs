import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

test("CLI prints the token usage the provider reported", async () => {
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "done" } }],
          usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 },
        })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-usage-"));

  try {
    const result = await new Promise((resolve) => {
      const child = spawn("node", [cliPath, "--once", "hello", "--no-stream"], {
        env: {
          ...process.env,
          DEV_AGENT_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key",
          OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
          DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
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
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\[usage\] prompt=21 completion=8 total=29/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
