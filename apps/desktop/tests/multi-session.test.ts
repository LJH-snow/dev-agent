import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function fakeSession(id) {
  return {
    id,
    async run(_message, emit) {
      emit({ type: "token", data: { token: `from ${id}` } });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  };
}

function chat(base, sessionId, message = "hi") {
  return fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
  });
}

test("GET /api/sessions lists stored sessions and their history is readable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-sessions-"));
  const previousDir = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = dir;

  const server = createDesktopServer({
    session: {
      ...fakeSession("default"),
      estimateCost: (usage) => usage.totalTokens / 1000,
    },
  });
  const base = await start(server);
  try {
    const entries = [
      { id: "e1", role: "user", content: "hello", createdAt: new Date().toISOString() },
      { id: "e2", role: "assistant", content: "hi", createdAt: new Date().toISOString() },
    ];
    await writeFile(
      join(dir, "alpha.json"),
      JSON.stringify({ version: 1, metadata: {
        sessionId: "alpha",
        createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-01-01T00:01:00.000Z",
          entryCount: entries.length,
          usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
        }, entries }),
      "utf8"
    );

    const res = await fetch(`${base}/api/sessions`);
    assert.equal(res.status, 200);
    const payload: any = await res.json();
    assert.equal(payload.activeSessionId, "default");
    const ids = payload.sessions.map((session) => session.sessionId);
    assert.ok(ids.includes("alpha"), `expected alpha in ${ids.join(", ")}`);
    const alpha = payload.sessions.find((session) => session.sessionId === "alpha");
    assert.equal(alpha.entryCount, 2);
    assert.deepEqual(alpha.usage, {
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
    });
    assert.equal(alpha.cost, 0.017);

    const history = await fetch(`${base}/api/sessions/alpha/messages`);
    assert.equal(history.status, 200);
    const body: any = await history.json();
    assert.equal(body.sessionId, "alpha");
    assert.deepEqual(
      body.messages.map((message) => message.content),
      ["hello", "hi"]
    );
  } finally {
    await close(server);
    if (previousDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousDir;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("a request with a sessionId runs in that session", async () => {
  const created = [];
  const server = createDesktopServer({
    session: fakeSession("default"),
    createSession: (sessionId) => {
      created.push(sessionId);
      return fakeSession(sessionId);
    },
  });
  const base = await start(server);
  try {
    const res = await chat(base, "Alpha Session", "hello");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /from alpha-session/);
    assert.deepEqual(created, ["alpha-session"]);
  } finally {
    await close(server);
  }
});

test("sessions run concurrently while one session stays serialised", async () => {
  const releases = new Map();
  const server = createDesktopServer({
    session: fakeSession("default"),
    createSession: (sessionId) => ({
      id: sessionId,
      async run(_message, emit) {
        await new Promise((resolve) => {
          releases.set(sessionId, resolve);
        });
        emit({ type: "done", data: { status: "done", turns: 1 } });
      },
    }),
  });
  const base = await start(server);
  try {
    const alpha = await chat(base, "alpha");
    assert.equal(alpha.status, 200);
    await waitFor(() => releases.has("alpha"));

    const beta = await chat(base, "beta");
    assert.equal(beta.status, 200, "a different session must not be blocked");
    await waitFor(() => releases.has("beta"));

    const alphaAgain = await chat(base, "alpha", "again");
    assert.equal(alphaAgain.status, 409, "the same session stays serialised");

    releases.get("alpha")?.();
    releases.get("beta")?.();
    await Promise.all([alpha.text(), beta.text()]);
  } finally {
    await close(server);
  }
});

test("DELETE /api/sessions/<id> removes the stored session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-delete-"));
  const previousDir = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = dir;
  const server = createDesktopServer({ session: fakeSession("default") });
  const base = await start(server);

  try {
    const file = join(dir, "doomed.json");
    await writeFile(file, JSON.stringify({ version: 1, entries: [] }), "utf8");

    const res = await fetch(`${base}/api/sessions/doomed`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sessionId: "doomed", deleted: true });
    assert.equal(await exists(file), false, "the memory file should be gone");
  } finally {
    await close(server);
    if (previousDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousDir;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("DELETE /api/sessions/<id> returns 404 for an unknown session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-delete-"));
  const previousDir = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = dir;
  const server = createDesktopServer({ session: fakeSession("default") });
  const base = await start(server);

  try {
    const res = await fetch(`${base}/api/sessions/missing`, { method: "DELETE" });
    assert.equal(res.status, 404);
  } finally {
    await close(server);
    if (previousDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousDir;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

async function withSessionDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-rename-"));
  const previousDir = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = dir;
  try {
    return await run(dir);
  } finally {
    if (previousDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousDir;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("POST /api/sessions/<id>/rename moves the session file", async () => {
  await withSessionDir(async (dir) => {
    const server = createDesktopServer({ session: fakeSession("default") });
    const base = await start(server);
    try {
      await writeFile(join(dir, "before.json"), JSON.stringify({ version: 1, entries: [] }));

      const res = await fetch(`${base}/api/sessions/before/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "After Session" }),
      });

      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        from: "before",
        to: "after-session",
        renamed: true,
      });
      assert.equal(await exists(join(dir, "before.json")), false);
      assert.equal(await exists(join(dir, "after-session.json")), true);
    } finally {
      await close(server);
    }
  });
});

test("POST /api/sessions/<id>/rename refuses to overwrite", async () => {
  await withSessionDir(async (dir) => {
    const server = createDesktopServer({ session: fakeSession("default") });
    const base = await start(server);
    try {
      await writeFile(join(dir, "before.json"), JSON.stringify({ version: 1, entries: [] }));
      await writeFile(join(dir, "taken.json"), JSON.stringify({ version: 1, entries: [] }));

      const res = await fetch(`${base}/api/sessions/before/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "taken" }),
      });

      assert.equal(res.status, 409);
      assert.equal(await exists(join(dir, "before.json")), true);
    } finally {
      await close(server);
    }
  });
});

test("POST /api/sessions/<id>/rename returns 404 for an unknown session", async () => {
  await withSessionDir(async () => {
    const server = createDesktopServer({ session: fakeSession("default") });
    const base = await start(server);
    try {
      const res = await fetch(`${base}/api/sessions/missing/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "next" }),
      });
      assert.equal(res.status, 404);
    } finally {
      await close(server);
    }
  });
});

test("GET /api/sessions/<id>/export returns a Markdown transcript", async () => {
  await withSessionDir(async (dir) => {
    const server = createDesktopServer({ session: fakeSession("default") });
    const base = await start(server);
    try {
      await writeFile(
        join(dir, "alpha.json"),
        JSON.stringify({
          version: 1,
          metadata: {
            sessionId: "alpha",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastActiveAt: "2026-01-01T00:01:00.000Z",
            entryCount: 3,
          },
          entries: [
            { id: "e1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" },
            {
              id: "e2",
              role: "assistant",
              content: "hi there",
              createdAt: "2026-01-01T00:00:10.000Z",
            },
            {
              id: "e3",
              role: "tool",
              content: "ran",
              toolName: "shell",
              createdAt: "2026-01-01T00:00:20.000Z",
            },
          ],
        }),
        "utf8"
      );

      const res = await fetch(`${base}/api/sessions/alpha/export`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
      assert.match(res.headers.get("content-disposition") ?? "", /alpha\.md/);

      const body = await res.text();
      assert.match(body, /# Session alpha/);
      assert.match(body, /## user\n\nhello/);
      assert.match(body, /## assistant\n\nhi there/);
      assert.match(body, /## tool \(shell\)/);
    } finally {
      await close(server);
    }
  });
});

test("GET /api/sessions/<id>/export returns 404 for an unknown session", async () => {
  await withSessionDir(async () => {
    const server = createDesktopServer({ session: fakeSession("default") });
    const base = await start(server);
    try {
      const res = await fetch(`${base}/api/sessions/missing/export`);
      assert.equal(res.status, 404);
    } finally {
      await close(server);
    }
  });
});
