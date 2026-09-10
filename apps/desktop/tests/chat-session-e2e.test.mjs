import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatSession } from "../dist/chat-session.js";
import { startServer } from "../dist/server.js";

const ENV_KEYS = [
  "DEV_AGENT_MODEL_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEV_AGENT_MEMORY_FILE",
  "DEV_AGENT_MAX_CONTEXT_CHARS",
  "DEV_AGENT_RUST_BINARY",
];

function applyEnv(values) {
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

function sse(chunks) {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

/** OpenAI-compatible streaming stub that records the bodies it receives. */
async function startStubProvider(chunksFor) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse(chunksFor(parsed, requests.length)));
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

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function shellToolCall(command) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: {
                name: "shell",
                arguments: JSON.stringify({ command: "/bin/sh", args: ["-c", command] }),
              },
            },
          ],
        },
      },
    ],
  };
}

test("disconnecting the client cancels the running tool command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-cancel-"));
  const startedMarker = join(dir, "started");
  const finishedMarker = join(dir, "finished");
  const provider = await startStubProvider(() => [
    shellToolCall(`touch ${startedMarker} && sleep 1 && touch ${finishedMarker}`),
  ]);
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });

  const session = new ChatSession({ workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1" });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const controller = new AbortController();
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "run the command" }),
      signal: controller.signal,
    });
    assert.equal(response.status, 200);

    assert.ok(await waitFor(() => exists(startedMarker)), "the tool command should start");

    controller.abort();
    await assert.rejects(() => response.text());

    // The command sleeps for a second before touching the second marker; if the
    // disconnect had not cancelled it, the marker would appear.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(await exists(finishedMarker), false, "the command should have been cancelled");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the desktop session sends a trimmed history when a budget is configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-budget-"));
  const entries = [];
  for (let index = 0; index < 12; index += 1) {
    entries.push({
      id: `entry-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `entry-${index}-${"x".repeat(200)}`,
      createdAt: new Date().toISOString(),
    });
  }
  const memoryFile = join(dir, "session.json");
  await writeFile(memoryFile, `${JSON.stringify({ version: 1, entries })}\n`, "utf8");

  const provider = await startStubProvider(() => [
    { choices: [{ delta: { content: "done" } }] },
  ]);
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: memoryFile,
    DEV_AGENT_MAX_CONTEXT_CHARS: "400",
  });

  const session = new ChatSession({ workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1" });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    await response.text();

    const [request] = provider.requests;
    assert.ok(request, "the provider should have been called");
    const contents = request.messages.map((message) => message.content);
    assert.ok(
      contents.some((content) => content.startsWith("[context]")),
      "a trimmed history should be announced"
    );
    assert.ok(
      !contents.some((content) => content.startsWith("entry-0-")),
      "the oldest entry should have been dropped"
    );
    assert.ok(
      contents.some((content) => content.startsWith("entry-11-")),
      "the newest entry should have been kept"
    );
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the desktop stream reports the token usage of each turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-usage-"));
  const provider = await startStubProvider(() => [
    { choices: [{ delta: { content: "done" } }] },
    { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ]);
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });

  const session = new ChatSession({ workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1" });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    const text = await response.text();

    assert.match(text, /event: usage/);
    assert.match(text, /"totalTokens":6/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});
