import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopStatus } from "../dist/status.js";
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

test("GET /api/status returns the metadata-only desktop status payload", async () => {
  const session = {
    executorMode: "sandboxed-macos" as const,
    getStatus: () => createDesktopStatus({
      sessionId: "desktop-default",
      executorMode: "sandboxed-macos",
      providerId: "openai",
      model: "gpt-4o-mini",
      approvalMode: "ask",
      validationPolicy: "default",
    }),
    async run() {},
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const payload = (await response.json()) as any;
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.metadataOnly, true);
    assert.deepEqual(payload.executor, { mode: "sandboxed-macos" });
    assert.deepEqual(payload.runtime.kind, "node");
    assert.deepEqual(payload.provider, { id: "openai", state: "ready" });
    assert.deepEqual(payload.model, { id: "gpt-4o-mini", state: "ready" });
    assert.deepEqual(payload.approval, { mode: "ask", guarded: true });
    assert.deepEqual(payload.validation, { policy: "default", enabled: true, lastResult: "unknown" });
    assert.equal(payload.session.running, false);

    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /api[-_ ]?key|token|secret|Users|home|tmp|provider exploded/i);
  } finally {
    await close(server);
  }
});

test("GET /api/status rejects an unknown session without exposing internals", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/status?sessionId=missing-session`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "unknown session" });
  } finally {
    await close(server);
  }
});

test("GET / exposes the runtime status panel", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    for (const id of [
      "desktop-status-panel",
      "desktop-status-executor",
      "desktop-status-runtime",
      "desktop-status-provider",
      "desktop-status-model",
      "desktop-status-approval",
      "desktop-status-validation",
      "desktop-status-refresh",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /\/api\/status\?sessionId/);
    assert.match(html, /Metadata only — no keys, paths, source, or raw errors are shown/);
  } finally {
    await close(server);
  }
});
