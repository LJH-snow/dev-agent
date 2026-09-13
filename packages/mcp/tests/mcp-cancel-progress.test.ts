import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpRequestError, McpStdioClient } from "../dist/index.js";

const cancelableServer = fileURLToPath(
  new URL("../tests/cancelable-mcp-server.mjs", import.meta.url)
);

async function createMarker(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-mcp-cancel-"));
  return { directory, path: join(directory, "cancelled.jsonl") };
}

async function waitForMarker(path: string): Promise<string> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      const contents = await readFile(path, "utf8");
      if (contents.trim()) {
        return contents;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`cancellation marker was not written: ${path}`);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connectOptions(marker: string, timeoutMs = 1000) {
  return {
    command: process.execPath,
    args: [cancelableServer],
    env: { MCP_CANCEL_MARKER: marker },
    timeoutMs,
  };
}

test("aborting an in-flight MCP tool sends cancellation and ignores its late response", async () => {
  const marker = await createMarker();
  const client = new McpStdioClient();
  try {
    await client.connect(connectOptions(marker.path));
    const controller = new AbortController();
    const call = client.callTool("progressive", {}, { signal: controller.signal });
    await delay(30);
    controller.abort();

    await assert.rejects(
      () => call,
      (error: unknown) => {
        assert.ok(error instanceof McpRequestError);
        assert.equal(error.code, -32001);
        assert.equal(error.message, 'MCP request "tools/call" was aborted');
        return true;
      }
    );

    assert.equal(client.pendingRequestCount, 0);
    const cancellation = JSON.parse((await waitForMarker(marker.path)).trim()) as {
      requestId: number;
      reason: string;
    };
    assert.equal(typeof cancellation.requestId, "number");
    assert.equal(cancellation.reason, "request aborted");

    await client.ping();
    await delay(250);
    assert.equal(client.pendingRequestCount, 0);
  } finally {
    await client.close();
    await rm(marker.directory, { recursive: true, force: true });
  }
});

test("an already-aborted MCP call sends neither a request nor a cancellation", async () => {
  const marker = await createMarker();
  const client = new McpStdioClient();
  try {
    await client.connect(connectOptions(marker.path));
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => client.callTool("progressive", {}, { signal: controller.signal }),
      (error: unknown) => {
        assert.ok(error instanceof McpRequestError);
        assert.equal(error.code, -32001);
        return true;
      }
    );

    assert.equal(client.pendingRequestCount, 0);
    await delay(100);
    await assert.rejects(() => readFile(marker.path, "utf8"));
    await client.ping();
  } finally {
    await client.close();
    await rm(marker.directory, { recursive: true, force: true });
  }
});

test("an MCP timeout sends cancellation while preserving the timeout error", async () => {
  const marker = await createMarker();
  const client = new McpStdioClient();
  try {
    await client.connect(connectOptions(marker.path, 50));
    await assert.rejects(
      () => client.callTool("progressive", {}),
      (error: unknown) => {
        assert.ok(error instanceof McpRequestError);
        assert.equal(error.code, -32000);
        assert.equal(error.message, 'MCP request "tools/call" timed out after 50ms');
        return true;
      }
    );

    assert.equal(client.pendingRequestCount, 0);
    const cancellation = JSON.parse((await waitForMarker(marker.path)).trim()) as {
      reason: string;
    };
    assert.equal(cancellation.reason, "request timed out");
  } finally {
    await client.close();
    await rm(marker.directory, { recursive: true, force: true });
  }
});

test("an MCP tool progress callback receives only its call's ordered updates", async () => {
  const marker = await createMarker();
  const client = new McpStdioClient();
  try {
    await client.connect(connectOptions(marker.path));
    const first: Array<{ progress: number; total?: number }> = [];
    const second: Array<{ progress: number; total?: number }> = [];
    const [firstResult, secondResult] = await Promise.all([
      client.callTool("progressive", {}, { onProgress: (value) => first.push(value) }),
      client.callTool("progressive", {}, { onProgress: (value) => second.push(value) }),
    ]);

    assert.equal(firstResult.content?.[0] && (firstResult.content[0] as any).text, "progressive complete");
    assert.equal(secondResult.content?.[0] && (secondResult.content[0] as any).text, "progressive complete");
    assert.deepEqual(first, [
      { progress: 1, total: 3 },
      { progress: 2, total: 3 },
      { progress: 3, total: 3 },
    ]);
    assert.deepEqual(second, first);
  } finally {
    await client.close();
    await rm(marker.directory, { recursive: true, force: true });
  }
});

test("an MCP progress callback error does not break the request or connection", async () => {
  const marker = await createMarker();
  const client = new McpStdioClient();
  try {
    await client.connect(connectOptions(marker.path));
    let callbackCount = 0;
    const result = await client.callTool("progressive", {}, {
      onProgress: () => {
        callbackCount += 1;
        throw new Error("callback failure must be isolated");
      },
    });

    assert.equal(callbackCount, 3);
    assert.equal((result.content?.[0] as any).text, "progressive complete");
    await client.ping();
  } finally {
    await client.close();
    await rm(marker.directory, { recursive: true, force: true });
  }
});
