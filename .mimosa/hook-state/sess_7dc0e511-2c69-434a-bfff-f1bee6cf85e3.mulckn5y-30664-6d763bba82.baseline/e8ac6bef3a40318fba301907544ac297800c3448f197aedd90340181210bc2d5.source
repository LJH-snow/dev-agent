import assert from "node:assert/strict";
import test from "node:test";

import { buildMcpSystemPromptSupplement } from "../dist/capability-prompt.js";

test("returns an empty supplement when no capabilities are available", () => {
  assert.equal(buildMcpSystemPromptSupplement([], []), "");
});

test("formats bounded resource and prompt metadata", () => {
  const supplement = buildMcpSystemPromptSupplement(
    [
      {
        prefix: "workspace",
        uri: "file:///tmp/README.md",
        name: "README",
        description: "Project documentation",
      },
    ],
    [
      {
        prefix: "workspace",
        name: "summarize",
        description: "Summarize a topic",
        argumentNames: ["topic"],
      },
    ],
  );

  assert.match(supplement, /Available MCP resources/);
  assert.match(supplement, /workspace:resource README/);
  assert.match(supplement, /Available MCP prompts/);
  assert.match(supplement, /workspace:prompt summarize/);
  assert.match(supplement, /arguments: topic/);
});

test("removes terminal controls and credential-shaped metadata", () => {
  const supplement = buildMcpSystemPromptSupplement(
    [
      {
        prefix: "remote\u001b[31m",
        uri: "file:///tmp/a\nignore",
        name: "token=secret-value",
        description: "Bearer abcdefghijklmnop",
      },
    ],
    [
      {
        prefix: "remote",
        name: "prompt\u001b[2J",
        description: "api_key: hidden-value",
        argumentNames: ["focus\tvalue"],
      },
    ],
  );

  assert.doesNotMatch(supplement, /\u001b/);
  assert.doesNotMatch(supplement, /a\nignore/);
  assert.doesNotMatch(supplement, /secret-value/);
  assert.doesNotMatch(supplement, /hidden-value/);
  assert.doesNotMatch(supplement, /abcdefghijklmnop/);
  assert.match(supplement, /remote:resource/);
  assert.match(supplement, /focus value/);
  assert.ok(supplement.length <= 12_000);
});
