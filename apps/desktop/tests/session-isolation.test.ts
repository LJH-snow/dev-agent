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

test("GET / isolates late chat events while old sessions keep running", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /const requestSessionId = currentSessionId/);
    assert.match(html, /const requestId = \+\+activeChatRequestId/);
    assert.match(html, /let activeChatSessionId = null/);
    assert.match(html, /function isCurrentChatRequest\(sessionId, requestId\)/);
    assert.match(html, /if \(!isCurrentChatRequest\(sessionId, requestId\)\) return;/);
    assert.match(html, /handleEvent\(block, requestSessionId, requestId, message\)/);
    assert.match(html, /activeChatSessionId = requestSessionId/);
    assert.match(
      html,
      /if \(currentSessionId === requestSessionId && activeChatSessionId === null\) \{\s*void loadSessionView\(requestSessionId\);/
    );
    assert.match(html, /function invalidateActiveChat\(abort = false\)/);
    assert.match(html, /if \(abort\) \{\s*activeChatController\?\.abort\(\);\s*\}/);
    assert.match(html, /function invalidateSessionHistory\(\)/);
    assert.match(html, /desktopHistoryRequestId \+= 1/);
    assert.match(html, /desktopHistoryController\?\.abort\(\)/);
    assert.match(html, /function invalidateRunSnapshot\(\)/);
    assert.match(html, /desktopRunRequestId \+= 1/);
    assert.match(html, /sessionSelect\.addEventListener\("change", async \(\) => \{\s*invalidateActiveChat\(\);\s*invalidateSessionHistory\(\);/);
    assert.match(html, /newSessionButton\.addEventListener\("click", async \(\) => \{\s*invalidateActiveChat\(\);\s*invalidateSessionHistory\(\);/);
  } finally {
    await close(server);
  }
});
