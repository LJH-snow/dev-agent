import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import {
  DiffPreview,
  parseDiffLines,
} from "../dist/ink/diff-preview.js";

const DIFF = [
  "--- a/src/index.ts",
  "+++ b/src/index.ts",
  "@@ -1,3 +1,4 @@",
  " const existing = true;",
  "-const removed = false;",
  "+const added = true;",
  "+const another = true;",
].join("\n");

test("diff parser classifies unified diff lines for terminal styling", () => {
  const lines = parseDiffLines(DIFF);

  assert.deepEqual(
    lines.map((line) => line.kind),
    ["header", "header", "hunk", "context", "removed", "added", "added"],
  );
  assert.equal(lines[0]?.text, "--- a/src/index.ts");
  assert.equal(lines[4]?.text, "const removed = false;");
});

test("diff preview shows summary and bounds long reviews", () => {
  const output = renderToString(
    createElement(DiffPreview, {
      diff: DIFF,
      width: 72,
      maxLines: 6,
      summary: { additions: 3, deletions: 1 },
    }),
    { columns: 72 },
  );

  assert.match(output, /DIFF PREVIEW/);
  assert.match(output, /src\/index\.ts/);
  assert.match(output, /\+3/);
  assert.match(output, /-1/);
  assert.match(output, /const removed/);
  assert.match(output, /more diff lines/);
});

test("empty diffs render an explicit no-changes state", () => {
  const output = renderToString(
    createElement(DiffPreview, { diff: "", width: 72 }),
    { columns: 72 },
  );

  assert.match(output, /No textual diff available/);
});
