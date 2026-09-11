import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { McpServerSession } from "../dist/index.js";

const fakeServer = fileURLToPath(new URL("../tests/fake-mcp-server.mjs", import.meta.url));

test("rapid tools/list_changed notifications are debounced", async () => {
  const session = new McpServerSession({
    config: { command: process.execPath, args: [fakeServer], name: "fake" },
  });

  const snapshots = [];
  session.onChange((snapshot) => {
    snapshots.push(snapshot);
  });

  try {
    await session.connect();
    const initialCount = snapshots.length;

    const client = session.getClient();
    const tools = await client.listTools();
    const notifyTool = tools.find((tool) => tool.name === "notify");

    await notifyTool.execute({});
    await notifyTool.execute({});
    await notifyTool.execute({});

    await new Promise((resolve) => setTimeout(resolve, 700));

    assert.ok(
      snapshots.length < initialCount + 3,
      `expected debounce to reduce reloads, got ${snapshots.length} snapshots from ${initialCount}`
    );
    assert.ok(
      snapshots.length > initialCount,
      `expected at least one reload after debounce, got ${snapshots.length}`
    );
  } finally {
    await session.close();
  }
});
