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
    getServerCapabilities() { return {}; },
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
