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
  server.closeAllConnections?.();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

function chat(base: string, message = "go"): Promise<Response> {
  return fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

/** A session that floods tokens and records whether it was told to stop. */
function floodingSession(chunks: number) {
  const session = {
    id: "default",
    aborted: false,
    emitted: 0,
    async run(_message, emit, options: { signal?: AbortSignal } = {}) {
      options.signal?.addEventListener("abort", () => {
        session.aborted = true;
      });
      for (let i = 0; i < chunks; i += 1) {
        if (options.signal?.aborted) {
          return;
        }
        session.emitted += 1;
        emit({ type: "token", data: { token: "x".repeat(50) } });
      }
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  };
  return session;
}

async function withMaxBytes<T>(value: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.DEV_AGENT_SSE_MAX_BYTES;
  process.env.DEV_AGENT_SSE_MAX_BYTES = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.DEV_AGENT_SSE_MAX_BYTES;
    } else {
      process.env.DEV_AGENT_SSE_MAX_BYTES = previous;
    }
  }
}

test("a flooding stream is cut off with an error instead of buffering forever", async () => {
  await withMaxBytes("100000", async () => {
    const session = floodingSession(200000);
    const server = createDesktopServer({ session });
    const base = await start(server);
    try {
      const response = await chat(base);
      const text = await response.text();

      assert.match(text, /event: error/);
      assert.match(text, /stream exceeded 100000 bytes/);
      assert.ok(
        session.emitted < 200000,
        `the flood must be stopped early (emitted ${session.emitted})`
      );
      assert.equal(session.aborted, true, "the producing run must be aborted");
    } finally {
      await close(server);
    }
  });
});

test("a normal stream within the cap is delivered unchanged", async () => {
  await withMaxBytes("100000", async () => {
    const session = floodingSession(5);
    const server = createDesktopServer({ session });
    const base = await start(server);
    try {
      const response = await chat(base);
      const text = await response.text();

      assert.equal((text.match(/event: token/g) ?? []).length, 5);
      assert.match(text, /event: done/);
      assert.doesNotMatch(text, /stream exceeded/);
      assert.equal(session.aborted, false);
    } finally {
      await close(server);
    }
  });
});

test("the cap is configurable", async () => {
  await withMaxBytes("500", async () => {
    const session = floodingSession(200);
    const server = createDesktopServer({ session });
    const base = await start(server);
    try {
      const text = await (await chat(base)).text();

      assert.match(text, /stream exceeded 500 bytes/);
      assert.ok(session.emitted < 200, "a small cap must trip early");
    } finally {
      await close(server);
    }
  });
});
