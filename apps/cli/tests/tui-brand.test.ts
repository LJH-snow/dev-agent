import assert from "node:assert/strict";
import test from "node:test";

import { renderWelcome } from "../dist/tui-renderer.js";

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

test("Signal Loom launch surface contains the mark, tips, and ready state", () => {
  const output = renderWelcome({
    provider: "ollama",
    model: "qwen3:4b-instruct",
    streaming: true,
    runState: "ready",
    sessionId: "default",
    workingDirectory: "/tmp/project",
    mcpCount: 0,
    width: 80,
  });

  assert.match(output, /DEV AGENT/);
  assert.match(output, /READY/);
  assert.match(output, /Tips/);
  assert.match(output, /qwen3:4b-instruct/);
  assert.ok(stripAnsi(output).split("\n").every((line) => line.length <= 80));
});

test("Signal Loom mark has a compact monochrome variant", async () => {
  const { renderSignalLoomMark } = await import("../dist/tui-brand.js");
  const output = renderSignalLoomMark({ width: 8, color: false, compact: true });

  assert.match(output, /<>/);
  assert.ok(stripAnsi(output).split("\n").every((line) => line.length <= 8));
  assert.doesNotMatch(output, /\u001b\[/);
});
