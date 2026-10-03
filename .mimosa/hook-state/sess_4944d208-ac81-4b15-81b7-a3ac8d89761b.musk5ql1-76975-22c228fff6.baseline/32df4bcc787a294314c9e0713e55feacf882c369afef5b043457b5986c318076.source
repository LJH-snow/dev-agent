import assert from "node:assert/strict";
import test from "node:test";

import { THINKING_FRAMES, thinkingFrame } from "../dist/ink/thinking-indicator.js";

test("thinking frames cycle deterministically and wrap around", () => {
  assert.deepEqual(
    THINKING_FRAMES.map((frame) => frame.glyph),
    ["✧", "✦", "✸", "✹", "✸", "✦", "✧"],
  );
  assert.ok(THINKING_FRAMES.every((frame) => frame.color.startsWith("#")));
  assert.notEqual(thinkingFrame(0).glyph, thinkingFrame(3).glyph);
  assert.deepEqual(thinkingFrame(0), thinkingFrame(THINKING_FRAMES.length));
  assert.deepEqual(thinkingFrame(-1), THINKING_FRAMES[THINKING_FRAMES.length - 1]);
});

test("thinking frames stay in a blue palette while changing brightness", () => {
  const colors: readonly string[] = THINKING_FRAMES.map((frame) => frame.color);
  assert.ok(colors.every((color) =>
    color === "#6fb8ff" ||
    color === "#80c2ff" ||
    color === "#9ed0ff" ||
    color === "#c5e4ff"
  ));
  assert.ok(new Set(colors).size >= 3);
});
