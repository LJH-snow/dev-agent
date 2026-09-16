import assert from "node:assert/strict";
import test from "node:test";

import { McpServerSession } from "../dist/session.js";

function createMockClient() {
  return {
    async connect() {},
    async listTools() {
      return [];
    },
    async listResources() { return []; },
    async listPrompts() {
      return [
        {
          info: {
            name: "review",
            description: "Review code",
            arguments: [
              { name: "file", description: "File to review", required: true },
              { name: "focus", description: "Focus area", required: false },
            ],
          },
          async get(args) {
            return {
              messages: [
                { role: "user", content: { type: "text", text: `Review ${args?.file}` } },
              ],
            };
          },
        },
      ];
    },
    async callTool() { return { content: [] }; },
    async readResource() { return { uri: "", text: "" }; },
    async readResourceContents() { return [{ uri: "", text: "" }]; },
    async getPrompt(name, args) {
      return {
        messages: [
          { role: "user", content: { type: "text", text: `Prompt ${name}: ${JSON.stringify(args)}` } },
        ],
      };
    },
    async ping() {},
    async close() {},
    getServerCapabilities() { return { tools: {}, prompts: {} }; },
    getServerInfo() { return { name: "mock" }; },
    onNotification() {},
    async reconnect() {},
  };
}

test("session exposes prompts with argument metadata after connect", async () => {
  const client = createMockClient();
  const session = new McpServerSession({
    config: { command: "mock" },
    client: client,
  });

  const snapshot = await session.connect();

  assert.equal(snapshot.prompts.length, 1);
  const prompt = snapshot.prompts[0];
  assert.equal(prompt.info.name, "review");
  assert.equal(prompt.info.description, "Review code");
  assert.equal(prompt.info.arguments.length, 2);
  assert.equal(prompt.info.arguments[0].name, "file");
  assert.equal(prompt.info.arguments[0].required, true);
  assert.equal(prompt.info.arguments[1].name, "focus");
  assert.equal(prompt.info.arguments[1].required, false);
});

test("getPrompt retrieves prompt messages with arguments", async () => {
  const client = createMockClient();
  const session = new McpServerSession({
    config: { command: "mock" },
    client: client,
  });

  await session.connect();
  const snapshot = session.getSnapshot();
  const prompt = snapshot.prompts[0];

  const result = await prompt.get({ file: "index.ts", focus: "security" });
  assert.ok(result.messages);
  assert.equal(result.messages.length, 1);
});

test("session refreshes prompts and emits a new snapshot after prompts/list_changed", async () => {
  let prompts = [
    {
      info: { name: "old-prompt", description: "Old prompt", arguments: [] },
      async get() {
        return { messages: [] };
      },
    },
  ];
  let notificationHandler: ((notification: { method: "prompts/list_changed" }) => void) | undefined;
  const base = createMockClient();
  const client = {
    ...base,
    async listPrompts() {
      return prompts;
    },
    onNotification(handler: (notification: { method: "prompts/list_changed" }) => void) {
      notificationHandler = handler;
    },
  };
  const session = new McpServerSession({
    config: { command: "mock" },
    client,
  });
  const changes: string[] = [];
  session.onChange((snapshot) => {
    changes.push(snapshot.prompts.map((prompt) => prompt.info.name).join(","));
  });

  const initial = await session.connect();
  assert.deepEqual(initial.prompts.map((prompt) => prompt.info.name), ["old-prompt"]);

  prompts = [
    {
      info: { name: "new-prompt", description: "New prompt", arguments: [] },
      async get() {
        return { messages: [] };
      },
    },
  ];
  notificationHandler?.({ method: "prompts/list_changed" });
  await new Promise((resolve) => setTimeout(resolve, 550));

  assert.deepEqual(session.getSnapshot().prompts.map((prompt) => prompt.info.name), ["new-prompt"]);
  assert.ok(changes.includes("new-prompt"));
});
