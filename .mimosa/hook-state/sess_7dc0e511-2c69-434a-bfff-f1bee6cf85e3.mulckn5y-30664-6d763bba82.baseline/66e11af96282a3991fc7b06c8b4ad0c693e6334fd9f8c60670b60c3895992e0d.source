import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import { PlanReviewPanel } from "../dist/ink/plan-review-panel.js";

const review = {
  changeSetId: "plan-123",
  files: [{
    path: "src/router.ts",
    kind: "file" as const,
    afterHash: "a".repeat(64),
    diff: "--- a/src/router.ts\n+++ b/src/router.ts\n@@ -1,1 +1,2 @@\n export const route = true;\n+export const ready = true;\n",
    additions: 1,
    deletions: 0,
    beforeExists: true,
    afterExists: true,
  }],
  additions: 1,
  deletions: 0,
  createdAt: "2026-09-22T00:00:00.000Z",
};

test("plan review panel shows the pending files, diff, and apply action", () => {
  const output = renderToString(
    createElement(PlanReviewPanel, {
      prompt: "add a readiness flag",
      review,
      status: "ready",
      columns: 100,
    }),
    { columns: 100 },
  );

  assert.match(output, /PLAN READY/);
  assert.match(output, /src\/router\.ts/);
  assert.match(output, /add a readiness flag/);
  assert.match(output, /export const ready/);
  assert.match(output, /:apply/);
});
