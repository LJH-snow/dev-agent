import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import {
  ROTATING_STATUS_FRAMES,
  RotatingStatus,
  rotatingStatusFrame,
  rotatingStatusFrames,
} from "../dist/ink/rotating-status.js";

test("rotating status frames keep the current state visible while changing copy", () => {
  const frames = rotatingStatusFrames("thinking", ["Thinking", "Calling code-search"]);

  assert.ok(frames.length >= 3);
  assert.equal(frames[0], "THINKING");
  assert.notEqual(frames[0], frames[1]);
  assert.equal(
    rotatingStatusFrame(ROTATING_STATUS_FRAMES.length, "thinking", []),
    rotatingStatusFrame(0, "thinking", []),
  );
});

test("rotating status renders a public progress phrase", () => {
  const output = renderToString(
    createElement(RotatingStatus, {
      active: true,
      state: "tool-running",
      steps: ["Calling code-search"],
      frameIndex: 1,
    }),
    { columns: 80 },
  );

  assert.match(output, /TOOL RUNNING|CALLING CODE-SEARCH/);
});
