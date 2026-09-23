import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";
import { RuntimeEventSequence } from "@dev-agent/agent-core";

import {
  ThoughtLine,
  formatThoughtElapsed,
} from "../dist/ink/thought-line.js";
import { InkRuntimeStore } from "../dist/ink/runtime-store.js";
import { THINKING_FRAMES } from "../dist/ink/thinking-indicator.js";

test("thought markers breathe through single-glyph star sizes", () => {
  assert.deepEqual(
    THINKING_FRAMES.map((frame) => frame.glyph),
    ["✧", "✦", "✸", "✹", "✸", "✦", "✧"],
  );
  assert.ok(THINKING_FRAMES.every((frame) => Array.from(frame.glyph).length === 1));
});

test("thought line renders a public status trace and elapsed time", () => {
  const output = renderToString(
    createElement(ThoughtLine, {
      active: true,
      startedAt: "2026-09-21T12:00:00.000Z",
      now: "2026-09-21T12:00:01.250Z",
      state: "thinking",
      steps: ["Thinking", "Calling code-search"],
    }),
    { columns: 80 },
  );

  assert.match(output, /THINKING/);
  assert.match(output, /1\.3s/);
  assert.match(output, /Calling code-search/);
  assert.match(output, /✧|✦|✸|✹/);
  assert.doesNotMatch(output, /⬤|✺/);
});

test("thought line settles into a duration summary", () => {
  const output = renderToString(
    createElement(ThoughtLine, {
      active: false,
      elapsedMs: 4200,
      state: "ready",
      steps: ["Thinking", "Finished shell"],
    }),
    { columns: 80 },
  );

  assert.match(output, /Thought for 4\.2s/);
  assert.match(output, /✧|✦|✸|✹/);
  assert.equal(formatThoughtElapsed(4200), "4.2s");
  assert.doesNotMatch(output, /Calling/);
});

test("runtime events project public lifecycle steps into the thought trace", () => {
  const sequence = new RuntimeEventSequence(
    "thought-trace-session",
    () => "2026-09-21T12:00:00.000Z",
  );
  const store = new InkRuntimeStore();

  store.apply(sequence.create(
    "run.started",
    { prompt: "inspect the project" },
    { runId: "run-1" },
  ));
  store.apply(sequence.create(
    "run.status",
    { status: "thinking" },
    { runId: "run-1" },
  ));
  store.apply(sequence.create(
    "tool.started",
    { tool: "code-search" },
    { runId: "run-1" },
  ));
  store.apply(sequence.create(
    "tool.completed",
    { tool: "code-search", output: "found 3 symbols" },
    { runId: "run-1" },
  ));
  store.apply(sequence.create(
    "validation.started",
    { detail: "running trusted checks" },
    { runId: "run-1" },
  ));
  store.apply(sequence.create(
    "validation.completed",
    { status: "passed", detail: "all checks passed" },
    { runId: "run-1" },
  ));
  store.apply(sequence.create(
    "run.completed",
    { turns: 1 },
    { runId: "run-1" },
  ));

  const thought = store.getSnapshot().thought;
  assert.equal(thought.active, false);
  assert.deepEqual(thought.steps, [
    "Thinking",
    "Calling code-search",
    "Finished code-search",
    "Validating changes",
    "Validation passed",
  ]);
  assert.equal(thought.summary, "Thought for 0.0s");
});
