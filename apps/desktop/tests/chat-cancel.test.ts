import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";

function start(server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as any;
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function close(server): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before the timeout");
}

function chat(base: string, sessionId = "default"): Promise<Response> {
  return fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hi", sessionId }),
  });
}

function cancel(base: string, sessionId = "default", body?: unknown): Promise<Response> {
  return fetch(`${base}/api/chat/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? JSON.stringify({ sessionId }) : JSON.stringify(body),
  });
}

/** Emits a token, then waits for the run's abort signal. */
function cancellableSession(finalState: "aborted" | "cancelled" = "aborted") {
  const session = {
    id: "default",
    started: false,
    aborted: false,
    async run(_message, emit, options: { signal?: AbortSignal } = {}) {
      session.started = true;
      emit({ type: "token", data: { token: "partial" } });
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      session.aborted = true;
      emit({ type: "done", data: { status: finalState, turns: 1 } });
    },
  };
  return session;
}

test("POST /api/chat/cancel aborts the running session", async () => {
  const session = cancellableSession();
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await chat(base);
    const textPromise = response.text();
    await waitFor(() => session.started);

    const started = Date.now();
    const cancelled = await cancel(base);
    assert.equal(cancelled.status, 200);
    assert.deepEqual(await cancelled.json(), { sessionId: "default", cancelled: true });

    const text = await textPromise;
    assert.ok(Date.now() - started < 1000, "the stream must close promptly");
    assert.equal(session.aborted, true, "the session received the abort");
    assert.match(text, /event: done/);
    assert.match(text, /"status":"aborted"/);
  } finally {
    await close(server);
  }
});

test("cancelling an idle session is a no-op", async () => {
  const session = cancellableSession();
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await cancel(base);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sessionId: "default", cancelled: false });
    assert.equal(session.started, false, "no run was started by the cancel");
  } finally {
    await close(server);
  }
});

test("a cancelled session accepts the next request right away", async () => {
  const session = cancellableSession();
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const first = await chat(base);
    const firstText = first.text();
    await waitFor(() => session.started);
    await cancel(base);
    await firstText;

    const second = await chat(base);
    assert.equal(second.status, 200, "the in-flight lock must have been released");
    const secondText = second.text();
    await waitFor(() => session.started);
    await cancel(base);
    await secondText;
  } finally {
    await close(server);
  }
});

test("POST /api/chat/cancel rejects an invalid body", async () => {
  const server = createDesktopServer({ session: cancellableSession() });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/chat/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });

    assert.equal(response.status, 400);
    const body: any = await response.json();
    assert.match(body.error, /valid JSON/);
  } finally {
    await close(server);
  }
});
