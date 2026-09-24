import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function postJson(base: string, path: string, body: Record<string, unknown>) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function parseSseBlock(block: string) {
  let type = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) type = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  return data ? { type, data: JSON.parse(data) } : undefined;
}

async function readSse(response: Response) {
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  const events: { type: string; data: any }[] = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const event = parseSseBlock(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
      if (event) events.push(event);
    }
  }
  return events;
}

const review = {
  changeSetId: "plan-server-1",
  files: [
    {
      path: "src/example.ts",
      kind: "file",
      beforeHash: "before",
      afterHash: "after",
      diff: "--- a/src/example.ts\n+++ b/src/example.ts\n@@\n-old\n+new\n",
      additions: 1,
      deletions: 1,
      beforeExists: true,
      afterExists: true,
    },
  ],
  additions: 1,
  deletions: 1,
  createdAt: "2026-09-22T00:00:00.000Z",
};

test("plan chat projects a pending review and approved apply uses the stored review", async () => {
  let receivedMode: string | undefined;
  const applied: any[] = [];
  const server = createDesktopServer({
    session: {
      async run(_message, emit, options) {
        receivedMode = options?.mode;
        (emit as any)({ type: "plan-review", data: { review } });
        emit({ type: "done", data: { status: "done", turns: 1 } });
      },
      async applyPlannedChangeSet(receivedReview, prompt, emit, options) {
        applied.push({ receivedReview, prompt, runId: options?.runId });
        emit({ type: "tool", data: { name: "filesystem", input: { action: "apply" } } });
        emit({ type: "validation", data: { status: "passed", changeSetId: review.changeSetId } });
        emit({ type: "done", data: { status: "done", turns: 1 } });
      },
    },
  });
  const base = await start(server);
  try {
    const planned = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "desktop-default",
        message: "prepare the change",
        mode: "plan",
      }),
    });
    assert.equal(planned.status, 200);
    const plannedEvents = await readSse(planned);
    assert.equal(receivedMode, "plan");
    assert.deepEqual(plannedEvents.find((event) => event.type === "plan-review")?.data.review, review);

    const appliedResponse = await fetch(`${base}/api/plans/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "desktop-default",
        changeSetId: review.changeSetId,
      }),
    });
    assert.equal(appliedResponse.status, 200);
    const appliedEvents = await readSse(appliedResponse);
    assert.ok(appliedEvents.some((event) => event.type === "validation"));
    assert.ok(appliedEvents.some((event) => event.type === "done"));
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0].receivedReview, review);
    assert.equal(applied[0].prompt, "prepare the change");
  } finally {
    await close(server);
  }
});

test("rejecting a pending plan removes it without invoking apply", async () => {
  let applyCalls = 0;
  const server = createDesktopServer({
    session: {
      async run(_message, emit) {
        (emit as any)({ type: "plan-review", data: { review } });
        emit({ type: "done", data: { status: "done", turns: 1 } });
      },
      async applyPlannedChangeSet() {
        applyCalls += 1;
      },
    },
  });
  const base = await start(server);
  try {
    const planned = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "prepare the change", mode: "plan" }),
    });
    await readSse(planned);

    const rejected = await fetch(`${base}/api/plans/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeSetId: review.changeSetId }),
    });
    assert.equal(rejected.status, 200);
    assert.deepEqual(await rejected.json(), {
      ok: true,
      changeSetId: review.changeSetId,
      rejected: true,
    });

    const applied = await fetch(`${base}/api/plans/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeSetId: review.changeSetId }),
    });
    assert.equal(applied.status, 404);
    assert.equal(applyCalls, 0);
  } finally {
    await close(server);
  }
});

test("a pending plan can only be applied once at a time", async () => {
  const applyStarted = deferred<void>();
  const releaseApply = deferred<void>();
  let applyCalls = 0;
  const server = createDesktopServer({
    session: {
      async run(_message, emit) {
        (emit as any)({ type: "plan-review", data: { review } });
        emit({ type: "done", data: { status: "done", turns: 1 } });
      },
      async applyPlannedChangeSet(_review, _prompt, emit) {
        applyCalls += 1;
        applyStarted.resolve();
        await releaseApply.promise;
        emit({ type: "done", data: { status: "done", turns: 1 } });
      },
    },
  });
  const base = await start(server);
  try {
    const planned = await postJson(base, "/api/chat", {
      message: "prepare the change",
      mode: "plan",
    });
    await readSse(planned);

    const firstResponsePromise = postJson(base, "/api/plans/apply", {
      changeSetId: review.changeSetId,
    });
    await applyStarted.promise;
    const firstResponse = await firstResponsePromise;

    const secondResponse = await postJson(base, "/api/plans/apply", {
      changeSetId: review.changeSetId,
    });
    assert.equal(secondResponse.status, 409);
    assert.deepEqual(await secondResponse.json(), {
      error: "a chat, validation, cleanup, or rollback request is already running in this session",
    });
    assert.equal(applyCalls, 1);

    releaseApply.resolve();
    const firstEvents = await readSse(firstResponse);
    assert.ok(firstEvents.some((event) => event.type === "done"));
  } finally {
    releaseApply.resolve();
    await close(server);
  }
});

test("cancelling plan application restores the pending plan for retry", async () => {
  const applyStarted = deferred<void>();
  let applyCalls = 0;
  const server = createDesktopServer({
    session: {
      async run(_message, emit) {
        (emit as any)({ type: "plan-review", data: { review } });
        emit({ type: "done", data: { status: "done", turns: 1 } });
      },
      async applyPlannedChangeSet(_review, _prompt, emit, options) {
        applyCalls += 1;
        if (applyCalls === 1) {
          applyStarted.resolve();
          await new Promise<void>((resolve) => {
            if (options?.signal?.aborted) {
              resolve();
              return;
            }
            options?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          emit({ type: "done", data: { status: "aborted", turns: 1 } });
          return;
        }
        emit({ type: "done", data: { status: "done", turns: 1 } });
      },
    },
  });
  const base = await start(server);
  try {
    const planned = await postJson(base, "/api/chat", {
      message: "prepare the change",
      mode: "plan",
    });
    await readSse(planned);

    const firstResponsePromise = postJson(base, "/api/plans/apply", {
      changeSetId: review.changeSetId,
    });
    await applyStarted.promise;
    const firstResponse = await firstResponsePromise;

    const cancelled = await postJson(base, "/api/chat/cancel", {});
    assert.equal(cancelled.status, 200);
    assert.deepEqual(await cancelled.json(), {
      sessionId: "desktop-default",
      cancelled: true,
    });
    const firstEvents = await readSse(firstResponse);
    assert.equal(firstEvents.at(-1)?.data.status, "aborted");

    const retryResponse = await postJson(base, "/api/plans/apply", {
      changeSetId: review.changeSetId,
    });
    assert.equal(retryResponse.status, 200);
    const retryEvents = await readSse(retryResponse);
    assert.ok(retryEvents.some((event) => event.type === "done"));
    assert.equal(applyCalls, 2);
  } finally {
    await close(server);
  }
});

test("pending plans stay isolated when sessions share a change-set id", async () => {
  const applied: { sessionId: string; prompt: string }[] = [];
  const sharedReview = { ...review, changeSetId: "shared-plan" };
  const createSession = (sessionId: string) => ({
    id: sessionId,
    async run(_message: string, emit: any) {
      emit({ type: "plan-review", data: { review: sharedReview } });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
    async applyPlannedChangeSet(
      _receivedReview: unknown,
      prompt: string,
      emit: any,
    ) {
      applied.push({ sessionId, prompt });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  });
  const server = createDesktopServer({
    session: createSession("alpha"),
    createSession,
  });
  const base = await start(server);
  try {
    const alphaPlan = await postJson(base, "/api/chat", {
      sessionId: "alpha",
      message: "alpha prompt",
      mode: "plan",
    });
    await readSse(alphaPlan);
    const betaPlan = await postJson(base, "/api/chat", {
      sessionId: "beta",
      message: "beta prompt",
      mode: "plan",
    });
    await readSse(betaPlan);

    const rejected = await postJson(base, "/api/plans/reject", {
      sessionId: "beta",
      changeSetId: sharedReview.changeSetId,
    });
    assert.equal(rejected.status, 200);

    const alphaApply = await postJson(base, "/api/plans/apply", {
      sessionId: "alpha",
      changeSetId: sharedReview.changeSetId,
    });
    assert.equal(alphaApply.status, 200);
    await readSse(alphaApply);
    assert.deepEqual(applied, [{ sessionId: "alpha", prompt: "alpha prompt" }]);

    const betaApply = await postJson(base, "/api/plans/apply", {
      sessionId: "beta",
      changeSetId: sharedReview.changeSetId,
    });
    assert.equal(betaApply.status, 404);
  } finally {
    await close(server);
  }
});


test("renaming a session preserves its pending plan for the new id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-plan-rename-"));
  const previousDirectory = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = directory;
  await writeFile(join(directory, "desktop-default.json"), "{}");
  const applied: { sessionId: string; prompt: string }[] = [];
  const createSession = (sessionId: string) => ({
    id: sessionId,
    async run(_message: string, emit: any) {
      emit({ type: "plan-review", data: { review } });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
    async applyPlannedChangeSet(
      _receivedReview: unknown,
      prompt: string,
      emit: any,
    ) {
      applied.push({ sessionId, prompt });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  });
  const server = createDesktopServer({
    session: createSession("desktop-default"),
    createSession,
  });
  const base = await start(server);
  try {
    const planned = await postJson(base, "/api/chat", {
      sessionId: "desktop-default",
      message: "keep this plan",
      mode: "plan",
    });
    assert.equal(planned.status, 200);
    await readSse(planned);

    const renamed = await postJson(base, "/api/sessions/desktop-default/rename", {
      sessionId: "renamed-plan",
    });
    assert.equal(renamed.status, 200);

    const appliedResponse = await postJson(base, "/api/plans/apply", {
      sessionId: "renamed-plan",
      changeSetId: review.changeSetId,
    });
    assert.equal(appliedResponse.status, 200);
    await readSse(appliedResponse);
    assert.deepEqual(applied, [{ sessionId: "renamed-plan", prompt: "keep this plan" }]);
  } finally {
    await close(server);
    if (previousDirectory === undefined) delete process.env.DEV_AGENT_SESSION_DIR;
    else process.env.DEV_AGENT_SESSION_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
