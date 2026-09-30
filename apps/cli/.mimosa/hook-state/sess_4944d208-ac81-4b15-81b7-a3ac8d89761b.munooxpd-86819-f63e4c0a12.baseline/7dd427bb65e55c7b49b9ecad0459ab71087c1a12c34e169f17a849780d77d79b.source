import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import {
  ApprovalCard,
  APPROVAL_BORDER_FRAMES,
  APPROVAL_PULSE_GLYPHS,
  approvalBorderFrame,
  approvalPulseGlyph,
} from "../dist/ink/approval-card.js";
import {
  ToolTimeline,
  formatToolDuration,
  formatToolProgressBar,
} from "../dist/ink/tool-timeline.js";
import type { ToolCard } from "../dist/tui-session.js";

const CARDS: readonly ToolCard[] = [
  {
    id: "tool-1",
    kind: "tool",
    name: "code-search",
    status: "completed",
    detail: "3 symbols",
    startedAt: 1_000,
    finishedAt: 1_450,
  },
  {
    id: "approval-1",
    kind: "approval",
    name: "filesystem",
    status: "approval",
    detail: "review required",
    startedAt: 1_500,
  },
  {
    id: "tool-2",
    kind: "tool",
    name: "shell",
    status: "running",
    detail: "running 2/4",
    startedAt: 1_800,
  },
];

test("tool timeline preserves chronological order and shows progress duration", () => {
  const output = renderToString(
    createElement(ToolTimeline, {
      cards: CARDS,
      columns: 80,
      now: 2_000,
    }),
    { columns: 80 },
  );

  assert.match(output, /TOOL TIMELINE/);
  assert.ok(output.indexOf("code-search") < output.indexOf("filesystem"));
  assert.ok(output.indexOf("filesystem") < output.indexOf("shell"));
  assert.match(output, /450ms/);
  assert.match(output, /running 2\/4/);
  assert.match(output, /├|└/);
});

test("approval border phases pulse and approval copy keeps the keyboard contract", () => {
  assert.ok(APPROVAL_BORDER_FRAMES.length >= 4);
  assert.notEqual(approvalBorderFrame(0), approvalBorderFrame(1));
  assert.equal(
    approvalBorderFrame(APPROVAL_BORDER_FRAMES.length),
    approvalBorderFrame(0),
  );
  assert.ok(APPROVAL_PULSE_GLYPHS.length >= 4);
  assert.notEqual(approvalPulseGlyph(0), approvalPulseGlyph(1));
  assert.equal(
    approvalPulseGlyph(APPROVAL_PULSE_GLYPHS.length),
    approvalPulseGlyph(0),
  );

  const output = renderToString(
    createElement(ApprovalCard, {
      card: CARDS[1]!,
      frameIndex: 1,
    }),
    { columns: 80 },
  );

  assert.match(output, /APPROVAL/);
  assert.match(output, /✧ APPROVAL/);
  assert.match(output, /review required/);
  assert.match(output, /y \/ n/);

  const resolvedOutput = renderToString(
    createElement(ApprovalCard, {
      card: {
        ...CARDS[1]!,
        status: "completed",
        finishedAt: 1_900,
      },
      frameIndex: 3,
    }),
    { columns: 80 },
  );
  assert.match(resolvedOutput, /✓ APPROVAL \/ COMPLETED/);
  assert.doesNotMatch(resolvedOutput, /✹ APPROVAL/);
});

test("tool duration formatting stays compact for terminal output", () => {
  assert.equal(formatToolDuration(450), "450ms");
  assert.equal(formatToolDuration(1_200), "1.2s");
  assert.equal(formatToolDuration(undefined), "—");
});

test("tool progress bars stay bounded and show percentages when total is known", () => {
  assert.equal(formatToolProgressBar(3, 10, 10), "███░░░░░░░ 30%");
  assert.equal(formatToolProgressBar(3, undefined, 10), "3 done");

  const output = renderToString(
    createElement(ToolTimeline, {
      cards: [{
        ...CARDS[2]!,
        name: "mcp:search",
        progress: { progress: 3, total: 10 },
      }],
      columns: 80,
      now: 2_000,
    }),
    { columns: 80 },
  );
  assert.match(output, /30%/);
  assert.match(output, /███/);
});
