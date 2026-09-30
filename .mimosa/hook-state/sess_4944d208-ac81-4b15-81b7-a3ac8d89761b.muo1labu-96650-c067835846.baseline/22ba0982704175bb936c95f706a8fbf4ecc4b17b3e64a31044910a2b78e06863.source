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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function chat(base: string, sessionId: string): Promise<Response> {
  return fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "continue", sessionId }),
  });
}

test("GET /api/sessions/<id>/run replays the live run and supports a sequence cursor", async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  const session = {
    id: "default",
    async run(_message: string, emit: (event: any) => void, options: any = {}) {
      started.resolve();
      emit({ type: "token", data: { token: "partial" } });
      await Promise.race([
        release.promise,
        new Promise<void>((resolve) => options.signal?.addEventListener("abort", resolve, { once: true })),
      ]);
      if (!options.signal?.aborted) {
        emit({ type: "done", data: { status: "done", turns: 1 } });
      }
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const responsePromise = chat(base, "default");
    await started.promise;

    const runningResponse = await fetch(`${base}/api/sessions/default/run`);
    assert.equal(runningResponse.status, 200);
    const running: any = await runningResponse.json();
    assert.equal(running.schemaVersion, 1);
    assert.equal(running.sessionId, "default");
    assert.equal(running.active, true);
    assert.equal(running.status, "running");
    assert.match(running.runId, /^[0-9a-f-]{36}$/);
    assert.equal(running.live.assistant, "partial");
    assert.ok(running.sequence >= 1);
    assert.deepEqual(
      running.events.map((event: any) => event.type),
      ["token"],
    );

    release.resolve();
    const response = await responsePromise;
    assert.equal(response.status, 200);
    await response.text();

    const completedResponse = await fetch(`${base}/api/sessions/default/run`);
    const completed: any = await completedResponse.json();
    assert.equal(completed.active, false);
    assert.equal(completed.status, "done");
    assert.ok(completed.events.some((event: any) => event.type === "done"));

    const tailResponse = await fetch(
      `${base}/api/sessions/default/run?after=${running.sequence}`,
    );
    const tail: any = await tailResponse.json();
    assert.deepEqual(tail.events.map((event: any) => event.type), ["done"]);
    assert.equal(tail.runId, running.runId);
  } finally {
    release.resolve();
    await close(server);
  }
});

test("run snapshots and session summaries stay isolated between sessions", async () => {
  const gates = new Map<string, ReturnType<typeof deferred<void>>>();
  const makeSession = (id: string) => ({
    id,
    async run(_message: string, emit: (event: any) => void) {
      const gate = deferred<void>();
      gates.set(id, gate);
      emit({ type: "token", data: { token: `from ${id}` } });
      await gate.promise;
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  });
  const server = createDesktopServer({
    session: makeSession("default"),
    createSession: makeSession,
  });
  const base = await start(server);
  try {
    const defaultResponsePromise = chat(base, "default");
    const otherResponsePromise = chat(base, "other");
    for (const id of ["default", "other"]) {
      while (!gates.has(id)) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    const [defaultRun, otherRun, sessions] = await Promise.all([
      fetch(`${base}/api/sessions/default/run`).then((response) => response.json()),
      fetch(`${base}/api/sessions/other/run`).then((response) => response.json()),
      fetch(`${base}/api/sessions`).then((response) => response.json()),
    ]) as any[];

    assert.equal(defaultRun.events[0].data.token, "from default");
    assert.equal(otherRun.events[0].data.token, "from other");
    assert.notEqual(defaultRun.runId, otherRun.runId);

    const defaultSummary = sessions.sessions.find((entry: any) => entry.sessionId === "default");
    const otherSummary = sessions.sessions.find((entry: any) => entry.sessionId === "other");
    assert.equal(defaultSummary.run.status, "running");
    assert.equal(otherSummary.run.status, "running");
    assert.equal(defaultSummary.run.runId, defaultRun.runId);
    assert.equal(otherSummary.run.runId, otherRun.runId);

    gates.get("default")?.resolve();
    gates.get("other")?.resolve();
    await (await defaultResponsePromise).text();
    await (await otherResponsePromise).text();
  } finally {
    for (const gate of gates.values()) gate.resolve();
    await close(server);
  }
});
