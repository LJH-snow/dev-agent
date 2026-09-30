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

test("GET / exposes session run recovery and stale-session guards", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /id="session-run-status"/);
    assert.match(html, /function loadRunSnapshot\(sessionId\)/);
    assert.match(html, /\/api\/sessions\/" \+ encodeURIComponent\(sessionId\) \+ "\/run/);
    assert.match(html, /function pollRunSnapshot\(sessionId\)/);
    assert.match(html, /runRecoveryTimer/);
    assert.match(html, /\?after=/);
    assert.match(html, /scheduleRunRecovery\(sessionId\)/);
    assert.match(html, /function restoreRunSnapshot\(snapshot\)/);
    assert.match(html, /function restoreCompletedRunTranscript\(sessionId, snapshot\)/);
    assert.match(html, /state\.historyHasTranscript/);
    assert.match(html, /restoreCompletedRunTranscript\(sessionId, snapshot\)/);
    assert.match(html, /const live = snapshot\.live/);
    assert.match(html, /live\.assistant/);
    assert.match(html, /live\.reasoning/);
    assert.match(html, /live\.tool/);
    assert.match(html, /live\.approval/);
    assert.match(html, /function loadSessionView\(sessionId\)/);
    assert.match(html, /requestId !== desktopRunRequestId \|\| sessionId !== currentSessionId/);
    assert.match(html, /runSnapshotSessionId !== currentSessionId/);
    assert.match(html, /session\.run\.status/);
    assert.match(html, /session\.run\.running/);
    assert.match(html, /session\.run\.waiting/);
    assert.match(html, /session\.run\.done/);
    assert.match(html, /session\.run\.failed/);
    assert.match(html, /session\.run\.aborted/);
  } finally {
    await close(server);
  }
});
