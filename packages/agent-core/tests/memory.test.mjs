import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { addUsage, createMemoryEntry, FileMemory, InMemoryMemory } from "../dist/index.js";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "dev-agent-memory-"));
}

test("file memory persists entries across instances", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "sessions", "cli.json");
    const first = new FileMemory({ filePath });
    await first.append(createMemoryEntry("user", "hello"));
    await first.append(createMemoryEntry("assistant", "hi there"));

    const second = new FileMemory({ filePath });
    const entries = await second.entries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].role, "user");
    assert.equal(entries[0].content, "hello");
    assert.equal(entries[1].role, "assistant");
    assert.equal(entries[1].content, "hi there");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file memory clear removes persisted history", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "cli.json");
    const memory = new FileMemory({ filePath });
    await memory.append(createMemoryEntry("user", "before clear"));
    await memory.clear();

    assert.deepEqual(await memory.entries(), []);
    const reopened = new FileMemory({ filePath });
    assert.deepEqual(await reopened.entries(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file memory rejects an invalid file", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "bad.json");
    const memory = new FileMemory({ filePath });
    await memory.append(createMemoryEntry("user", "ok"));

    writeFileSync(filePath, "not json", "utf8");

    await assert.rejects(() => memory.entries(), /Invalid memory file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("in-memory usage accumulates into metadata", async () => {
  const memory = new InMemoryMemory();
  await memory.recordUsage({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  await memory.recordUsage({ promptTokens: 3, completionTokens: 1, totalTokens: 4 });

  const metadata = await memory.getMetadata();
  assert.deepEqual(metadata?.usage, {
    promptTokens: 8,
    completionTokens: 3,
    totalTokens: 11,
  });
});

test("addUsage keeps cached prompt tokens in the running total", () => {
  const first = addUsage(undefined, {
    promptTokens: 10,
    completionTokens: 2,
    totalTokens: 12,
    cachedPromptTokens: 6,
    cacheCreationPromptTokens: 2,
  });
  const second = addUsage(first, {
    promptTokens: 5,
    completionTokens: 1,
    totalTokens: 6,
    cachedPromptTokens: 4,
    cacheCreationPromptTokens: 1,
  });

  assert.deepEqual(second, {
    promptTokens: 15,
    completionTokens: 3,
    totalTokens: 18,
    cachedPromptTokens: 10,
    cacheCreationPromptTokens: 3,
  });
});

test("file memory persists accumulated usage across instances", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "sessions", "usage.json");
    const first = new FileMemory({ filePath });
    await first.append(createMemoryEntry("user", "hello"));
    await first.recordUsage({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
    await first.recordUsage({ promptTokens: 2, completionTokens: 1, totalTokens: 3 });

    const reopened = new FileMemory({ filePath });
    const metadata = await reopened.getMetadata();
    assert.deepEqual(metadata?.usage, {
      promptTokens: 9,
      completionTokens: 4,
      totalTokens: 13,
    });
    assert.equal(metadata?.entryCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
