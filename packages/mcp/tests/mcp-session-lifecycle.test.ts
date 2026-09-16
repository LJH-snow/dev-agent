import assert from "node:assert/strict";
import test from "node:test";

import { McpServerSession } from "../dist/session.js";

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    async connect() {},
    async listTools() { return []; },
    async listResources() { return []; },
    async listPrompts() { return []; },
    async callTool() { return { content: [] }; },
    async readResource() { return { uri: "" }; },
    async readResourceContents() { return []; },
    async getPrompt() { return { messages: [] }; },
    async ping() {},
    async close() {},
    getServerCapabilities() {
      return { tools: {}, resources: {}, prompts: {} };
    },
    getServerInfo() { return { name: "mock" }; },
    onNotification() {},
    async reconnect() {},
    ...overrides,
  };
}

test("connect closes the client when initial metadata refresh fails", async () => {
  let closeCalls = 0;
  const client = createClient({
    async listResources() {
      throw new Error("resource listing failed");
    },
    async close() {
      closeCalls += 1;
    },
  });
  const session = new McpServerSession({
    config: { command: "mock" },
    client,
  });

  await assert.rejects(() => session.connect(), /resource listing failed/);
  assert.equal(closeCalls, 1);
});

test("close clears queued metadata refreshes", async () => {
  let listToolsCalls = 0;
  let notify;
  const client = createClient({
    async listTools() {
      listToolsCalls += 1;
      return [];
    },
    onNotification(handler) {
      notify = handler;
    },
  });
  const session = new McpServerSession({
    config: { command: "mock" },
    client,
  });

  await session.connect();
  notify({ method: "tools/list_changed" });
  await session.close();
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.equal(listToolsCalls, 1);
});

test("a metadata result that arrives after close does not update the session", async () => {
  let listToolsCalls = 0;
  let notify;
  let resolveReload;
  let startReload;
  const reloadStarted = new Promise((resolve) => {
    startReload = resolve;
  });
  const client = createClient({
    async listTools() {
      listToolsCalls += 1;
      if (listToolsCalls === 1) {
        return [];
      }
      startReload();
      return new Promise((resolve) => {
        resolveReload = resolve;
      });
    },
    onNotification(handler) {
      notify = handler;
    },
  });
  const session = new McpServerSession({
    config: { command: "mock" },
    client,
  });
  const changes = [];
  session.onChange((snapshot) => changes.push(snapshot));

  await session.connect();
  changes.length = 0;
  notify({ method: "tools/list_changed" });
  await reloadStarted;
  await session.close();
  resolveReload([
    {
      name: "late-tool",
      description: "must not be applied",
      execute: async () => null,
    },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(changes.length, 0);
  assert.equal(session.getSnapshot().tools.length, 0);
});

test("connect skips metadata lists that the server did not advertise", async () => {
  const client = createClient({
    getServerCapabilities() {
      return { tools: {} };
    },
    async listResources() {
      throw new Error("resources/list must not be sent");
    },
    async listPrompts() {
      throw new Error("prompts/list must not be sent");
    },
  });
  const session = new McpServerSession({
    config: { command: "mock" },
    client,
  });

  const snapshot = await session.connect();

  assert.deepEqual(snapshot.tools, []);
  assert.deepEqual(snapshot.resources, []);
  assert.deepEqual(snapshot.prompts, []);
});
