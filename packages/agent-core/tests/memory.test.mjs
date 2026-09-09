import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMemoryEntry, FileMemory } from "../dist/index.js";

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
