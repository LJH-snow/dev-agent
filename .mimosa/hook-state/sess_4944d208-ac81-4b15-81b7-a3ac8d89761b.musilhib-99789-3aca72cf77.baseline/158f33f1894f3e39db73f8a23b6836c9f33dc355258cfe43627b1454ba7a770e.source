import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ChatSession } from "../dist/chat-session.js";

const ENV_KEYS = [
  "DEV_AGENT_MODEL_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEV_AGENT_MEMORY_FILE",
];

const mcpFixture = fileURLToPath(
  new URL("../../../packages/mcp/tests/fake-mcp-server.mjs", import.meta.url)
);

function applyEnv(values: Record<string, string>): () => void {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return () => {
    for (const key of ENV_KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  };
}

function sse(content: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
}

async function startProvider() {
  const requests: Array<Record<string, any>> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(sse("recovered"));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("failed MCP startup removes capabilities registered before the failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-mcp-cleanup-"));
  const provider = await startProvider();
  const servers = [
    {
      name: "good",
      command: process.execPath,
      args: [mcpFixture],
    },
    {
      name: "bad",
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
    },
  ];
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(directory, "session.json"),
  });
  const session = new ChatSession({
    sessionId: "cleanup",
    workingDirectory: directory,
    mcpServers: servers,
  });

  try {
    await assert.rejects(
      () => session.run("trigger MCP startup", () => undefined),
      /MCP server exited|closed|write/i
    );

    servers.splice(0);
    await session.run("run without MCP", () => undefined);

    const request = provider.requests[0];
    assert.ok(request, "the recovered run should reach the provider");
    const toolNames = (request.tools ?? []).map(
      (tool: any) => tool.function?.name ?? tool.name ?? ""
    );
    assert.equal(
      toolNames.some((name: string) => name.startsWith("good:")),
      false,
      "capabilities from the failed startup must not remain registered",
    );
  } finally {
    await session.close();
    await provider.close();
    restoreEnv();
    await rm(directory, { recursive: true, force: true });
  }
});
