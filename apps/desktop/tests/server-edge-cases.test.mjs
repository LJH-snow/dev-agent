import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";

function start(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

async function close(server) {
  await new Promise((resolve) => server.close(() => resolve()));
}

async function withServer(options, run) {
  const server = createDesktopServer(options);
  const base = await start(server);
  try {
    await run(base);
  } finally {
    await close(server);
  }
}

function fakeSession(events = []) {
  return {
    async run(_message, emit) {
      for (const event of events) {
        emit(event);
      }
    },
  };
}

/** Sends a path verbatim; fetch() would normalize away ".." segments first. */
function rawGet(base, path) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("GET a missing public file returns 404, not 500", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/public/definitely-missing.js`);
    assert.equal(res.status, 404);
  });
});

test("GET the public directory itself returns 404, not 500", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/public/`);
    assert.equal(res.status, 404);
  });
});

test("POST /api/chat with a malformed JSON body returns 400", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/chat with an empty body returns 400", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/chat`, { method: "POST" });
    assert.equal(res.status, 400);
  });
});

test("POST /api/chat with a non-string message returns 400", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: 42 }),
    });
    assert.equal(res.status, 400);
  });
});

test("GET /health reports a JSON content type", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/health`);
    assert.match(res.headers.get("content-type") || "", /application\/json/);
  });
});

test("a session failure is streamed as an error event", async () => {
  const session = {
    async run() {
      throw new Error("provider exploded");
    },
  };
  await withServer({ session }, async (base) => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /event: error/);
    assert.match(text, /provider exploded/);
  });
});

test("/public/ rejects a percent-encoded parent segment with a clean 404", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/public/%2e%2e/%2e%2e/etc/passwd`);
    assert.equal(res.status, 404);
  });
});

test("/public/ cannot escape to the parent directory", async () => {
  await withServer({}, async (base) => {
    const res = await rawGet(base, "/public/../package.json");
    assert.equal(res.status, 404);
    assert.ok(!res.body.includes("\"name\""), "must not leak the parent package.json");
  });
});

test("GET /public/ serves a real static asset", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/public/index.html`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const body = await res.text();
    assert.match(body, /id="rename-session"/, "the rename control should be served");
    assert.match(body, /\/rename/, "the rename button should call the rename endpoint");
  });
});

test("a matching fake session emits each event type it is given", async () => {
  const session = fakeSession([
    { type: "turn", data: { turn: 1 } },
    { type: "token", data: { token: "hi" } },
    { type: "done", data: { status: "done", turns: 1 } },
  ]);
  await withServer({ session }, async (base) => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    const text = await res.text();
    for (const type of ["turn", "token", "done"]) {
      assert.ok(text.includes(`event: ${type}`), `expected an ${type} event`);
    }
  });
});
