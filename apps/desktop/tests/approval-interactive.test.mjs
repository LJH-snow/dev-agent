import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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
  "DEV_AGENT_APPROVAL",
  "DEV_AGENT_APPROVAL_TIMEOUT_MS",
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
      const chunks = chunksFor(parsed, requests.length);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
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

function parseBlock(block) {
  let type = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      type = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      data += line.slice(6);
    }
  }
  if (!data) {
    return undefined;
  }
  return { type, data: JSON.parse(data) };
}

/** Reads the SSE stream, letting the caller react to events while it runs. */
async function streamEvents(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = parseBlock(block);
      if (event) {
        events.push(event);
        if (onEvent) {
          await onEvent(event);
        }
      }
    }
  }

  return events;
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-ask-"));
  const target = join(dir, "target.txt");
  await writeFile(target, "keep\n", "utf8");
  await chmod(target, 0o644);
  return { dir, target };
}

async function modeOf(path) {
  return (await stat(path)).mode & 0o777;
}

async function runAsk({ decision, timeoutMs, toolTurns = 1, toolCommand }) {
  const { dir, target } = await setup();
  const provider = await startStubProvider((_parsed, count) =>
    count <= toolTurns
      ? [shellToolCall(toolCommand ? toolCommand(target, count) : `chmod 777 ${target}`)]
      : [{ choices: [{ delta: { content: "done" } }] }]
  );
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
    DEV_AGENT_APPROVAL: "ask",
    ...(timeoutMs ? { DEV_AGENT_APPROVAL_TIMEOUT_MS: String(timeoutMs) } : {}),
  });

  const session = new ChatSession({ workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "run it" }),
    });

    let requests = 0;
    const events = await streamEvents(response, async (event) => {
      if (event.type !== "approval-request" || decision === undefined) {
        return;
      }
      requests += 1;
      const res = await fetch(`${base}/api/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: event.data.id, decision }),
      });
      assert.equal(res.status, 200);
    });

    return { events, target, provider, requests, mode: await modeOf(target) };
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
}

test("ask mode denies the call when the UI declines", async () => {
  const { events, mode, requests } = await runAsk({ decision: "deny" });

  assert.equal(requests, 1, "the UI should have been asked once");
  assert.ok(events.some((event) => event.type === "approval-request"));
  assert.ok(
    events.some((event) => event.type === "approval" && event.data.decision === "deny")
  );
  assert.notEqual(mode, 0o777, "the declined command must not run");
});

test("ask mode runs the call when the UI approves", async () => {
  const { events, mode } = await runAsk({ decision: "allow" });

  assert.ok(
    events.some((event) => event.type === "approval" && event.data.decision === "allow")
  );
  assert.equal(mode, 0o777, "the approved command should have run");
});

test("ask mode denies when the UI does not answer in time", async () => {
  const { events, mode, requests } = await runAsk({ decision: undefined, timeoutMs: 200 });

  assert.equal(requests, 0);
  assert.ok(events.some((event) => event.type === "approval-request"));
  assert.ok(
    events.some((event) => event.type === "approval" && event.data.decision === "deny")
  );
  assert.notEqual(mode, 0o777);
});

test("ask mode remembers an 'always allow' decision for the session", async () => {
  const { events, mode, requests } = await runAsk({
    decision: "allow-always",
    toolTurns: 2,
    // The same key with an extra flag must not prompt a second time.
    toolCommand: (target, turn) =>
      turn === 1 ? `chmod 777 ${target}` : `chmod -R 777 ${target}`,
  });

  assert.equal(requests, 1, "only the first call should prompt");
  assert.equal(
    events.filter((event) => event.type === "approval-request").length,
    1,
    "the second identical command must not prompt again"
  );
  assert.ok(
    events.some((event) => event.type === "approval" && event.data.decision === "allow")
  );
  assert.equal(mode, 0o777);
});

test("a client disconnect clears a pending approval", async () => {
  const { dir, target } = await setup();
  const provider = await startStubProvider(() => [shellToolCall(`chmod 777 ${target}`)]);
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
    DEV_AGENT_APPROVAL: "ask",
    DEV_AGENT_APPROVAL_TIMEOUT_MS: "60000",
  });
  const session = new ChatSession({ workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  const controller = new AbortController();
  let approvalId;

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "run it" }),
      signal: controller.signal,
    });

    try {
      await streamEvents(response, (event) => {
        if (event.type === "approval-request") {
          approvalId = event.data.id;
          controller.abort();
        }
      });
    } catch (error) {
      if (!approvalId) {
        throw error;
      }
    }

    assert.ok(approvalId, "an approval request should have been emitted");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await fetch(`${base}/api/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: approvalId, decision: "allow" }),
    });
    assert.equal(res.status, 404, "the disconnected approval must be dropped");
    assert.notEqual(await modeOf(target), 0o777, "the call must not run after a disconnect");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});
