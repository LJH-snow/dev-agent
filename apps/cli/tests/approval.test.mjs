import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

/** Stub provider: a tool call on the first request, a final answer afterwards. */
async function startStubProvider(toolInput) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const isFirst = requests.length === 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: isFirst
                ? {
                    content: "",
                    tool_calls: [
                      {
                        id: "call_1",
                        type: "function",
                        function: {
                          name: "shell",
                          arguments: JSON.stringify(toolInput),
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function runCli(args, env, input) {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env,
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
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-approval-"));
  const target = join(dir, "target.txt");
  await writeFile(target, "keep\n", "utf8");
  await chmod(target, 0o644);
  return { dir, target };
}

async function modeOf(path) {
  return (await stat(path)).mode & 0o777;
}

test("--approval deny-dangerous blocks a dangerous command and tells the model", async () => {
  const { dir, target } = await setup();
  const provider = await startStubProvider({ command: "chmod", args: ["777", target] });
  try {
    const result = await runCli(
      ["--once", "run it", "--no-stream", "--approval", "deny-dangerous"],
      {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: provider.baseUrl,
        DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
      }
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\[denied\] shell/);
    assert.notEqual(await modeOf(target), 0o777, "the denied command must not run");

    const second = provider.requests[1];
    assert.ok(second, "the loop should have continued after the denial");
    const contents = second.messages.map((message) => String(message.content ?? ""));
    assert.ok(
      contents.some((content) => content.includes("[denied by policy]")),
      "the model should see the denial"
    );
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("--approval ask denies the command when the answer is not y", async () => {
  const { dir, target } = await setup();
  const provider = await startStubProvider({ command: "chmod", args: ["777", target] });
  try {
    const result = await runCli(
      ["--once", "run it", "--no-stream", "--approval", "ask"],
      {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: provider.baseUrl,
        DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
      },
      "n\n"
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /Run shell anyway\?/);
    assert.notEqual(await modeOf(target), 0o777);
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("--approval ask runs the command when the answer starts with y", async () => {
  const { dir, target } = await setup();
  const provider = await startStubProvider({ command: "chmod", args: ["777", target] });
  try {
    const result = await runCli(
      ["--once", "run it", "--no-stream", "--approval", "ask"],
      {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: provider.baseUrl,
        DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
      },
      "y\n"
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await modeOf(target), 0o777, "the approved command should have run");
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});
