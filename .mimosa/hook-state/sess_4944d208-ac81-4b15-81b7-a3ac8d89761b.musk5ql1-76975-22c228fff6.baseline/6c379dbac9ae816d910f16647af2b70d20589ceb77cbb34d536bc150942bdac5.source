import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";

function start(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as any;
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

async function close(server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before the timeout");
}

function chatRequest(base, extra = {}) {
  return fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
    ...extra,
  });
}

test("a client disconnect aborts the running session", async () => {
  let aborted = false;
  const session = {
    async run(_message, emit, options: { signal?: AbortSignal } = {}) {
      emit({ type: "token", data: { token: "partial" } });
      await new Promise((resolve) => {
        options.signal.addEventListener("abort", resolve, { once: true });
      });
      aborted = true;
      emit({ type: "done", data: { status: "aborted", turns: 1 } });
    },
  };

  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const controller = new AbortController();
    const response = await chatRequest(base, { signal: controller.signal });
    assert.equal(response.status, 200);

    controller.abort();
    await assert.rejects(() => response.text());

    await waitFor(() => aborted);
    assert.equal(aborted, true);
  } finally {
    await close(server);
  }
});

test("a concurrent chat request is rejected with 409", async () => {
  let release;
  const session = {
    async run(_message, emit) {
      emit({ type: "token", data: { token: "started" } });
      await new Promise((resolve) => {
        release = resolve;
      });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  };

  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const first = await chatRequest(base);
    assert.equal(first.status, 200);
    await waitFor(() => typeof release === "function");

    const second = await chatRequest(base);
    assert.equal(second.status, 409);
    const body: any = await second.json();
    assert.match(body.error, /already running/);

    release();
    await first.text();
  } finally {
    await close(server);
  }
});

test("a completed request does not abort its session signal", async () => {
  let observed;
  const session = {
    async run(_message, emit, options: { signal?: AbortSignal } = {}) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      observed = options.signal;
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  };

  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await chatRequest(base);
    const text = await response.text();

    assert.match(text, /event: done/);
    assert.equal(observed.aborted, false);
  } finally {
    await close(server);
  }
});
