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

test("GET / exposes a bounded Runtime trace panel", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const [html, styles] = await Promise.all([
      fetch(`${base}/`).then((response) => response.text()),
      fetch(`${base}/public/styles.css`).then((response) => response.text()),
    ]);

    for (const id of [
      "trace-action",
      "runtime-trace-panel",
      "runtime-trace-title",
      "runtime-trace-status",
      "runtime-trace-list",
      "runtime-trace-refresh",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }

    assert.match(html, /Runtime trace/);
    assert.match(html, /function resetTracePanel\(\)/);
    assert.match(html, /function validTraceRuns\(payload\)/);
    assert.match(html, /function renderTraceRuns\(runs, droppedRuns\)/);
    assert.match(html, /function loadTraceSnapshot\(sessionId\)/);
    assert.match(html, /\/api\/sessions\/" \+ encodeURIComponent\(sessionId\) \+ "\/trace/);
    assert.match(html, /requestId !== traceRequestId/);
    assert.match(html, /sessionId !== currentSessionId/);
    assert.match(html, /prompts, tool inputs, output, paths, and errors are not shown/);
    assert.match(html, /trace\.kind\.tool/);

    assert.match(styles, /\.runtime-trace-panel/);
    assert.match(styles, /\.runtime-trace-item/);
    assert.match(styles, /\.runtime-trace-span/);
  } finally {
    await close(server);
  }
});
