import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
function rawGet(base, path): Promise<any> {
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

test("/public/ refuses a symlink escaping the public directory", async () => {
  const linkPath = join(process.cwd(), "public", "escape.tmp.json");
  await symlink("../package.json", linkPath);
  try {
    await withServer({}, async (base) => {
      const res = await fetch(`${base}/public/escape.tmp.json`);
      assert.equal(res.status, 404);
      const body = await res.text();
      assert.ok(!body.includes("\"name\""), "must not leak the parent package.json");
    });
  } finally {
    await rm(linkPath, { force: true });
  }
});

test("/public/ returns a clean 404 for a broken symlink", async () => {
  const linkPath = join(process.cwd(), "public", "broken.tmp.js");
  await symlink("definitely-missing-target.js", linkPath);
  try {
    await withServer({}, async (base) => {
      const res = await fetch(`${base}/public/broken.tmp.js`);
      assert.equal(res.status, 404);
      const body: any = await res.json();
      assert.match(body.error, /not found/);
    });
  } finally {
    await rm(linkPath, { force: true });
  }
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

test("/public/ rejects a response larger than 1 MiB", async () => {
  const filePath = join(process.cwd(), "public", "bounded.tmp.html");
  await writeFile(filePath, "x".repeat(1024 * 1024 + 1));
  try {
    await withServer({}, async (base) => {
      const res = await fetch(`${base}/public/bounded.tmp.html`);
      const body: any = await res.json();
      assert.equal(res.status, 413);
      assert.match(body.error, /static response exceeds the 1 MiB limit/);
    });
  } finally {
    await rm(filePath, { force: true });
  }
});

test("chat rejects a normalized session ID longer than 96 characters", async () => {
  const created: string[] = [];
  await withServer(
    {
      createSession: (sessionId) => {
        created.push(sessionId);
        return fakeSession();
      },
    },
    async (base) => {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "hi",
          sessionId: "a".repeat(97),
        }),
      });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "sessionId is too long" });
      assert.deepEqual(created, []);
    }
  );
});

test("session listing stays within the fixed 256-entry limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-listing-"));
  const previousDirectory = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = directory;
  try {
    await Promise.all(
      Array.from({ length: 300 }, (_, index) =>
        writeFile(
          join(directory, `disk-${String(index).padStart(3, "0")}.json`),
          JSON.stringify({ version: 1, entries: [] })
        )
      )
    );
    await withServer(
      {
        session: {
          id: "default",
          async run() {},
        },
      },
      async (base) => {
      const res = await fetch(`${base}/api/sessions`);
      const payload: any = await res.json();
      assert.equal(payload.sessions.length, 256);
      const ids = payload.sessions.map((session: any) => session.sessionId);
      assert.ok(ids.includes("default"));
      }
    );
  } finally {
    if (previousDirectory === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousDirectory;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("history response rejects output larger than 1 MiB", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-history-"));
  const previousDirectory = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = directory;
  try {
    await writeFile(
      join(directory, "large.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "large-entry",
            role: "user",
            content: "x".repeat(1024 * 1024 + 1),
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      })
    );
    await withServer({ session: { id: "default", async run() {} } }, async (base) => {
      const res = await fetch(`${base}/api/sessions/large/messages`);
      assert.equal(res.status, 413);
      assert.deepEqual(
        await res.json(),
        { error: "history response exceeds the 1 MiB limit" }
      );
    });
  } finally {
    if (previousDirectory === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousDirectory;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("export response rejects output larger than 1 MiB", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-export-"));
  const previousDirectory = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = directory;
  try {
    await writeFile(
      join(directory, "large.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "large-entry",
            role: "user",
            content: "x".repeat(1024 * 1024 + 1),
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      })
    );
    await withServer({ session: { id: "default", async run() {} } }, async (base) => {
      const res = await fetch(`${base}/api/sessions/large/export`);
      assert.equal(res.status, 413);
      assert.deepEqual(
        await res.json(),
        { error: "export response exceeds the 1 MiB limit" }
      );
    });
  } finally {
    if (previousDirectory === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousDirectory;
    }
    await rm(directory, { recursive: true, force: true });
  }
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
