import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMemoryEntry } from "@dev-agent/agent-core";
import {
  BackgroundJobStore,
  hasUnmatchedToolCalls,
} from "../dist/background-jobs.js";

function record(id: string): Parameters<BackgroundJobStore["create"]>[0] {
  const now = new Date().toISOString();
  return {
    id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    projectRoot: "/workspace",
    workingDirectory: "/workspace",
    sessionId: id,
    configPath: "/home/user/.dev-agent/config.json",
    provider: "openai",
    model: "test-model",
    projectState: false,
    pendingOperation: "start",
  };
}

test("persists bounded private job metadata separately from the private task request", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-jobs-store-"));
  try {
    const store = new BackgroundJobStore(join(root, "jobs"));
    const id = "job-0123456789abcdef";
    await store.create(record(id), { prompt: "secret prompt", attachedContext: "private context" });

    const jobs = await store.list();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.id, id);
    assert.equal(jobs[0]?.status, "queued");
    assert.equal("prompt" in (jobs[0] ?? {}), false);
    assert.equal("modelOutput" in (jobs[0] ?? {}), false);

    const directory = join(root, "jobs", id);
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    const requestInfo = await stat(join(directory, "request.json"));
    assert.equal(requestInfo.mode & 0o777, 0o600);
    const request = await readFile(join(directory, "request.json"), "utf8");
    assert.match(request, /secret prompt/);
    assert.doesNotMatch(JSON.stringify(jobs), /secret prompt|private context/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancel is idempotent and running work is cancelled through a sidecar request", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-jobs-cancel-"));
  try {
    const store = new BackgroundJobStore(join(root, "jobs"));
    const id = "job-fedcba9876543210";
    await store.create(record(id), { prompt: "secret prompt" });
    const cancelled = await store.requestCancel(id);
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(await store.hasCancelRequest(id), true);
    assert.equal((await store.requestCancel(id))?.status, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker locks prevent concurrent execution and can be released", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-jobs-lock-"));
  try {
    const store = new BackgroundJobStore(join(root, "jobs"));
    const id = "job-1111111111111111";
    await store.create(record(id), { prompt: "work" });
    const release = await store.acquireWorkerLock(id);
    await assert.rejects(store.acquireWorkerLock(id), /already has a worker/);
    await release();
    const releaseAgain = await store.acquireWorkerLock(id);
    await releaseAgain();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume transcript validation rejects unmatched tool calls but accepts complete groups", () => {
  const call = createMemoryEntry("assistant", "checking", {
    toolCalls: [{ id: "call-1", name: "search", input: { query: "x" } }],
  });
  const response = createMemoryEntry("tool", "done", {
    toolCallId: "call-1",
    toolName: "search",
  });
  assert.equal(hasUnmatchedToolCalls([call]), true);
  assert.equal(hasUnmatchedToolCalls([call, response]), false);
});


test("stale preparing records become visible failures instead of remaining stuck forever", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-jobs-preparing-"));
  try {
    const store = new BackgroundJobStore(join(root, "jobs"));
    const id = "job-2222222222222222";
    const stale = record(id);
    await store.create({
      ...stale,
      status: "preparing",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    }, { prompt: "private initial request" });
    const snapshot = await store.get(id);
    assert.equal(snapshot?.status, "failed");
    assert.equal(snapshot?.errorCode, "workspace_invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
