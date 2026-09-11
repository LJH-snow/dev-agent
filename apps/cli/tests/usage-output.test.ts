import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as any;
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-usage-"));

  try {
    const result: any = await new Promise((resolve) => {
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI appends the estimated cost when the config has prices", async () => {
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as any;
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-cost-"));
  const home = join(dir, "home");
  await mkdir(join(home, ".dev-agent"), { recursive: true });
  await writeFile(
    join(home, ".dev-agent", "config.json"),
    JSON.stringify({
      pricing: { "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 } },
    }),
    "utf8"
  );

  try {
    const result: any = await new Promise((resolve) => {
      const child = spawn("node", [cliPath, "--once", "hello", "--no-stream"], {
        env: {
          ...process.env,
          HOME: home,
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
    assert.match(
      result.stdout,
      /\[usage\] prompt=21 completion=8 total=29 cost=\$0\.00000795/
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
