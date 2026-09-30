import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  createAgentCard,
  startA2aServer,
  type A2aRuntimeFactory,
  type A2aRuntimeUpdate,
} from "../dist/index.js";

function messageBody(
  method: string,
  id: number,
  text = "hello",
  contextId?: string
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      message: {
        messageId: `message-${id}`,
        ...(contextId === undefined ? {} : { contextId }),
        role: "ROLE_USER",
        parts: [{ text }],
      },
    },
  };
}

function runtimeFactory(options: {
  readonly delay?: boolean;
  readonly onUpdate?: (update: A2aRuntimeUpdate) => void;
  readonly onAbort?: () => void;
} = {}): A2aRuntimeFactory {
  return {
    createSession: () => ({
      async run({ signal, emit }) {
        signal.addEventListener("abort", () => options.onAbort?.(), { once: true });
        options.onUpdate?.({ type: "reasoning", text: "thinking" });
        emit({ type: "reasoning", text: "thinking" });
        if (options.delay) {
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              signal.removeEventListener("abort", abort);
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            };
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
            void resolve;
          });
        }
        emit({ type: "text", text: "hello" });
      },
    }),
  };
}

async function withServer(
  runtime: A2aRuntimeFactory,
  options: {
    readonly authToken?: string;
    readonly exposeReasoning?: boolean;
    readonly maxBodyBytes?: number;
    readonly maxSseBytes?: number;
    readonly maxTextChars?: number;
  } = {}
): Promise<{
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}> {
  const started = await startA2aServer({
    agentCard: createAgentCard({
      name: "test-agent",
      version: "0.1.0",
      url: "http://127.0.0.1:0/",
      authRequired: options.authToken !== undefined,
    }),
    runtime,
    port: 0,
    ...options,
  });
  return {
    baseUrl: `http://${started.host}:${started.port}`,
    close: started.close,
  };
}

async function post(
  baseUrl: string,
  body: unknown
): Promise<{ readonly response: Response; readonly json: any }> {
  const response = await fetch(`${baseUrl}/`, {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "1.0" },
    body: JSON.stringify(body),
  });
  return { response, json: await response.json() };
}

function parseSseFrames(text: string): any[] {
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)));
}

function streamPayload(frame: any): { readonly kind: string; readonly data: any } | undefined {
  const result = frame.result;
  if (result === undefined || typeof result !== "object") return undefined;
  const kind = Object.keys(result)[0];
  return kind === undefined ? undefined : { kind, data: result[kind] };
}

test("publishes a bounded v1 agent card", async () => {
  const server = await withServer(runtimeFactory());
  try {
    const response = await fetch(`${server.baseUrl}/.well-known/agent-card.json`);
    assert.equal(response.status, 200);
    const card = (await response.json()) as Record<string, any>;
    assert.equal(card.name, "test-agent");
    assert.equal(card.supportedInterfaces[0].protocolVersion, "1.0");
    assert.equal(card.capabilities.pushNotifications, false);
    assert.equal(JSON.stringify(card).includes("127.0.0.1"), true);
  } finally {
    await server.close();
  }
});

test("handles SendMessage and GetTask with the v1 method names", async () => {
  const server = await withServer(runtimeFactory(), { exposeReasoning: true });
  try {
    const sent = await post(server.baseUrl, messageBody("SendMessage", 1));
    assert.equal(sent.response.status, 200);
    assert.equal(sent.json.error, undefined);
    const task = sent.json.result.task;
    assert.equal(task.status.state, "TASK_STATE_COMPLETED");
    assert.equal(task.artifacts.length, 2);
    assert.equal(
      task.artifacts[0].parts.map((part: { text?: string }) => part.text ?? "").join(""),
      "thinking"
    );
    assert.equal(
      task.artifacts[1].parts.map((part: { text?: string }) => part.text ?? "").join(""),
      "hello"
    );

    const loaded = await post(server.baseUrl, {
      jsonrpc: "2.0",
      id: 2,
      method: "GetTask",
      params: { id: task.id },
    });
    assert.equal(loaded.json.result.id, task.id);
    assert.equal(loaded.json.result.status.state, "TASK_STATE_COMPLETED");

    const listed = await post(server.baseUrl, {
      jsonrpc: "2.0",
      id: 8,
      method: "ListTasks",
      params: {
        contextId: task.contextId,
        includeArtifacts: false,
      },
    });
    assert.equal(listed.json.result.totalSize, 1);
    assert.equal(listed.json.result.tasks[0].id, task.id);
    assert.equal(listed.json.result.tasks[0].artifacts, undefined);

    const listedViaAlias = await post(server.baseUrl, {
      jsonrpc: "2.0",
      id: 9,
      method: "tasks/list",
      params: { contextId: task.contextId },
    });
    assert.equal(listedViaAlias.json.result.totalSize, 1);
  } finally {
    await server.close();
  }
});

test("does not expose reasoning artifacts unless explicitly enabled", async () => {
  const server = await withServer(runtimeFactory());
  try {
    const sent = await post(server.baseUrl, messageBody("SendMessage", 15));
    assert.equal(sent.response.status, 200);
    const task = sent.json.result.task;
    assert.equal(task.artifacts.length, 1);
    assert.equal(
      task.artifacts[0].parts.map((part: { text?: string }) => part.text ?? "").join(""),
      "hello"
    );
  } finally {
    await server.close();
  }
});

test("streams ordered task lifecycle events and one terminal completion", async () => {
  const server = await withServer(runtimeFactory());
  try {
    const response = await fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "a2a-version": "1.0",
      },
      body: JSON.stringify(messageBody("SendStreamingMessage", 3)),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    const frames = parseSseFrames(text);
    const payloads = frames.map((frame) => streamPayload(frame)?.kind ?? frame.error?.message);
    assert.equal(payloads[0], "task");
    assert.equal(payloads.includes("statusUpdate"), true);
    assert.equal(payloads.includes("artifactUpdate"), true);
    assert.equal(
      frames.filter(
        (frame) =>
          streamPayload(frame)?.kind === "statusUpdate" &&
          streamPayload(frame)?.data.status.state === "TASK_STATE_COMPLETED"
      ).length,
      1
    );
  } finally {
    await server.close();
  }
});

test("cancels an active task and publishes one canceled terminal event", async () => {
  const server = await withServer(runtimeFactory({ delay: true }));
  try {
    const streaming = fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "a2a-version": "1.0",
      },
      body: JSON.stringify(messageBody("SendStreamingMessage", 4)),
    });
    const response = await streaming;
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    let buffer = "";
    let taskId: string | undefined;
    while (taskId === undefined) {
      const next = await reader.read();
      assert.equal(next.done, false);
      buffer += decoder.decode(next.value, { stream: true });
      const frame = parseSseFrames(buffer)
        .map(streamPayload)
        .find((payload) => payload?.kind === "task");
      if (frame?.kind === "task") {
        taskId = frame.data.id;
      }
    }

    const canceled = await post(server.baseUrl, {
      jsonrpc: "2.0",
      id: 5,
      method: "CancelTask",
      params: { id: taskId },
    });
    assert.equal(canceled.json.result.status.state, "TASK_STATE_CANCELED");
    await reader.cancel();
  } finally {
    await server.close();
  }
});

test("rejects concurrent work for the same context instead of sharing a live session", async () => {
  const server = await withServer(runtimeFactory({ delay: true }));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const streaming = await fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "a2a-version": "1.0",
      },
      body: JSON.stringify(messageBody("SendStreamingMessage", 16, "first", "shared-context")),
    });
    assert.equal(streaming.status, 200);
    reader = streaming.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    let buffer = "";
    let firstTaskId: string | undefined;
    while (firstTaskId === undefined) {
      const next = await reader.read();
      assert.equal(next.done, false);
      buffer += decoder.decode(next.value, { stream: true });
      const task = parseSseFrames(buffer)
        .map(streamPayload)
        .find((payload) => payload?.kind === "task");
      if (task?.kind === "task") firstTaskId = task.data.id;
    }

    const concurrent = await post(
      server.baseUrl,
      messageBody("SendMessage", 17, "second", "shared-context")
    );
    assert.equal(concurrent.response.status, 200);
    assert.equal(concurrent.json.result.task.status.state, "TASK_STATE_FAILED");

    const canceled = await post(server.baseUrl, {
      jsonrpc: "2.0",
      id: 18,
      method: "CancelTask",
      params: { id: firstTaskId },
    });
    assert.equal(canceled.json.result.status.state, "TASK_STATE_CANCELED");
  } finally {
    await reader?.cancel().catch(() => undefined);
    await server.close();
  }
});

test("requires v1 headers and protects task operations with the configured bearer token", async () => {
  const server = await withServer(runtimeFactory(), { authToken: "test-token" });
  try {
    const card = await fetch(`${server.baseUrl}/.well-known/agent-card.json`);
    assert.equal(card.status, 200);
    const cardBody = (await card.json()) as {
      securitySchemes: Record<string, unknown>;
      securityRequirements: readonly unknown[];
    };
    assert.equal(typeof cardBody.securitySchemes.bearer, "object");
    assert.equal(cardBody.securityRequirements.length, 1);

    const unauthorized = await fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json", "a2a-version": "1.0" },
      body: JSON.stringify(messageBody("SendMessage", 10)),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const missingVersion = await fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify(messageBody("SendMessage", 11)),
    });
    assert.equal(missingVersion.status, 400);
    const missingVersionBody = (await missingVersion.json()) as {
      error: { message: string };
    };
    assert.equal(missingVersionBody.error.message, "A2A-Version header must be 1.0");

    const authorized = await fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "a2a-version": "1.0",
      },
      body: JSON.stringify(messageBody("SendMessage", 12)),
    });
    assert.equal(authorized.status, 200);
  } finally {
    await server.close();
  }
});

test("refuses non-loopback binds without an authentication token", async () => {
  await assert.rejects(
    () =>
      startA2aServer({
        agentCard: createAgentCard({
          name: "test-agent",
          version: "0.1.0",
          url: "http://0.0.0.0:0/",
        }),
        runtime: runtimeFactory(),
        host: "0.0.0.0",
        port: 0,
      }),
    /non-loopback A2A hosts require an authToken/
  );
});

test("aborts the runtime and emits an SSE error when the stream limit is reached", async () => {
  let aborted = false;
  const server = await withServer(
    runtimeFactory({ delay: true, onAbort: () => (aborted = true) }),
    { maxSseBytes: 128 }
  );
  try {
    const response = await fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "a2a-version": "1.0",
      },
      body: JSON.stringify(messageBody("SendStreamingMessage", 13)),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /stream exceeded the configured limit/);
    assert.equal(aborted, true);
  } finally {
    await server.close();
  }
});

test("rejects malformed, unknown, and oversized requests without leaking details", async () => {
  const server = await withServer(runtimeFactory(), { maxBodyBytes: 256 });
  try {
    const malformed = await fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    const malformedBody = (await malformed.json()) as { error: { message: string } };
    assert.equal(malformedBody.error.message, "invalid JSON request");

    const unknown = await post(server.baseUrl, {
      jsonrpc: "2.0",
      id: 6,
      method: "UnknownMethod",
      params: {},
    });
    assert.equal(unknown.json.error.code, -32601);
    assert.equal(unknown.json.error.message, "Invalid method.");

    const missingVersion = await fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(messageBody("GetTask", 14)),
    });
    assert.equal(missingVersion.status, 400);
    const missingVersionBody = (await missingVersion.json()) as {
      error: { message: string };
    };
    assert.equal(missingVersionBody.error.message, "A2A-Version header must be 1.0");

    const oversized = await fetch(`${server.baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json", "a2a-version": "1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "GetTask", params: { id: "x".repeat(500) } }),
    });
    assert.equal(oversized.status, 413);
    const oversizedBody = (await oversized.json()) as { error: { message: string } };
    assert.equal(oversizedBody.error.message, "request body exceeds the configured limit");
  } finally {
    await server.close();
  }
});
