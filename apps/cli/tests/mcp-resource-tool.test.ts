import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");
const mcpFixture = fileURLToPath(
  new URL("../../../packages/mcp/tests/fake-mcp-server.mjs", import.meta.url)
);

/**
 * First turn: ask the model to call the MCP resource tool. Second turn: echo
 * back the tool result it received, so the test can assert on what the model
 * was actually given.
 */
async function startStubProvider(uri: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      const isFirst = !parsed.messages.some((message: any) => message.role === "tool");
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
                          name: "fake:resource",
                          arguments: JSON.stringify({ uri }),
                        },
                      },
                    ],
                  }
                : {
                    content: parsed.messages
                      .filter((message: any) => message.role === "tool")
                      .map((message: any) => String(message.content))
                      .join("\n"),
                  },
            },
          ],
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as any;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function runCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
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
}

test("the MCP resource tool hands the model every content block", async () => {
  const uri = "file:///tmp/multi.txt";
  const provider = await startStubProvider(uri);
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-mcp-resource-"));
  try {
    const result = await runCli(["--once", "read the resource", "--no-stream"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: provider.baseUrl,
      DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
      DEV_AGENT_MCP_SERVERS: JSON.stringify([
        { name: "fake", command: process.execPath, args: [mcpFixture] },
      ]),
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /FIRST-PART/);
    assert.match(result.stdout, /SECOND-PART/, "the second block must reach the model");
    assert.match(result.stdout, /THIRD-PART/, "the third block must reach the model");
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});
