import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";

function start(server: any): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as any;
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function close(server: any): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("GET / exposes the live Run Inspector timeline contract", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    for (const id of [
      "run-inspector",
      "run-inspector-state",
      "run-inspector-note",
      "run-inspector-duration",
      "run-timeline",
      "run-timeline-empty",
      "runtime-trace-summary-runs",
      "runtime-trace-summary-visible",
      "runtime-trace-summary-failed",
      "runtime-trace-summary-average",
      "runtime-trace-failure-summary",
      "runtime-trace-status-filter",
      "runtime-trace-stage-filter",
      "runtime-trace-tool-filter",
      "runtime-trace-start",
      "runtime-trace-end",
      "runtime-trace-clear-filters",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /Run timeline/);
    assert.match(html, /Live run steps appear here/);
    assert.match(html, /function resetRunTimeline\(sessionId = currentSessionId\)/);
    assert.match(html, /function recordRunEvent\(eventType, parsed\)/);
    assert.match(html, /function renderRunTimeline\(\)/);
    assert.match(html, /recordRunEvent\(eventType, parsed\)/);
    assert.match(html, /runTimelineSessionId !== currentSessionId/);
    assert.match(html, /case "tool-progress":/);
    assert.match(html, /case "approval-request":/);
    assert.match(html, /case "validation":/);
    assert.match(html, /case "done":/);
    assert.match(html, /case "error":/);
    assert.match(html, /Tool completed/);
    assert.match(html, /Tool failed/);
    assert.match(html, /Blocked by approval policy/);
    assert.match(html, /parsed\.status === "error"/);
    assert.match(html, /Approval required/);
    assert.match(html, /Metadata-safe/);
    assert.match(html, /function renderFilteredTraceRuns\(\)/);
    assert.match(html, /function traceRunMatches\(run, filters\)/);
    assert.match(html, /function renderTraceSummary\(visibleRuns, allRuns = traceRuns\)/);
    assert.match(html, /trace.failureSummary/);
    assert.match(html, /trace.openTerminal/);
    assert.match(html, /trace.openChanges/);
    assert.match(html, /task-terminal-panel/);
    assert.match(html, /task-workspace-panel/);
  } finally {
    await close(server);
  }
});
