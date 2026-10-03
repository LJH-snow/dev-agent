import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createA2aSessionId } from "../dist/a2a-server.js";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = join(cliRoot, "dist", "index.js");

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function waitForA2aStartup(
  child: ReturnType<typeof spawn>,
  stderr: () => string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`A2A startup timed out: ${stderr()}`));
    }, 10_000);
    const poll = (): void => {
      if (stderr().includes("A2A server listening at")) {
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (child.exitCode !== null) {
        clearTimeout(timeout);
        reject(new Error(`A2A process exited with ${child.exitCode}: ${stderr()}`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

test("A2A context IDs retain distinct bounded session keys", () => {
  assert.notEqual(createA2aSessionId("foo/bar"), createA2aSessionId("foo-bar"));
  assert.notEqual(createA2aSessionId("FOO-BAR"), createA2aSessionId("foo-bar"));
  assert.match(createA2aSessionId("context"), /^a2a-context-[0-9a-f]{16}$/);
});

test("CLI --a2a serves an agent card and includes project instructions in provider turns", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-agent-a2a-cli-"));
  await mkdir(join(cwd, ".git"));
  await writeFile(join(cwd, "AGENTS.md"), "A2A project instruction", "utf8");
  let providerMessages: readonly { readonly role?: string; readonly content?: string }[] = [];
  const provider = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body) as {
        readonly messages?: readonly { readonly role?: string; readonly content?: string }[];
      };
      providerMessages = parsed.messages ?? [];
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-ndjson");
      response.write(`${JSON.stringify({ message: { content: "hello from a2a" } })}\n`);
      response.end(
        `${JSON.stringify({
          done: true,
          prompt_eval_count: 2,
          eval_count: 3,
        })}\n`
      );
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const providerAddress = provider.address();
  assert.ok(providerAddress && typeof providerAddress !== "string");
  const a2aPort = await freePort();
  const child = spawn(
    process.execPath,
    [
      cliEntry,
      "--a2a",
      "--cwd",
      cwd,
      "--host",
      "127.0.0.1",
      "--port",
      String(a2aPort),
    ],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_CONFIG_FILE: join(cwd, "missing-config.json"),
        DEV_AGENT_MEMORY_FILE: join(cwd, "memory.json"),
        DEV_AGENT_OLLAMA_BASE_URL: `http://127.0.0.1:${providerAddress.port}`,
      },
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForA2aStartup(child, () => stderr);
    const cardResponse = await fetch(
      `http://127.0.0.1:${a2aPort}/.well-known/agent-card.json`
    );
    assert.equal(cardResponse.status, 200);
    const card = (await cardResponse.json()) as Record<string, unknown>;
    assert.equal(card.name, "dev-agent");

    const response = await fetch(`http://127.0.0.1:${a2aPort}/`, {
      method: "POST",
      headers: { "content-type": "application/json", "a2a-version": "1.0" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendMessage",
        params: {
          message: {
            messageId: "a2a-cli-test-message",
            role: "ROLE_USER",
            parts: [{ text: "say hello" }],
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      result: {
        task: {
          status: {
            state: string;
            message?: { parts?: readonly { text?: string }[] };
          };
        };
      };
    };
    assert.equal(body.result.task.status.state, "TASK_STATE_COMPLETED");
    assert.equal(body.result.task.status.message?.parts?.[0]?.text, "hello from a2a");
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  }

  assert.equal(stdout, "");
  assert.match(stderr, /A2A server listening at http:\/\/127\.0\.0\.1:/);
  const system = providerMessages.filter((message) => message.role === "system")
    .map((message) => message.content ?? "").join("\n");
  assert.match(system, /A2A project instruction/);
  assert.match(system, /Active project root:/);
});

test("CLI --a2a streams reasoning and answer events from a real provider", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-agent-a2a-cli-"));
  const provider = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/x-ndjson");
    response.write(`${JSON.stringify({ message: { thinking: "checking" } })}\n`);
    response.write(`${JSON.stringify({ message: { content: "hello from stream" } })}\n`);
    response.end(
      `${JSON.stringify({
        done: true,
        prompt_eval_count: 2,
        eval_count: 3,
      })}\n`
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const providerAddress = provider.address();
  assert.ok(providerAddress && typeof providerAddress !== "string");
  const a2aPort = await freePort();
  const child = spawn(
    process.execPath,
    [
      cliEntry,
      "--a2a",
      "--cwd",
      cwd,
      "--host",
      "127.0.0.1",
      "--port",
      String(a2aPort),
    ],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_CONFIG_FILE: join(cwd, "missing-config.json"),
        DEV_AGENT_MEMORY_FILE: join(cwd, "memory.json"),
        DEV_AGENT_OLLAMA_BASE_URL: `http://127.0.0.1:${providerAddress.port}`,
      },
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForA2aStartup(child, () => stderr);
    const response = await fetch(`http://127.0.0.1:${a2aPort}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "a2a-version": "1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "SendStreamingMessage",
        params: {
          message: {
            messageId: "a2a-cli-stream-test-message",
            role: "ROLE_USER",
            parts: [{ text: "say hello with reasoning" }],
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /TASK_STATE_SUBMITTED/);
    assert.doesNotMatch(body, /checking/);
    assert.match(body, /hello from stream/);
    assert.match(body, /TASK_STATE_COMPLETED/);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  }

  assert.equal(stdout, "");
  assert.match(stderr, /A2A server listening at http:\/\/127\.0\.0\.1:/);
});

test("CLI --a2a cancels a live provider task and closes the provider stream", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-agent-a2a-cli-"));
  let providerStarted!: () => void;
  const providerStartedPromise = new Promise<void>((resolve) => {
    providerStarted = resolve;
  });
  let providerClosed!: () => void;
  const providerClosedPromise = new Promise<void>((resolve) => {
    providerClosed = resolve;
  });
  const provider = createServer((_request, response) => {
    providerStarted();
    response.statusCode = 200;
    response.setHeader("content-type", "application/x-ndjson");
    response.write(`${JSON.stringify({ message: { thinking: "working" } })}\n`);
    const keepAlive = setInterval(() => {
      response.write(`${JSON.stringify({ message: { thinking: "still working" } })}\n`);
    }, 25);
    response.on("close", () => {
      clearInterval(keepAlive);
      providerClosed();
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const providerAddress = provider.address();
  assert.ok(providerAddress && typeof providerAddress !== "string");
  const a2aPort = await freePort();
  const child = spawn(
    process.execPath,
    [
      cliEntry,
      "--a2a",
      "--cwd",
      cwd,
      "--host",
      "127.0.0.1",
      "--port",
      String(a2aPort),
    ],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_CONFIG_FILE: join(cwd, "missing-config.json"),
        DEV_AGENT_MEMORY_FILE: join(cwd, "memory.json"),
        DEV_AGENT_OLLAMA_BASE_URL: `http://127.0.0.1:${providerAddress.port}`,
      },
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out`)), 5_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await waitForA2aStartup(child, () => stderr);
    const response = await fetch(`http://127.0.0.1:${a2aPort}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "a2a-version": "1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "SendStreamingMessage",
        params: {
          message: {
            messageId: "a2a-cli-cancel-test-message",
            role: "ROLE_USER",
            parts: [{ text: "keep working" }],
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    reader = response.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    let buffer = "";
    let streamBody = "";
    let taskId: string | undefined;
    while (taskId === undefined) {
      const next = await withTimeout(reader.read(), "A2A task event");
      assert.equal(next.done, false);
      const chunk = decoder.decode(next.value, { stream: true });
      buffer += chunk;
      streamBody += chunk;
      for (const frame of buffer.split("\n\n")) {
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (dataLine === undefined) continue;
        try {
          const event = JSON.parse(dataLine.slice("data: ".length)) as {
            result?: { task?: { id?: unknown } };
          };
          const candidate = event.result?.task?.id;
          if (typeof candidate === "string") {
            taskId = candidate;
            break;
          }
        } catch {
          // Keep partial SSE frames in the buffer until the next read.
        }
      }
      const lastBoundary = buffer.lastIndexOf("\n\n");
      if (lastBoundary >= 0) buffer = buffer.slice(lastBoundary + 2);
    }

    await withTimeout(providerStartedPromise, "provider start");
    const canceled = await fetch(`http://127.0.0.1:${a2aPort}/`, {
      method: "POST",
      headers: { "content-type": "application/json", "a2a-version": "1.0" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "CancelTask",
        params: { id: taskId },
      }),
    });
    assert.equal(canceled.status, 200);
    const canceledBody = (await canceled.json()) as {
      result: { status: { state: string } };
    };
    assert.equal(canceledBody.result.status.state, "TASK_STATE_CANCELED");

    while (true) {
      const next = await withTimeout(reader.read(), "A2A canceled stream");
      if (next.done) break;
      streamBody += decoder.decode(next.value, { stream: true });
    }
    assert.match(streamBody, /TASK_STATE_CANCELED/);
    await withTimeout(providerClosedPromise, "provider abort");
  } finally {
    await reader?.cancel().catch(() => undefined);
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });
    provider.closeAllConnections?.();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  }

  assert.equal(stdout, "");
  assert.match(stderr, /A2A server listening at http:\/\/127\.0\.0\.1:/);
});
