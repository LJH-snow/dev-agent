import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("Signal Loom uses a large launch mark at normal terminal widths", async () => {
  const { renderSignalLoomMark } = await import("../dist/tui-brand.js");
  const output = renderSignalLoomMark({ width: 64, color: false });
  const lines = stripAnsi(output).split("\n");

  assert.ok(lines.length >= 6, "normal launch screens should use the large mark");
  assert.ok(Math.max(...lines.map((line) => line.length)) >= 30);
  assert.ok(lines.every((line) => line.length <= 64));
});

test("Signal Loom launch mark uses a multi-stop truecolor gradient", () => {
  const modulePath = fileURLToPath(new URL("../dist/tui-brand.js", import.meta.url));
  const script = `import { renderSignalLoomMark } from ${JSON.stringify(modulePath)};\nprocess.stdout.write(renderSignalLoomMark({ width: 64 }));`;
  const env = { ...process.env };
  delete env.NO_COLOR;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const colors = result.stdout.match(/\u001b\[38;2;\d+;\d+;\d+m/g) ?? [];

  assert.ok(colors.length >= 3, "gradient should color individual logo cells");
  assert.ok(new Set(colors).size >= 3, "gradient should contain multiple color stops");
});
