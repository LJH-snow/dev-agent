import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ChatSession } from "../dist/chat-session.js";
import { startServer } from "../dist/server.js";

const ENV_KEYS = [
  "DEV_AGENT_MODEL_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEV_AGENT_MEMORY_FILE",
  "DEV_AGENT_MAX_CONTEXT_CHARS",
  "DEV_AGENT_SUMMARIZE_CONTEXT",
  "DEV_AGENT_SUMMARY_MAX_CHARS",
  "DEV_AGENT_APPROVAL",
  "DEV_AGENT_RUST_BINARY",
  "DEV_AGENT_MCP_SERVERS",
  "MCP_CANCEL_MARKER",
  "MCP_RESPONSE_DELAY_MS",
  "HOME",
];

const mcpFixture = fileURLToPath(
  new URL("../../../packages/mcp/tests/cancelable-mcp-server.mjs", import.meta.url)
);
const mcpCapabilityFixture = fileURLToPath(
  new URL("../../../packages/mcp/tests/fake-mcp-server.mjs", import.meta.url)
);

function applyEnv(values) {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value as string;
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as any;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function listen(server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return `http://127.0.0.1:${(server.address() as any).port}`;
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

function mcpToolCall(name: string) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "mcp-call-1",
              type: "function",
              function: { name, arguments: "{}" },
            },
          ],
        },
      },
    ],
  };
}

function mcpToolCallWithInput(name: string, input: unknown) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "mcp-call-1",
              type: "function",
              function: { name, arguments: JSON.stringify(input) },
            },
          ],
        },
      },
    ],
  };
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expected: string,
  timeoutMs = 3000
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (!text.includes(expected)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`did not observe ${JSON.stringify(expected)} within ${timeoutMs}ms`);
    }
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out waiting for ${JSON.stringify(expected)}`)), remaining)
      ),
    ]);
    if (result.done) {
      throw new Error(`SSE stream ended before ${JSON.stringify(expected)}`);
    }
    text += decoder.decode(result.value, { stream: true });
  }
  return text;
}

async function readSseToEnd(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialText: string
): Promise<string> {
  const decoder = new TextDecoder();
  let text = initialText;
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      return text + decoder.decode();
    }
    text += decoder.decode(result.value, { stream: true });
  }
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
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const controller = new AbortController();
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "run the command" }),
      signal: controller.signal,
    });
    assert.equal(response.status, 200);

    assert.ok(
      await waitFor(() => exists(startedMarker), 10_000),
      "the tool command should start"
    );

    controller.abort();
    await assert.rejects(() => response.text());

    // The command sleeps for a second before touching the second marker; if the
    // disconnect had not cancelled it, the marker would appear.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(await exists(finishedMarker), false, "the command should have been cancelled");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});


test("the desktop stream emits MCP progress between tool and tool-result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-mcp-progress-"));
  const provider = await startStubProvider((_parsed, count) =>
    count === 1
      ? [mcpToolCall("cancelable:progressive")]
      : [{ choices: [{ delta: { content: "done" } }] }]
  );
  const restoreEnv = applyEnv({
    DEV_AGENT_MCP_SERVERS: JSON.stringify([
      { name: "cancelable", command: process.execPath, args: [mcpFixture] },
    ]),
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });

  const session = new ChatSession({ sessionId: "default", workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "run the progressive tool" }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    const toolIndex = text.indexOf("event: tool\n");
    const progressIndex = text.indexOf("event: tool-progress\n");
    const resultIndex = text.indexOf("event: tool-result\n");
    assert.ok(toolIndex >= 0, "the MCP tool event should be present");
    assert.ok(progressIndex > toolIndex, "progress should follow the tool event");
    assert.ok(resultIndex > progressIndex, "the result should follow progress");
    assert.match(text, /data: {"name":"cancelable:progressive","progress":1,"total":3}/);
    assert.match(text, /data: {"name":"cancelable:progressive","progress":2,"total":3}/);
    assert.match(text, /data: {"name":"cancelable:progressive","progress":3,"total":3}/);
    assert.match(text, /event: done/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await session.close();
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("desktop exposes MCP resources and prompts through the agent capability set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-mcp-capabilities-"));
  const provider = await startStubProvider((_parsed, count) =>
    count === 1
      ? [
          mcpToolCallWithInput("capabilities:resource", {
            uri: "file:///tmp/hello.md",
          }),
        ]
      : [{ choices: [{ delta: { content: "resource consumed" } }] }]
  );
  const restoreEnv = applyEnv({
    DEV_AGENT_MCP_SERVERS: JSON.stringify([
      { name: "capabilities", command: process.execPath, args: [mcpCapabilityFixture] },
    ]),
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });

  const session = new ChatSession({ sessionId: "default", workingDirectory: dir });
  try {
    const events = [];
    await session.run("read the MCP resource", (event) => events.push(event), { mode: "plan" });

    const firstRequest = provider.requests[0];
    assert.ok(firstRequest, "the provider should receive the first turn");
    const toolNames = (firstRequest.tools ?? []).map(
      (tool) => tool.function?.name ?? tool.name ?? "",
    );
    assert.ok(toolNames.includes("capabilities:resource"));
    assert.ok(toolNames.includes("capabilities:prompt"));
    assert.ok(toolNames.includes("capabilities:hello"));

    const firstSystem = firstRequest.messages.find((message) => message.role === "system");
    assert.match(String(firstSystem?.content ?? ""), /Available MCP resources/);
    assert.match(String(firstSystem?.content ?? ""), /capabilities:resource/);
    assert.match(String(firstSystem?.content ?? ""), /Available MCP prompts/);
    assert.match(String(firstSystem?.content ?? ""), /capabilities:prompt summary/);

    const secondRequest = provider.requests[1];
    assert.ok(secondRequest, "the resource result should trigger a second turn");
    assert.ok(
      secondRequest.messages.some((message) =>
        String(message.content ?? "").includes("# Hello from resources"),
      ),
      "the MCP resource contents should be returned to the model",
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === "tool-result" &&
          String(event.data.output ?? "").includes("# Hello from resources"),
      ),
      "the Desktop stream should expose the resource tool result",
    );
  } finally {
    await session.close();
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("deny-dangerous blocks Desktop MCP action tools before server execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-mcp-action-approval-"));
  const provider = await startStubProvider((_parsed, count) =>
    count === 1
      ? [mcpToolCallWithInput("external:hello", { target: "production" })]
      : [{ choices: [{ delta: { content: "handled" } }] }]
  );
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });
  const session = new ChatSession({
    sessionId: "mcp-action-approval",
    workingDirectory: dir,
    approvalMode: "deny-dangerous",
    mcpServers: [{ name: "external", command: process.execPath, args: [mcpFixture] }],
  });

  try {
    const events = [];
    await session.run("publish the release", (event) => events.push(event));

    const secondRequest = provider.requests[1];
    assert.ok(secondRequest, "the denial should be returned to the model");
    const toolResults = secondRequest.messages.filter((message) => message.role === "tool");
    assert.equal(toolResults.length, 1);
    assert.match(String(toolResults[0]?.content), /denied by policy/);
    assert.doesNotMatch(String(toolResults[0]?.content), /hello/);
    assert.ok(
      events.some(
        (event) =>
          event.type === "tool-result" &&
          String(event.data.output ?? "").includes("denied by policy"),
      ),
      "the Desktop stream should report the policy denial",
    );
  } finally {
    await session.close();
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("desktop refreshes MCP tools, resources, and prompts after list_changed notifications", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-mcp-refresh-"));
  const provider = await startStubProvider((_parsed, count) =>
    count === 1
      ? [mcpToolCall("capabilities:notify")]
      : [{ choices: [{ delta: { content: `turn-${count}` } }] }]
  );
  const restoreEnv = applyEnv({
    DEV_AGENT_MCP_SERVERS: JSON.stringify([
      { name: "capabilities", command: process.execPath, args: [mcpCapabilityFixture] },
    ]),
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });

  const session = new ChatSession({ sessionId: "default", workingDirectory: dir });
  try {
    await session.run("refresh the MCP capabilities", () => undefined);

    const initialRequest = provider.requests[0];
    assert.ok(initialRequest, "the provider should receive the initial request");
    const initialToolNames = (initialRequest.tools ?? []).map(
      (tool) => tool.function?.name ?? tool.name ?? "",
    );
    assert.ok(initialToolNames.includes("capabilities:hello"));
    assert.ok(initialToolNames.includes("capabilities:env"));
    assert.ok(initialToolNames.includes("capabilities:notify"));

    await new Promise((resolve) => setTimeout(resolve, 700));
    await session.run("use the refreshed MCP capabilities", () => undefined);

    const refreshedRequest = provider.requests[2];
    assert.ok(refreshedRequest, "the provider should receive a request after the refresh");
    const refreshedToolNames = (refreshedRequest.tools ?? []).map(
      (tool) => tool.function?.name ?? tool.name ?? "",
    );
    assert.ok(refreshedToolNames.includes("capabilities:goodbye"));
    assert.ok(refreshedToolNames.includes("capabilities:status"));
    assert.ok(refreshedToolNames.includes("capabilities:revision"));
    assert.ok(!refreshedToolNames.includes("capabilities:hello"));
    assert.ok(!refreshedToolNames.includes("capabilities:env"));
    assert.ok(!refreshedToolNames.includes("capabilities:notify"));
    assert.equal(
      new Set(refreshedToolNames).size,
      refreshedToolNames.length,
      "the refreshed tool list should not contain duplicates",
    );

    const refreshedSystem = refreshedRequest.messages.find((message) => message.role === "system");
    const refreshedPrompt = String(refreshedSystem?.content ?? "");
    assert.match(refreshedPrompt, /capabilities:resource goodbye/);
    assert.match(refreshedPrompt, /capabilities:prompt rewrite/);
    assert.doesNotMatch(refreshedPrompt, /capabilities:resource hello/);
    assert.doesNotMatch(refreshedPrompt, /capabilities:prompt summary/);
  } finally {
    await session.close();
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("desktop cancel aborts MCP and emits aborted done without a late result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-mcp-cancel-"));
  const marker = join(dir, "cancel.jsonl");
  const provider = await startStubProvider((_parsed, count) =>
    count === 1
      ? [mcpToolCall("cancelable:progressive")]
      : [{ choices: [{ delta: { content: "unexpected second turn" } }] }]
  );
  const restoreEnv = applyEnv({
    DEV_AGENT_MCP_SERVERS: JSON.stringify([
      { name: "cancelable", command: process.execPath, args: [mcpFixture] },
    ]),
    MCP_CANCEL_MARKER: marker,
    MCP_RESPONSE_DELAY_MS: "500",
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });

  const session = new ChatSession({ sessionId: "default", workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "cancel the progressive tool" }),
    });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader, "the chat response should have a body");
    const partial = await readSseUntil(
      reader,
      '"name":"cancelable:progressive","progress":1'
    );

    const cancelled = await fetch(`${base}/api/chat/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "default" }),
    });
    assert.equal(cancelled.status, 200);
    assert.deepEqual(await cancelled.json(), { sessionId: "default", cancelled: true });

    const text = await readSseToEnd(reader, partial);
    assert.match(text, /event: done/);
    assert.match(text, /"status":"aborted"/);
    assert.doesNotMatch(text, /event: tool-result/);
    assert.ok(
      await waitFor(async () => {
        try {
          return (await readFile(marker, "utf8")).includes('"reason":"request aborted"');
        } catch {
          return false;
        }
      }),
      "the MCP fixture should receive cancellation"
    );
    assert.match(await readFile(marker, "utf8"), /"reason":"request aborted"/);

    // The fixture deliberately sends its response after cancellation; the
    // removed pending entry must keep that late response out of the SSE stream.
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.doesNotMatch(text, /progressive complete/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await session.close();
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
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the desktop stream reports the token usage of each turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-usage-"));
  await mkdir(join(dir, ".dev-agent"), { recursive: true });
  await writeFile(
    join(dir, ".dev-agent", "config.json"),
    JSON.stringify({
      pricing: { "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 } },
    }),
    "utf8"
  );
  const provider = await startStubProvider(() => [
    { choices: [{ delta: { content: "done" } }] },
    { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ]);
  const restoreEnv = applyEnv({
    HOME: dir,
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });

  const session = new ChatSession({ workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    const text = await response.text();

    assert.match(text, /event: usage/);
    assert.match(text, /"totalTokens":6/);
    assert.match(text, /"cost":0\.0000018/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ChatSession exposes a bounded metadata-only run trace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-trace-"));
  const provider = await startStubProvider(() => [
    { choices: [{ delta: { content: "trace-answer" } }] },
    { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ]);
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });
  const session = new ChatSession({ workingDirectory: dir });
  try {
    const events = [];
    await session.run("trace-prompt", (event) => events.push(event));

    const trace = session.getTraceSnapshot();
    assert.equal(trace.metadataOnly, true);
    assert.equal(trace.runs.length, 1);
    assert.equal(trace.runs[0]?.status, "completed");
    assert.equal(trace.runs[0]?.usage?.totalTokens, 6);
    assert.equal(trace.runs[0]?.spans.filter((span) => span.kind === "model").length, 1);
    assert.ok(events.some((event) => event.type === "done"));
    assert.doesNotMatch(JSON.stringify(trace), /trace-prompt|trace-answer|workingDirectory|secret/i);
  } finally {
    await session.close();
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("deny-dangerous blocks a dangerous tool call and reports it over SSE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-approval-"));
  const target = join(dir, "target.txt");
  await writeFile(target, "keep\n", "utf8");
  await chmod(target, 0o644);

  const provider = await startStubProvider((_parsed, count) =>
    count === 1
      ? [shellToolCall(`chmod 777 ${target}`)]
      : [{ choices: [{ delta: { content: "done" } }] }]
  );
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
    DEV_AGENT_APPROVAL: "deny-dangerous",
  });

  const session = new ChatSession({ workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "run it" }),
    });
    const text = await response.text();

    assert.match(text, /event: approval/);
    assert.match(text, /"decision":"deny"/);
    assert.equal((await stat(target)).mode & 0o777, 0o644, "the denied command must not run");

    const second = provider.requests[1];
    assert.ok(second, "the loop should continue after the denial");
    const contents = second.messages.map((message) => String(message.content ?? ""));
    assert.ok(
      contents.some((content) => content.includes("[denied by policy]")),
      "the model should see the denial"
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the default approval mode still runs that command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-approval-off-"));
  const target = join(dir, "target.txt");
  await writeFile(target, "keep\n", "utf8");
  await chmod(target, 0o644);

  const provider = await startStubProvider((_parsed, count) =>
    count === 1
      ? [shellToolCall(`chmod 777 ${target}`)]
      : [{ choices: [{ delta: { content: "done" } }] }]
  );
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  });

  const session = new ChatSession({ workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "run it" }),
    });
    const text = await response.text();

    assert.ok(!text.includes('"decision":"deny"'), "nothing should have been denied");
    assert.equal((await stat(target)).mode & 0o777, 0o777, "the command should have run");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the config file allowlist is honoured by the desktop session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-allow-"));
  const target = join(dir, "target.txt");
  await writeFile(target, "keep\n", "utf8");
  await chmod(target, 0o644);
  await mkdir(join(dir, ".dev-agent"), { recursive: true });
  await writeFile(
    join(dir, ".dev-agent", "config.json"),
    JSON.stringify({ approval: { allow: ["chmod 777"] } }),
    "utf8"
  );

  const provider = await startStubProvider((_parsed, count) =>
    count === 1
      ? [shellToolCall(`chmod 777 ${target}`)]
      : [{ choices: [{ delta: { content: "done" } }] }]
  );
  const restoreEnv = applyEnv({
    HOME: dir,
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
    DEV_AGENT_APPROVAL: "deny-dangerous",
  });

  const session = new ChatSession({ workingDirectory: dir });
  const server = await startServer({ session, host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "run it" }),
    });
    await response.text();

    assert.equal(
      (await stat(target)).mode & 0o777,
      0o777,
      "the allowlisted command should have run"
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.close();
    restoreEnv();
    await rm(dir, { recursive: true, force: true });
  }
});
