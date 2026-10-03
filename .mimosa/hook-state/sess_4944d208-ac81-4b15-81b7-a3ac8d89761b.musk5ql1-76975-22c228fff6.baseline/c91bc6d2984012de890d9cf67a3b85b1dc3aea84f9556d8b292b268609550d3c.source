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

test("desktop composer keeps the input row full width", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/public/styles.css`);
    assert.equal(response.status, 200);
    const styles = await response.text();
    assert.match(styles, /\.composer\s*\{[^}]*align-items:\s*stretch;/);
    assert.match(styles, /\.composer-actions\s*\{[^}]*width:\s*100%;/);
  } finally {
    await close(server);
  }
});
