import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_COLLABORATION_TOOL_SCOPE,
  parseCollaborationToolSelection,
  type CollaborationToolChoice,
} from "../dist/collaboration-authorization.js";

const choices: CollaborationToolChoice[] = [
  { name: "filesystem", description: "Read and write files.", risk: "mutating", confirmation: "on-risk" },
  { name: "search", description: "Search project files.", risk: "read-only", confirmation: "never" },
];

test("per-task tool selection accepts exact available names and explicit none", () => {
  assert.deepEqual(parseCollaborationToolSelection("filesystem, search", choices), {
    kind: "selected",
    toolNames: ["filesystem", "search"],
  });
  assert.deepEqual(parseCollaborationToolSelection("none", choices), {
    kind: "selected",
    toolNames: [],
  });
});

test("blank confirmation cancels instead of granting an empty scope", () => {
  assert.deepEqual(parseCollaborationToolSelection("  ", choices), { kind: "cancel" });
});

test("per-task tool selection rejects unknown, duplicate, and empty entries", () => {
  assert.match(invalidMessage("shell"), /not available/);
  assert.match(invalidMessage("filesystem,filesystem"), /more than once/);
  assert.equal(parseCollaborationToolSelection("filesystem,", choices).kind, "invalid");
});

test("per-task tool selection enforces the Agent Core scope bound", () => {
  const tooMany = Array.from(
    { length: MAX_COLLABORATION_TOOL_SCOPE + 1 },
    () => "filesystem",
  ).join(",");
  assert.match(invalidMessage(tooMany), /at most 256/);
});

function invalidMessage(input: string): string {
  const result = parseCollaborationToolSelection(input, choices);
  assert.equal(result.kind, "invalid");
  return result.kind === "invalid" ? result.message : "";
}
