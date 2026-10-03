import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { McpStdioClient } from "../dist/index.js";

// `import.meta.url` points at the compiled tests-dist/ copy, so the fixture is
// reached through ../tests/ (same convention as the other MCP tests).
const fakeServer = fileURLToPath(new URL("../tests/fake-mcp-server.mjs", import.meta.url));

async function withClient(run: (client: McpStdioClient) => Promise<void>): Promise<void> {
  const client = new McpStdioClient();
  await client.connect({ command: process.execPath, args: [fakeServer], name: "fake" });
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

test("readResourceContents returns every block the server sent", async () => {
  await withClient(async (client) => {
    const contents = await client.readResourceContents("file:///tmp/multi.txt");

    assert.deepEqual(
      contents.map((entry) => entry.text),
      ["FIRST-PART", "SECOND-PART", "THIRD-PART"],
      "later blocks must not be dropped"
    );
  });
});

test("readResource returns the first block and stays compatible", async () => {
  await withClient(async (client) => {
    const single = await client.readResource("file:///tmp/hello.md");
    assert.equal(single.text, "# Hello from resources");

    const first = await client.readResource("file:///tmp/multi.txt");
    assert.equal(first.text, "FIRST-PART", "the compatibility wrapper keeps its meaning");
  });
});

test("an empty contents array still answers with the uri", async () => {
  await withClient(async (client) => {
    const contents = await client.readResourceContents("file:///tmp/empty.txt");
    assert.deepEqual(contents, [], "no blocks is a valid answer, not an error");

    const fallback = await client.readResource("file:///tmp/empty.txt");
    assert.deepEqual(fallback, { uri: "file:///tmp/empty.txt" });
  });
});
