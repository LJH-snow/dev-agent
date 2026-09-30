import assert from "node:assert/strict";
import test from "node:test";

import { createAgentContext, InMemoryMemory } from "../dist/index.js";

test("context carries session, working directory, and metadata", () => {
  const memory = new InMemoryMemory();
  const context = createAgentContext("agent-1", memory, {
    sessionId: "docs",
    workingDirectory: "/tmp/work",
    metadata: { provider: "ollama" },
  });

  assert.equal(context.sessionId, "docs");
  assert.equal(context.workingDirectory, "/tmp/work");
  assert.equal(context.metadata.provider, "ollama");
  assert.ok(context.createdAt);
  assert.equal(context.updatedAt, context.createdAt);
  assert.equal(context.state.status, "idle");
  assert.equal(context.state.turns, 0);
  assert.equal(context.memory, memory);
});
