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

test("GET / exposes a session-safe retry action for failed requests", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /setLocalizedNode\(retry, "action\.retry"\)/);
    assert.match(
      html,
      /retry\.setAttribute\("data-i18n-title", "action\.retryTitle"\)/
    );
    assert.match(html, /function appendErrorMessage\(text, retryMessage, sessionId\)/);
    assert.match(html, /function retryRequest\(message, sessionId, button\)/);
    assert.match(
      html,
      /if \(sessionId !== currentSessionId \|\| activeChatSessionId !== null\) return;/
    );
    assert.match(
      html,
      /retry\.addEventListener\("click", \(\) => retryRequest\(retryMessage, sessionId, retry\)\)/
    );
    assert.match(
      html,
      /appendErrorMessage\("Request failed: " \+ \(text \|\| res\.status\), message, requestSessionId\)/
    );
    assert.match(
      html,
      /handleEvent\(block, requestSessionId, requestId, message\)/
    );
    assert.match(
      html,
      /appendErrorMessage\(parsed\.message \|\| "unknown error", message, sessionId\)/
    );
  } finally {
    await close(server);
  }
});
