import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatSession } from "../dist/chat-session.js";

const ENV_KEYS = [
  "DEV_AGENT_MODEL_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEV_AGENT_MEMORY_FILE",
];

function applyEnv(values: Record<string, string>): () => void {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  return () => {
    for (const key of ENV_KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  };
}

async function startProvider() {
  const requests: any[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "done" } }] })}\n\n` +
          "data: [DONE]\n\n",
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function systemPrompt(request: any): string {
  const message = request.messages.find((candidate) => candidate.role === "system");
  assert.ok(message, "the provider request should include a system message");
  return message.content;
}

test("Desktop uses the shared default prompt composer and keeps custom overrides", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-prompt-"));
  const provider = await startProvider();
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
  });
  const defaultSession = new ChatSession({
    workingDirectory: directory,
    memoryFilePath: join(directory, "default-session.json"),
  });
  const customSession = new ChatSession({
    workingDirectory: directory,
    memoryFilePath: join(directory, "custom-session.json"),
    systemPrompt: "custom system prompt",
  });

  try {
    await defaultSession.run("hello", () => undefined);
    await customSession.run("hello", () => undefined);

    assert.match(systemPrompt(provider.requests[0]), /desktop chat UI/i);
    assert.match(systemPrompt(provider.requests[1]), /^custom system prompt\n\nSession:/);
    assert.match(systemPrompt(provider.requests[1]), /Working directory:/);
  } finally {
    await defaultSession.close();
    await customSession.close();
    await provider.close();
    restoreEnv();
    await rm(directory, { recursive: true, force: true });
  }
});
