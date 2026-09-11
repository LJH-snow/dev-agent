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

function fakeSession() {
  return {
    async run(_message, emit) {
      emit({ type: "token", data: { token: "hello " } });
      emit({ type: "token", data: { token: "world" } });
      emit({ type: "tool", data: { name: "echo", input: { x: 1 } } });
      emit({ type: "tool-result", data: { name: "echo", output: "ok" } });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  };
}

test("GET /health returns ok", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.status, "ok");
  } finally {
    await close(server);
  }
});

test("GET / serves the chat UI", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const contentType = res.headers.get("content-type") || "";
    assert.match(contentType, /text\/html/);
    const html = await res.text();
    assert.match(html, /dev-agent/);
  } finally {
    await close(server);
  }
});

test("POST /api/chat rejects empty message", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close(server);
  }
});

test("POST /api/chat streams SSE events", async () => {
  const server = createDesktopServer({ session: fakeSession() });
  const base = await start(server);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    assert.equal(res.status, 200);
    const contentType = res.headers.get("content-type") || "";
    assert.match(contentType, /text\/event-stream/);
    const text = await res.text();
    const lines = text.split("\n");
    assert.ok(lines.includes("event: token"), "should have token event");
    assert.ok(lines.includes('data: {"token":"hello "}'), "should have hello token");
    assert.ok(lines.includes('data: {"token":"world"}'), "should have world token");
    assert.ok(lines.includes("event: tool"), "should have tool event");
    assert.ok(lines.includes("event: tool-result"), "should have tool-result event");
    assert.ok(lines.includes("event: done"), "should have done event");
  } finally {
    await close(server);
  }
});

test("unknown route returns 404", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  } finally {
    await close(server);
  }
});
