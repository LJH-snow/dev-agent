import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import { HistoryPanel } from "../dist/ink/history-panel.js";

test("history panel renders a bounded title and rows", () => {
  const output = renderToString(
    createElement(HistoryPanel, {
      title: 'Search: "terminal" · showing 1 of 1 matches',
      rows: ["3. Tool (shell): npm test"],
      columns: 80,
    }),
    { columns: 80 },
  );

  assert.match(output, /Search: "terminal" · showing 1 of 1 matches/);
  assert.match(output, /3\. Tool \(shell\): npm test/);
});

test("history panel caps rows and reports omitted entries", () => {
  const output = renderToString(
    createElement(HistoryPanel, {
      title: "History",
      rows: Array.from({ length: 30 }, (_, index) => `${index + 1}. entry`),
      columns: 60,
      maxRows: 3,
    }),
    { columns: 60 },
  );

  assert.match(output, /1\. entry/);
  assert.match(output, /3\. entry/);
  assert.doesNotMatch(output, /4\. entry/);
  assert.match(output, /… 27 more history entries/);
});
