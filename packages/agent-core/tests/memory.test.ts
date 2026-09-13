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

test("in-memory memory records structured validation evidence", async () => {
  const memory = new InMemoryMemory();
  const result = makeValidationResult("passed");

  await memory.recordValidation(result);

  const records = await memory.validations();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.validationId, result.validationId);
  assert.equal(records[0]?.changeSetId, result.changeSetId);
  assert.equal(records[0]?.status, "passed");
  assert.equal(records[0]?.recordedAt.length > 0, true);
  assert.deepEqual(records[0]?.checks, result.checks);
});

test("file memory persists validation evidence across instances and preserves it across writes", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "sessions", "validation.json");
    const first = new FileMemory({ filePath });
    const result = makeValidationResult("failed");

    await first.append(createMemoryEntry("user", "write and verify"));
    await first.recordValidation(result);
    await first.recordUsage({ promptTokens: 4, completionTokens: 2, totalTokens: 6 });
    await first.setSummary({
      lastEntryId: "entry-1",
      entriesCovered: 1,
      text: "write and verify",
    });

    const reopened = new FileMemory({ filePath });
    const records = await reopened.validations();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.status, "failed");
    assert.equal(records[0]?.reason, "test failed");
    assert.equal(records[0]?.recordedAt.length > 0, true);
    assert.equal((await reopened.entries()).length, 1);
    assert.deepEqual((await reopened.getMetadata())?.usage, {
      promptTokens: 4,
      completionTokens: 2,
      totalTokens: 6,
    });
    assert.equal((await reopened.getSummary())?.text, "write and verify");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file memory treats a missing validations field as an empty evidence list", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "legacy.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        entries: [createMemoryEntry("user", "legacy")],
      }),
      "utf8"
    );

    const memory = new FileMemory({ filePath });
    assert.deepEqual(await memory.validations(), []);
    assert.equal((await memory.entries())[0]?.content, "legacy");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearing file memory removes validation evidence", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "clear-validation.json");
    const memory = new FileMemory({ filePath });
    await memory.recordValidation(makeValidationResult("skipped"));
    await memory.clear();

    assert.deepEqual(await memory.validations(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeValidationResult(status: "passed" | "failed" | "skipped" | "blocked") {
  return {
    validationId: "validation:memory",
    changeSetId: "cs-memory",
    status,
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
        status,
        durationMs: 12,
        ...(status === "failed" ? { exitCode: 1, reason: "test failed" } : { exitCode: 0 }),
      },
    ],
    durationMs: 12,
    summary: `validation ${status}`,
    ...(status === "failed" ? { reason: "test failed" } : {}),
  };
}
