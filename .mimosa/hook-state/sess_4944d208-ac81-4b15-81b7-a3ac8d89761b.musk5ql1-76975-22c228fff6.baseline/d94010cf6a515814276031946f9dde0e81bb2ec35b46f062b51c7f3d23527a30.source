import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentToolRegistry,
  type AgentTool,
} from "../dist/index.js";

function tool(name: string, metadata?: AgentTool["metadata"]): AgentTool {
  return {
    name,
    description: name,
    metadata,
    async execute() {
      return "ok";
    },
  };
}

test("the registry treats unclassified tools conservatively and preserves explicit metadata", () => {
  const registry = new AgentToolRegistry();
  registry.register(tool("explicit-reader", { risk: "read-only" }));
  registry.register(tool("explicit-mutator", { risk: "mutating" }));
  registry.register(tool("read-file"));
  registry.register(tool("write-file", {
    risk: "mutating",
    confirmation: "on-risk",
    resultFormat: "diff",
    supportsProgress: false,
  }));

  assert.deepEqual(registry.metadata("explicit-reader"), {
    risk: "read-only",
    confirmation: "never",
    resultFormat: "text",
    supportsProgress: false,
  });
  assert.deepEqual(registry.metadata("explicit-mutator"), {
    risk: "mutating",
    confirmation: "on-risk",
    resultFormat: "text",
    supportsProgress: false,
  });
  assert.deepEqual(registry.metadata("read-file"), {
    risk: "dangerous",
    confirmation: "always",
    resultFormat: "text",
    supportsProgress: false,
  });
  assert.deepEqual(registry.metadata("write-file"), {
    risk: "mutating",
    confirmation: "on-risk",
    resultFormat: "diff",
    supportsProgress: false,
  });
});

test("the registry retains the explicit built-in risk defaults", () => {
  const registry = new AgentToolRegistry();
  registry.register(tool("shell"));
  registry.register(tool("filesystem"));
  registry.register(tool("git"));

  assert.equal(registry.metadata("shell")?.risk, "dangerous");
  assert.equal(registry.metadata("shell")?.confirmation, "on-risk");
  assert.equal(registry.metadata("filesystem")?.risk, "mutating");
  assert.equal(registry.metadata("filesystem")?.confirmation, "on-risk");
  assert.equal(registry.metadata("git")?.risk, "mutating");
  assert.equal(registry.metadata("git")?.confirmation, "on-risk");
});
