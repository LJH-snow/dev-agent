import assert from "node:assert/strict";
import test from "node:test";

import { buildMcpSystemPromptSupplement } from "../dist/mcp-system-prompt.js";

test("returns empty string when no resources or prompts are available", () => {
  assert.equal(buildMcpSystemPromptSupplement([], []), "");
});

test("formats resources with name, uri, and description", () => {
  const supplement = buildMcpSystemPromptSupplement(
    [
      {
        prefix: "mcp-1",
        uri: "file:///tmp/hello.md",
        name: "hello",
        description: "Sample markdown resource",
      },
    ],
    []
  );

  assert.match(supplement, /Available MCP resources/);
  assert.match(supplement, /mcp-1:resource hello \(file:\/\/\/tmp\/hello.md\) - Sample markdown resource/);
});

test("formats prompts with argument names", () => {
  const supplement = buildMcpSystemPromptSupplement(
    [],
    [
      {
        prefix: "mcp-1",
        name: "summary",
        description: "Summarize a topic",
        argumentNames: ["topic", "length"],
      },
    ]
  );

  assert.match(supplement, /Available MCP prompts/);
  assert.match(
    supplement,
    /mcp-1:prompt summary - Summarize a topic \(arguments: topic, length\)/
  );
});

test("combines resources and prompts sections", () => {
  const supplement = buildMcpSystemPromptSupplement(
    [{ prefix: "server-a", uri: "file:///a.txt", name: "a" }],
    [{ prefix: "server-b", name: "b" }]
  );

  assert.match(supplement, /Available MCP resources/);
  assert.match(supplement, /Available MCP prompts/);
});
