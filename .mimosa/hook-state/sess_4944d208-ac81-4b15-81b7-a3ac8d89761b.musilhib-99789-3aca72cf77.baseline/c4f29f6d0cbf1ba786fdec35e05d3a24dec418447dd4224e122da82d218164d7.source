import assert from "node:assert/strict";
import test from "node:test";

import { McpServerSession } from "../dist/session.js";

function createMockClient(overrides = {}) {
  const handlers = [];
  return {
    handlers,
    connected: false,
    async connect() { this.connected = true; },
    async listTools() { return []; },
    async listResources() { return []; },
    async listPrompts() { return []; },
    async callTool() { return { content: [] }; },
    async readResource() { return { uri: "", text: "" }; },
    async readResourceContents() { return [{ uri: "", text: "" }]; },
    async getPrompt() { return { messages: [] }; },
    async ping() {},
    async close() { this.connected = false; },
    getServerCapabilities() { return {}; },
    getServerInfo() { return { name: "mock" }; },
    onNotification(handler) { handlers.push(handler); },
    async reconnect() { this.connected = true; },
    emit(n) { for (const h of handlers) h(n); },
    ...overrides,
  };
}

test("watchResource triggers callback on resources/updated notification", async () => {
  const client = createMockClient();
  const session = new McpServerSession({
    config: { command: "mock" },
    client: client,
  });

  const updates = [];
  const unwatch = session.watchResource("file:///doc.md", (uri) => {
    updates.push(uri);
  });

  await session.connect();

  client.emit({ method: "resources/updated", uri: "file:///doc.md" });

  assert.deepEqual(updates, ["file:///doc.md"]);

  unwatch();
  client.emit({ method: "resources/updated", uri: "file:///doc.md" });
  assert.deepEqual(updates, ["file:///doc.md"]);
});

test("watchResource triggers all watchers on resources/list_changed", async () => {
  const client = createMockClient();
  const session = new McpServerSession({
    config: { command: "mock" },
    client: client,
  });

  const updates = [];
  session.watchResource("file:///a.md", (uri) => updates.push(uri));
  session.watchResource("file:///b.md", (uri) => updates.push(uri));

  await session.connect();

  client.emit({ method: "resources/list_changed" });

  await new Promise((r) => setTimeout(r, 600));

  assert.deepEqual(updates, ["*", "*"]);
});

test("watchResource supports multiple watchers on same uri", async () => {
  const client = createMockClient();
  const session = new McpServerSession({
    config: { command: "mock" },
    client: client,
  });

  const calls = [];
  session.watchResource("file:///x.md", () => calls.push("first"));
  session.watchResource("file:///x.md", () => calls.push("second"));

  await session.connect();

  client.emit({ method: "resources/updated", uri: "file:///x.md" });

  assert.deepEqual(calls, ["first", "second"]);
});
