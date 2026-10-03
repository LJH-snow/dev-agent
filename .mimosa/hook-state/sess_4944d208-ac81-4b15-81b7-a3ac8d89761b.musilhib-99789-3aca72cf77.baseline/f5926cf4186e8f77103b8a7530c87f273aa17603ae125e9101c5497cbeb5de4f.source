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

test("GET / exposes the bounded Desktop queue and turn-owned renderer", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<script type="module">/);
    assert.match(html, /import \{[\s\S]*createPromptQueue/);
    assert.match(html, /from "\/public\/queue-persistence\.js"/);
    assert.match(html, /from "\/public\/turn-activity\.js"/);
    assert.match(html, /sessionStorage/);
    assert.match(html, /function persistSessionQueue\(sessionId\)/);
    assert.match(html, /readPersistedQueue/);
    assert.match(html, /writePersistedQueue/);
    assert.match(html, /movePersistedQueue/);
    assert.match(html, /function migrateSessionQueue\(fromSessionId, toSessionId\)/);
    assert.match(html, /id="session-search"/);
    assert.match(html, /id="session-status-filter"/);
    assert.match(html, /id="session-filter-empty"/);
    assert.match(html, /from "\/public\/session-filter\.js"/);
    assert.match(html, /function renderSessionOptions\(\)/);
    assert.match(html, /filterSessionSummaries\(/);
    assert.match(html, /sessionFilterQuery/);
    assert.match(html, /sessionFilterStatus/);
    assert.match(html, /sessionFilterEmpty\.hidden/);
    assert.match(html, /session\.filterEmpty/);
    assert.match(html, /const sessionClientStates = new Map\(\)/);
    assert.match(html, /id="composer-mode"/);
    assert.match(html, /function enqueuePrompt\(sessionId, message/);
    assert.match(html, /mode: turn\.mode/);
    assert.match(html, /\/api\/plans\/apply/);
    assert.match(html, /\/api\/plans\/reject/);
    assert.match(html, /plan-review/);
    assert.match(html, /function drainSessionQueue\(sessionId\)/);
    assert.match(html, /function ensureTurnView\(turn\)/);
    assert.match(html, /turn-activity/);
    assert.match(html, /turn\.activityKey/);
    assert.match(html, /getTurnActivityForEvent\(/);
    assert.match(html, /getTurnActivityForState\(/);
    assert.match(html, /statusNode\.setAttribute\("role", "status"\)/);
    assert.match(html, /statusNode\.setAttribute\("aria-live", "polite"\)/);
    assert.match(html, /function appendTurnMessage\(turn, kind, text\)/);
    assert.match(html, /typeof text !== "string" \|\| text\.length === 0/);
    assert.match(html, /state\.replayCursor\.accept/);
    assert.match(html, /state\.ledger\.acceptEvent\(turn\.turnId\)/);
    assert.match(html, /state\.ledger\.close\(turn\.turnId, turn\.outcome\)/);
    assert.match(html, /queue\.requeueActive\(\)/);
    assert.match(html, /queue\.clearQueued\(\)/);
    assert.match(html, /data-state="running"/);
    assert.doesNotMatch(html, /if \(activeChatSessionId !== null\) return;/);
  } finally {
    await close(server);
  }
});
