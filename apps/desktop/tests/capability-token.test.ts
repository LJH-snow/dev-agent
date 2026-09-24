import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";

test("Desktop serves a per-server capability token and gates terminal mutations", async () => {
  const capabilityToken = "desktop-capability-test-token";
  const server = createDesktopServer({
    host: "127.0.0.1",
    port: 0,
    capabilityToken,
    requireCapabilityToken: true,
    session: { id: "desktop-default", async run() {} },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, new RegExp(`name="dev-agent-capability-token" content="${capabilityToken}"`));
    assert.doesNotMatch(html, /__DEV_AGENT_CAPABILITY_TOKEN__/);

    const body = JSON.stringify({ sessionId: "desktop-default", command: "printf capability-token\n" });
    const missing = await fetch(`${base}/api/terminal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(missing.status, 403);
    assert.deepEqual(await missing.json(), {
      error: "desktop capability token is required",
      code: "desktop-capability-required",
    });

    const wrong = await fetch(`${base}/api/terminal`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dev-agent-capability": "wrong-token",
      },
      body,
    });
    assert.equal(wrong.status, 403);

    const allowed = await fetch(`${base}/api/terminal`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dev-agent-capability": capabilityToken,
      },
      body,
    });
    assert.equal(allowed.status, 201);

    const chatBody = JSON.stringify({ sessionId: "desktop-default", message: "capability check" });
    const chatMissing = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chatBody,
    });
    assert.equal(chatMissing.status, 403);

    const chatAllowed = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dev-agent-capability": capabilityToken,
      },
      body: chatBody,
    });
    assert.equal(chatAllowed.status, 200);
  } finally {
    server.close();
    await once(server, "close");
  }
});
