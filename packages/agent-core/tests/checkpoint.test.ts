import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FileMemory,
  FileMemoryCheckpointStore,
  InMemoryMemory,
  createMemoryEntry,
} from "../dist/index.js";

test("FileMemory checkpoints persist memory anchors and change-set evidence references", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-checkpoint-"));
  const filePath = join(directory, "session.json");
  try {
    const memory = new FileMemory({ filePath, sessionId: "checkpoint-session" });
    const first = createMemoryEntry("user", "inspect the workspace");
    const second = createMemoryEntry("assistant", "workspace inspected");
    await memory.append(first);
    await memory.append(second);
    await memory.recordChangeSet?.({
      changeSetId: "change-1",
      sessionId: "checkpoint-session",
      workingDirectory: directory,
      files: [{
        path: "README.md",
        kind: "file",
        beforeHash: "a".repeat(64),
        afterHash: "b".repeat(64),
        additions: 1,
        deletions: 0,
        beforeExists: true,
        afterExists: true,
      }],
      additions: 1,
      deletions: 0,
      createdAt: new Date(1).toISOString(),
      recordedAt: new Date(2).toISOString(),
      state: "applied",
    });

    const checkpoint = await new FileMemoryCheckpointStore(memory).create();
    assert.equal(checkpoint.sessionId, "checkpoint-session");
    assert.equal(checkpoint.lastEntryId, second.id);
    assert.equal(checkpoint.entryCount, 2);
    assert.deepEqual(checkpoint.changeSetIds, ["change-1"]);

    const reopened = new FileMemory({ filePath });
    const store = new FileMemoryCheckpointStore(reopened);
    assert.deepEqual(await store.list(), [checkpoint]);
    assert.deepEqual(await store.inspect(checkpoint.id), checkpoint);
    assert.deepEqual(await store.restore(checkpoint.id), {
      checkpoint,
      memoryAnchor: {
        lastEntryId: second.id,
        entryCount: 2,
      },
      changeSetIds: ["change-1"],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rewind truncates only conversation entries and preserves workspace evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-checkpoint-rewind-"));
  const filePath = join(directory, "session.json");
  try {
    const memory = new FileMemory({ filePath, sessionId: "rewind-session" });
    const beforeOne = createMemoryEntry("user", "before one");
    const beforeTwo = createMemoryEntry("assistant", "before two");
    await memory.append(beforeOne);
    await memory.append(beforeTwo);
    const store = new FileMemoryCheckpointStore(memory);
    const checkpoint = await store.create();

    const checkpointSummary = {
      lastEntryId: beforeTwo.id,
      entriesCovered: 2,
      text: "summary that remains valid at the checkpoint",
    };
    await memory.setSummary?.(checkpointSummary);
    await memory.append(createMemoryEntry("user", "after one"));
    await memory.append(createMemoryEntry("assistant", "after two"));
    await memory.recordChangeSet?.({
      changeSetId: "change-after-checkpoint",
      sessionId: "rewind-session",
      workingDirectory: directory,
      files: [{
        path: "README.md",
        kind: "file",
        beforeHash: "a".repeat(64),
        afterHash: "b".repeat(64),
        additions: 1,
        deletions: 0,
        beforeExists: true,
        afterExists: true,
      }],
      additions: 1,
      deletions: 0,
      createdAt: new Date(3).toISOString(),
      recordedAt: new Date(4).toISOString(),
      state: "applied",
    });
    const laterCheckpoint = await store.create();

    const result = await store.rewind(checkpoint.id);

    assert.deepEqual(result, {
      checkpoint,
      removedEntryCount: 2,
      remainingEntryCount: 2,
      retainedCheckpointIds: [checkpoint.id],
      changeSetIds: [],
      workspaceChanged: false,
    });
    assert.deepEqual((await memory.entries()).map((entry) => entry.id), [
      beforeOne.id,
      beforeTwo.id,
    ]);
    assert.deepEqual(await memory.getSummary(), checkpointSummary);
    assert.deepEqual(await memory.changeSets(), [{
      changeSetId: "change-after-checkpoint",
      sessionId: "rewind-session",
      workingDirectory: directory,
      files: [{
        path: "README.md",
        kind: "file",
        beforeHash: "a".repeat(64),
        afterHash: "b".repeat(64),
        additions: 1,
        deletions: 0,
        beforeExists: true,
        afterExists: true,
      }],
      additions: 1,
      deletions: 0,
      createdAt: new Date(3).toISOString(),
      recordedAt: new Date(4).toISOString(),
      state: "applied",
    }]);
    assert.deepEqual(await store.list(), [checkpoint]);
    assert.notEqual(laterCheckpoint.id, checkpoint.id);

    const reopened = new FileMemory({ filePath });
    assert.deepEqual((await reopened.entries()).map((entry) => entry.id), [
      beforeOne.id,
      beforeTwo.id,
    ]);
    assert.deepEqual((await reopened.changeSets()).map((record) => record.changeSetId), [
      "change-after-checkpoint",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rewind rejects stale and foreign checkpoint anchors", async () => {
  const memory = new InMemoryMemory();
  const first = createMemoryEntry("user", "first");
  await memory.append(first);
  const store = new FileMemoryCheckpointStore(memory);
  const checkpoint = await store.create();

  await assert.rejects(
    store.rewind("checkpoint-does-not-exist"),
    /unknown checkpoint: checkpoint-does-not-exist/
  );
  await assert.rejects(
    memory.rewindToCheckpoint?.({
      ...checkpoint,
      lastEntryId: "stale-entry",
    }),
    /checkpoint anchor does not match current memory/
  );
  await assert.rejects(
    memory.rewindToCheckpoint?.({
      ...checkpoint,
      sessionId: "another-session",
    }),
    /checkpoint belongs to another session/
  );
  assert.deepEqual((await memory.entries()).map((entry) => entry.id), [first.id]);
});
