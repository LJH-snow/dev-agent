import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
    const validation = {
      validationId: "validation:alpha-change",
      changeSetId: "alpha-change",
      status: "passed",
      checks: [
        {
          id: "workspace:diff-check",
          label: "Check workspace diff",
          command: {
            executable: "git",
            args: ["diff", "--check", "--", "target.md"],
            cwd: "/workspace",
            timeoutMs: 30_000,
          },
          status: "passed",
          durationMs: 7,
          exitCode: 0,
        },
      ],
      durationMs: 7,
      summary: "validation passed: 1 passed",
      recordedAt: "2026-01-01T00:02:00.000Z",
    };
    const failedValidation = {
      validationId: "validation:beta-change",
      changeSetId: "beta-change",
      status: "failed",
      checks: [],
      durationMs: 4,
      summary: "validation failed: 0 passed",
      recordedAt: "2026-01-01T00:04:00.000Z",
    };
    const changeSet = {
      changeSetId: "alpha-change",
      sessionId: "alpha",
      workingDirectory: "/workspace",
      files: [
        {
          path: "target.md",
          kind: "file",
          beforeHash: "b".repeat(64),
          afterHash: "a".repeat(64),
          additions: 1,
          deletions: 1,
          beforeExists: true,
          afterExists: true,
        },
      ],
      additions: 1,
      deletions: 1,
      createdAt: "2026-01-01T00:01:00.000Z",
      recordedAt: "2026-01-01T00:01:01.000Z",
      state: "applied",
    };
    const failedChangeSet = {
      ...changeSet,
      changeSetId: "beta-change",
      files: [{ ...changeSet.files[0], path: "other.md" }],
    };
    await writeFile(
      join(dir, "alpha.json"),
      JSON.stringify({ version: 1, metadata: {
        sessionId: "alpha",
        createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-01-01T00:01:00.000Z",
          entryCount: entries.length,
          usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
        }, entries, validations: [validation, failedValidation], changeSets: [changeSet, failedChangeSet] }),
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
    assert.deepEqual(alpha.evidenceSummary, {
      validations: 2,
      changeSets: 2,
      protectedChangeSets: 2,
      rolledBackChangeSets: 0,
      retention: { maxValidations: 100, maxChangeSets: 100 },
      protectedChangeSetsReason: "applied change-set guards are retained for validation",
    });

    const history = await fetch(`${base}/api/sessions/alpha/messages`);
    assert.equal(history.status, 200);
    const body: any = await history.json();
    assert.equal(body.sessionId, "alpha");
    assert.deepEqual(body.evidenceSummary, alpha.evidenceSummary);
    assert.deepEqual(
      body.messages.map((message) => message.content),
      ["hello", "hi"]
    );
    assert.deepEqual(body.validations, [validation, failedValidation]);
    assert.deepEqual(body.changeSets, [changeSet, failedChangeSet]);

    const filtered = await fetch(
      `${base}/api/sessions/alpha/messages?changeSetId=alpha-change&status=passed`
    );
    assert.equal(filtered.status, 200);
    const filteredBody: any = await filtered.json();
    assert.deepEqual(filteredBody.validations, [validation]);
    assert.deepEqual(filteredBody.changeSets, [changeSet]);

    const attemptFiltered = await fetch(
      `${base}/api/sessions/alpha/messages?validationId=${encodeURIComponent(failedValidation.validationId)}`
    );
    assert.equal(attemptFiltered.status, 200);
    const attemptFilteredBody: any = await attemptFiltered.json();
    assert.deepEqual(attemptFilteredBody.validations, [failedValidation]);
    assert.deepEqual(attemptFilteredBody.changeSets, [failedChangeSet]);

    const invalidFilter = await fetch(`${base}/api/sessions/alpha/messages?status=unknown`);
    assert.equal(invalidFilter.status, 400);

    const memoryBeforeAudit = await readFile(join(dir, "alpha.json"));
    const auditResponse = await fetch(`${base}/api/sessions/alpha/evidence`);
    assert.equal(auditResponse.status, 200);
    assert.match(auditResponse.headers.get("content-type") ?? "", /application\/json/);
    const audit: any = await auditResponse.json();
    assert.equal(audit.schemaVersion, 1);
    assert.equal(audit.sessionId, "alpha");
    assert.deepEqual(audit.validations.map((record) => record.validationId), [
      validation.validationId,
      failedValidation.validationId,
    ]);
    assert.deepEqual(audit.changeSets.map((record) => record.changeSetId), [
      changeSet.changeSetId,
      failedChangeSet.changeSetId,
    ]);
    assert.equal(Object.hasOwn(audit.validations[0], "summary"), false);
    assert.equal(Object.hasOwn(audit.validations[0].checks[0], "command"), false);
    assert.equal(Object.hasOwn(audit.changeSets[0], "workingDirectory"), false);
    assert.equal(JSON.stringify(audit).includes("/workspace"), false);

    const filteredAuditResponse = await fetch(
      `${base}/api/sessions/alpha/evidence?status=failed`
    );
    assert.equal(filteredAuditResponse.status, 200);
    const filteredAudit: any = await filteredAuditResponse.json();
    assert.deepEqual(filteredAudit.validations.map((record) => record.validationId), [
      failedValidation.validationId,
    ]);
    assert.deepEqual(filteredAudit.changeSets.map((record) => record.changeSetId), [
      failedChangeSet.changeSetId,
    ]);

    const invalidAuditFilter = await fetch(
      `${base}/api/sessions/alpha/evidence?status=not-a-status`
    );
    assert.equal(invalidAuditFilter.status, 400);

    for (const rawLimit of ["0", "-1", "not-a-number", "10485761"]) {
      const invalidLimit = await fetch(
        `${base}/api/sessions/alpha/evidence?maxBytes=${encodeURIComponent(rawLimit)}`
      );
      assert.equal(invalidLimit.status, 400, rawLimit);
    }

    const limitedAuditResponse = await fetch(
      `${base}/api/sessions/alpha/evidence?maxValidations=1`
    );
    assert.equal(limitedAuditResponse.status, 413);
    assert.deepEqual(await limitedAuditResponse.json(), {
      error: "evidence audit limit exceeded",
      code: "EVIDENCE_AUDIT_LIMIT_EXCEEDED",
      kind: "validations",
      limit: 1,
      actual: 2,
    });
    assert.deepEqual(await readFile(join(dir, "alpha.json")), memoryBeforeAudit);

    const previewResponse = await fetch(
      `${base}/api/sessions/alpha/evidence/preview?status=failed`
    );
    assert.equal(previewResponse.status, 200);
    assert.match(previewResponse.headers.get("content-type") ?? "", /application\/json/);
    const preview: any = await previewResponse.json();
    assert.deepEqual(Object.keys(preview), [
      "schemaVersion",
      "sessionId",
      "generatedAt",
      "validationCount",
      "changeSetCount",
      "fileCount",
      "serializedBytes",
    ]);
    assert.equal(preview.schemaVersion, 1);
    assert.equal(preview.sessionId, "alpha");
    assert.equal(preview.validationCount, 1);
    assert.equal(preview.changeSetCount, 1);
    assert.equal(preview.fileCount, 1);
    assert.equal(Number.isSafeInteger(preview.serializedBytes), true);
    assert.ok(preview.serializedBytes > 0);
    assert.equal(JSON.stringify(preview).includes("/workspace"), false);
    assert.deepEqual(await readFile(join(dir, "alpha.json")), memoryBeforeAudit);

    const unsupportedPreviewLimit = await fetch(
      `${base}/api/sessions/alpha/evidence/preview?maxBytes=1`
    );
    assert.equal(unsupportedPreviewLimit.status, 400);
    assert.match(await unsupportedPreviewLimit.text(), /require \/evidence/);
    assert.deepEqual(await readFile(join(dir, "alpha.json")), memoryBeforeAudit);

    const exported = await fetch(`${base}/api/sessions/alpha/export`);
    assert.equal(exported.status, 200);
    const transcript = await exported.text();
    assert.match(transcript, /Validation evidence/);
    assert.match(transcript, /validation:alpha-change/);
    assert.match(transcript, /workspace:diff-check/);
    assert.match(transcript, /Change-set evidence/);
    assert.match(transcript, /target\.md/);

    const filteredExport = await fetch(`${base}/api/sessions/alpha/export?status=failed`);
    assert.equal(filteredExport.status, 200);
    const filteredTranscript = await filteredExport.text();
    assert.match(filteredTranscript, /beta-change/);
    assert.doesNotMatch(filteredTranscript, /alpha-change/);
    assert.match(transcript, /Evidence retention/);
    assert.match(transcript, /protectedChangeSetsReason/);
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

test("rename refuses a target with an active Desktop run", async () => {
  await withSessionDir(async (dir) => {
    let release;
    let started;
    const targetStarted = new Promise((resolve) => {
      started = resolve;
    });
    const server = createDesktopServer({
      session: fakeSession("default"),
      createSession: (sessionId) => ({
        id: sessionId,
        async run(_message, emit) {
          emit({ type: "turn", data: { turn: 1 } });
          started();
          await new Promise((resolve) => {
            release = resolve;
          });
          emit({ type: "done", data: { status: "done", turns: 1 } });
        },
      }),
    });
    const base = await start(server);
    try {
      await writeFile(join(dir, "before.json"), JSON.stringify({ version: 1, entries: [] }));
      const targetChat: Promise<Response> = chat(base, "target", "keep running");
      await targetStarted;

      const response = await fetch(`${base}/api/sessions/before/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "target" }),
      });

      assert.equal(response.status, 409);
      const body: any = await response.json();
      assert.match(body.error, /already running/);
      assert.equal(await exists(join(dir, "before.json")), true);
      assert.equal(await exists(join(dir, "target.json")), false);
      release();
      await targetChat.then((response) => response.text());
    } finally {
      release?.();
      await close(server);
    }
  });
});

test("concurrent renames of the same source fail closed", async () => {
  await withSessionDir(async (dir) => {
    const server = createDesktopServer({ session: fakeSession("default") });
    const base = await start(server);
    try {
      await writeFile(join(dir, "before.json"), JSON.stringify({ version: 1, entries: [] }));

      const request = () =>
        fetch(`${base}/api/sessions/before/rename`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "after" }),
        });
      const [first, second] = await Promise.all([request(), request()]);
      const statuses = [first.status, second.status].sort();

      assert.deepEqual(statuses, [200, 409]);
      assert.equal(await exists(join(dir, "before.json")), false);
      assert.equal(await exists(join(dir, "after.json")), true);
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
      const audit = await fetch(`${base}/api/sessions/missing/evidence`);
      assert.equal(audit.status, 404);
      const preview = await fetch(`${base}/api/sessions/missing/evidence/preview`);
      assert.equal(preview.status, 404);
    } finally {
      await close(server);
    }
  });
});


test("GET /api/sessions/<id>/evidence/preview hides malformed memory details", async () => {
  await withSessionDir(async (dir) => {
    await writeFile(join(dir, "corrupt.json"), "not-json", "utf8");
    const server = createDesktopServer({ session: fakeSession("default") });
    const base = await start(server);
    try {
      const response = await fetch(`${base}/api/sessions/corrupt/evidence/preview`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "evidence preview failed" });
    } finally {
      await close(server);
    }
  });
});

test("renaming a session to its own name is idempotent when it exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-rename-same-"));
  const previousDir = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = dir;

  const server = createDesktopServer({ session: fakeSession("default") });
  const base = await start(server);
  try {
    await writeFile(join(dir, "keep.json"), JSON.stringify({ version: 1, entries: [] }), "utf8");

    const res = await fetch(`${base}/api/sessions/keep/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "keep" }),
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { from: "keep", to: "keep", renamed: false });
    assert.equal(await exists(join(dir, "keep.json")), true, "the session stays put");
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

test("renaming an unknown session to its own name still returns 404", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-desktop-rename-missing-"));
  const previousDir = process.env.DEV_AGENT_SESSION_DIR;
  process.env.DEV_AGENT_SESSION_DIR = dir;

  const server = createDesktopServer({ session: fakeSession("default") });
  const base = await start(server);
  try {
    const res = await fetch(`${base}/api/sessions/ghost/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "ghost" }),
    });

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
