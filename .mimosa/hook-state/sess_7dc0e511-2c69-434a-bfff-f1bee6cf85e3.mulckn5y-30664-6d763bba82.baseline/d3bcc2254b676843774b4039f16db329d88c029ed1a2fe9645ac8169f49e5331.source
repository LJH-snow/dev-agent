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

test("GET / exposes the bilingual UI contract", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    for (const id of ["language-toggle", "language-en", "language-zh"]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /const LANGUAGE_STORAGE_KEY = "dev-agent-language"/);
    assert.match(html, /function t\(/);
    assert.match(html, /function applyLanguage\(/);
    assert.match(html, /localStorage/);
    assert.match(html, /data-i18n/);
    assert.match(html, /工作区/);
    assert.match(html, /会话/);
    assert.match(html, /运行时间线/);
    assert.match(html, /发送/);
  } finally {
    await close(server);
  }
});
