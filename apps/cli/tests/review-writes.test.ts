import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

async function startStubProvider(target: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  let requests = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests += 1;
      const parsed = JSON.parse(body);
      const hasToolResult = parsed.messages.some((message: any) => message.role === "tool");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message:
                requests === 1 && !hasToolResult
                  ? {
                      content: "",
                      tool_calls: [
                        {
                          id: "call_review_write",
                          type: "function",
                          function: {
                            name: "filesystem",
                            arguments: JSON.stringify({
                              action: "write",
                              path: target,
                              content: "changed\n",
                            }),
                          },
                        },
                      ],
                    }
                  : { content: "done" },
            },
          ],
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as any;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(input);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withWorkspace(run: (dir: string, target: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-review-cli-"));
  const target = join(dir, "target.txt");
  await writeFile(target, "keep\n", "utf8");
  try {
    await run(dir, target);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function environment(dir: string, providerBaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    INIT_CWD: dir,
    DEV_AGENT_MODEL_PROVIDER: "openai",
    DEV_AGENT_MCP_SERVERS: "[]",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: providerBaseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  };
}

test("review-writes shows the real unified diff and leaves files unchanged on deny", async () => {
  await withWorkspace(async (dir, target) => {
    const provider = await startStubProvider(target);
    try {
      const result = await runCli(
        ["--once", "change the file", "--no-stream", "--approval", "review-writes"],
        environment(dir, provider.baseUrl),
        "n\n"
      );

      assert.equal(result.code, 0, result.stderr);
      assert.equal(await readFile(target, "utf8"), "keep\n");
      assert.match(result.stderr, /Change set [0-9a-f-]{36}/);
      assert.match(result.stderr, /--- a\//);
      assert.match(result.stderr, /\+\+\+ b\//);
      assert.match(result.stderr, /-keep/);
      assert.match(result.stderr, /\+changed/);
      assert.match(result.stderr, /Apply this change\? \[y\/N\]/);
    } finally {
      await provider.close();
    }
  });
});

test("review-writes records the approved review in JSON and applies the change", async () => {
  await withWorkspace(async (dir, target) => {
    const provider = await startStubProvider(target);
    try {
      const result = await runCli(
        ["--once", "change the file", "--no-stream", "--json", "--approval", "review-writes"],
        environment(dir, provider.baseUrl),
        "y\n"
      );

      assert.equal(result.code, 0, result.stderr);
      assert.equal(await readFile(target, "utf8"), "changed\n");
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.content, "done");
      assert.ok(Array.isArray(payload.reviews));
      assert.equal(payload.reviews.length, 1);
      const [review] = payload.reviews;
      assert.match(review.changeSetId, /^[0-9a-f-]{36}$/);
      assert.equal(review.decision, "allow");
      assert.equal(review.additions, 1);
      assert.equal(review.deletions, 1);
      assert.equal(review.files.length, 1);
      assert.equal(review.files[0].path, target);
      assert.match(review.files[0].diff, /-keep/);
      assert.match(review.files[0].diff, /\+changed/);
      assert.match(result.stdout.trim(), /^\{.*\}$/s, "JSON mode must emit one JSON value");
    } finally {
      await provider.close();
    }
  });
});
