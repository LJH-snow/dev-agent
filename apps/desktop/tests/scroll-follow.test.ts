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

test("desktop message streaming preserves a reader's manual scroll position", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /id="jump-to-latest"/);
    assert.match(html, /data-i18n="conversation.newOutput"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /let pendingLiveOutput = false/);
    assert.match(html, /function renderLiveOutputNotice\(\)/);
    assert.match(html, /function clearPendingLiveOutput\(\)/);
    assert.match(html, /function markLiveOutputPending\(\)/);
    assert.match(html, /const MESSAGE_SCROLL_THRESHOLD = 24/);
    assert.match(html, /function isMessagesAtBottom\(\)/);
    assert.match(
      html,
      /function scrollMessagesToBottom\(wasAtBottom = isMessagesAtBottom\(\)\)/
    );
    assert.match(
      html,
      /function setMessagesScrollTop\(behavior = "auto"\)[\s\S]{0,420}const top = Math\.max\(0, messages\.scrollHeight - messages\.clientHeight\);[\s\S]{0,240}messages\.scrollTo\(\{ top, left: 0, behavior \}\)/
    );
    assert.match(
      html,
      /function setMessagesScrollTop\([\s\S]{0,560}messages\.scrollTop = top;/
    );
    assert.match(
      html,
      /const wasAtBottom = isMessagesAtBottom\(\);[\s\S]{0,240}messages\.appendChild\(div\);[\s\S]{0,120}scrollMessagesToBottom\(wasAtBottom\);/
    );
    assert.match(
      html,
      /function scrollMessagesToBottom\(wasAtBottom = isMessagesAtBottom\(\)\) \{[\s\S]{0,260}markLiveOutputPending\(\);/
    );
    assert.match(
      html,
      /case "token":[\s\S]{0,320}const wasAtBottom = isMessagesAtBottom\(\);[\s\S]{0,260}scrollMessagesToBottom\(wasAtBottom\);/
    );
    assert.match(
      html,
      /messages\.addEventListener\("scroll", \(\) => \{[\s\S]{0,180}isMessagesAtBottom\(\)[\s\S]{0,120}clearPendingLiveOutput\(\)/
    );
    assert.match(html, /jumpToLatestButton\.addEventListener\("click"/);
    assert.match(html, /resetLiveOutputNotice\(\)/);

    const stylesResponse = await fetch(`${base}/public/styles.css`);
    assert.equal(stylesResponse.status, 200);
    const styles = await stylesResponse.text();
    assert.match(
      styles,
      /#messages\s*\{[\s\S]{0,720}overscroll-behavior:\s*contain;[\s\S]{0,360}scroll-behavior:\s*auto;/
    );
  } finally {
    await close(server);
  }
});
