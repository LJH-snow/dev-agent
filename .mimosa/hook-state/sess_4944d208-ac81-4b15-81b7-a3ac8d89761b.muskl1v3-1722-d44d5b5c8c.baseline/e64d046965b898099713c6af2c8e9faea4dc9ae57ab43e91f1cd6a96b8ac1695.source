import assert from "node:assert/strict";
import test from "node:test";

import { LocalExecutor } from "@dev-agent/executor";
import { createDefaultTools } from "../dist/index.js";

test("built-in tools declare risk, confirmation, result format, and progress metadata", () => {
  const tools = new Map(createDefaultTools(new LocalExecutor()).map((tool) => [tool.name, tool]));

  assert.equal(tools.get("filesystem")?.metadata?.risk, "mutating");
  assert.equal(tools.get("filesystem")?.metadata?.confirmation, "on-risk");
  assert.equal(tools.get("filesystem")?.metadata?.resultFormat, "json");
  assert.equal(tools.get("shell")?.metadata?.risk, "dangerous");
  assert.equal(tools.get("git")?.metadata?.risk, "mutating");
  assert.equal(tools.get("search")?.metadata?.risk, "read-only");
  assert.equal(tools.get("code-search")?.metadata?.risk, "read-only");
  assert.equal(tools.get("search")?.metadata?.confirmation, "never");
  assert.equal(tools.get("code-search")?.metadata?.supportsProgress, false);
});
