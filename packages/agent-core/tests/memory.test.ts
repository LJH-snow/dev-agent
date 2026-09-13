import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addUsage,
  createEvidenceAuditExport,
  createMemoryEntry,
  FileMemory,
  InMemoryMemory,
} from "../dist/index.js";

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

test("in-memory memory records applied change-set evidence idempotently", async () => {
  const memory = new InMemoryMemory();
  const first = makeChangeSetRecord({ recordedAt: "2026-09-13T00:00:00.000Z" });
  const replacement = makeChangeSetRecord({ recordedAt: "2026-09-13T00:01:00.000Z" });

  await memory.recordChangeSet(first);
  await memory.recordChangeSet(replacement);

  assert.deepEqual(await memory.changeSets(), [replacement]);
});

test("file memory persists applied change-set evidence across instances and writes", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "sessions", "change-sets.json");
    const first = new FileMemory({ filePath });
    const record = makeChangeSetRecord();

    await first.append(createMemoryEntry("user", "apply and verify"));
    await first.recordChangeSet(record);
    await first.recordUsage({ promptTokens: 4, completionTokens: 2, totalTokens: 6 });
    await first.setSummary({
      lastEntryId: "entry-1",
      entriesCovered: 1,
      text: "apply and verify",
    });

    const reopened = new FileMemory({ filePath });
    assert.deepEqual(await reopened.changeSets(), [record]);
    assert.equal((await reopened.entries()).length, 1);
    assert.deepEqual((await reopened.getMetadata())?.usage, {
      promptTokens: 4,
      completionTokens: 2,
      totalTokens: 6,
    });
    assert.equal((await reopened.getSummary())?.text, "apply and verify");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file memory treats a missing changeSets field as an empty evidence list", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "legacy-change-sets.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        entries: [createMemoryEntry("user", "legacy")],
      }),
      "utf8"
    );

    const memory = new FileMemory({ filePath });
    assert.deepEqual(await memory.changeSets(), []);
    assert.equal((await memory.entries())[0]?.content, "legacy");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file memory rejects unsafe persisted change-set evidence", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "unsafe-change-sets.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        entries: [],
        changeSets: [
          {
            changeSetId: "cs-unsafe",
            sessionId: "session-1",
            workingDirectory: dir,
            files: [
              {
                path: "/outside/workspace.txt",
                kind: "file",
                afterHash: "hash",
                additions: 1,
                deletions: 0,
                beforeExists: false,
                afterExists: true,
              },
            ],
            additions: 1,
            deletions: 0,
            createdAt: "2026-09-13T00:00:00.000Z",
            recordedAt: "2026-09-13T00:00:00.000Z",
            state: "applied",
          },
        ],
      }),
      "utf8"
    );

    const memory = new FileMemory({ filePath });
    await assert.rejects(() => memory.changeSets(), /Invalid memory file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeChangeSetRecord(
  overrides: Partial<import("../dist/index.js").AppliedChangeSetRecord> = {}
) {
  return {
    changeSetId: "cs-memory",
    sessionId: "session-memory",
    workingDirectory: "/workspace",
    files: [
      {
        path: "src/example.ts",
        kind: "file" as const,
        beforeHash: "b".repeat(64),
        afterHash: "a".repeat(64),
        additions: 2,
        deletions: 1,
        beforeExists: true,
        afterExists: true,
      },
    ],
    additions: 2,
    deletions: 1,
    createdAt: "2026-09-13T00:00:00.000Z",
    recordedAt: "2026-09-13T00:00:01.000Z",
    state: "applied" as const,
    ...overrides,
  };
}

test("clearing memory removes applied change-set evidence", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "clear-change-sets.json");
    const memory = new FileMemory({ filePath });
    await memory.recordChangeSet(makeChangeSetRecord());
    await memory.clear();

    assert.deepEqual(await memory.changeSets(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory retention bounds validation history but protects applied change sets", async () => {
  const memory = new InMemoryMemory({
    evidenceRetention: { maxValidations: 2, maxChangeSets: 1 },
  });

  for (let index = 1; index <= 3; index += 1) {
    await memory.recordValidation({
      ...makeValidationResult("passed"),
      validationId: `validation:${index}`,
      changeSetId: `cs-${index}`,
    });
  }
  assert.deepEqual(
    (await memory.validations()).map((record) => record.validationId),
    ["validation:2", "validation:3"]
  );

  await memory.recordChangeSet(makeChangeSetRecord({ changeSetId: "active-a" }));
  await memory.recordChangeSet(makeChangeSetRecord({ changeSetId: "active-b" }));
  assert.deepEqual(
    (await memory.changeSets()).map((record) => record.changeSetId),
    ["active-a", "active-b"]
  );

  const pruned = await memory.pruneEvidence({ maxChangeSets: 1 });
  assert.equal(pruned.changeSetsRemoved, 0);
  assert.equal(pruned.protectedChangeSets, 2);
});

test("file memory explicitly removes only rolled-back evidence and persists the result", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "retention.json");
    const memory = new FileMemory({
      filePath,
      evidenceRetention: { maxValidations: 10, maxChangeSets: 10 },
    });
    await memory.recordChangeSet(makeChangeSetRecord({ changeSetId: "active" }));
    await memory.recordChangeSet(
      makeChangeSetRecord({ changeSetId: "rolled-back", state: "rolled-back" })
    );

    const pruned = await memory.pruneEvidence({ removeRolledBack: true });
    assert.equal(pruned.changeSetsRemoved, 1);
    assert.equal(pruned.protectedChangeSets, 1);

    const reopened = new FileMemory({ filePath });
    assert.deepEqual(
      (await reopened.changeSets()).map((record) => record.changeSetId),
      ["active"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory marks an applied change set rolled-back without allowing it to reactivate", async () => {
  const memory = new InMemoryMemory({
    evidenceRetention: { maxValidations: 10, maxChangeSets: 10 },
  });
  await memory.recordChangeSet(makeChangeSetRecord({ changeSetId: "stateful" }));

  assert.equal(await memory.markChangeSetRolledBack("stateful"), true);
  assert.equal((await memory.changeSets())[0]?.state, "rolled-back");
  assert.equal(await memory.markChangeSetRolledBack("stateful"), false);
  await assert.rejects(
    () => memory.recordChangeSet(makeChangeSetRecord({ changeSetId: "stateful" })),
    /reactivate|rolled-back/
  );
  assert.equal((await memory.changeSets())[0]?.state, "rolled-back");
});

test("file memory persists a rolled-back transition and rejects reactivation", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "rolled-back-state.json");
    const memory = new FileMemory({ filePath });
    await memory.recordChangeSet(makeChangeSetRecord({ changeSetId: "stateful-file" }));

    assert.equal(await memory.markChangeSetRolledBack("stateful-file"), true);
    await assert.rejects(
      () => memory.recordChangeSet(makeChangeSetRecord({ changeSetId: "stateful-file" })),
      /reactivate|rolled-back/
    );

    const reopened = new FileMemory({ filePath });
    assert.equal((await reopened.changeSets())[0]?.state, "rolled-back");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file memory serializes concurrent evidence writes without losing entries", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "concurrent-retention.json");
    const memory = new FileMemory({
      filePath,
      evidenceRetention: { maxValidations: 10, maxChangeSets: 10 },
    });
    await Promise.all(
      Array.from({ length: 3 }, async (_, index) => {
        await memory.append(createMemoryEntry("user", `entry-${index}`));
        await memory.recordValidation({
          ...makeValidationResult("passed"),
          validationId: `validation:concurrent:${index}`,
          changeSetId: `cs-concurrent:${index}`,
        });
        await memory.recordChangeSet(
          makeChangeSetRecord({ changeSetId: `cs-concurrent:${index}` })
        );
      })
    );

    const reopened = new FileMemory({ filePath });
    assert.equal((await reopened.entries()).length, 3);
    assert.equal((await reopened.validations()).length, 3);
    assert.equal((await reopened.changeSets()).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory exposes a retention summary with protected applied guards", async () => {
  const memory = new InMemoryMemory({
    evidenceRetention: { maxValidations: 2, maxChangeSets: 3 },
  });
  await memory.recordValidation(makeValidationResult("passed"));
  await memory.recordChangeSet(makeChangeSetRecord({ changeSetId: "active-summary" }));
  await memory.recordChangeSet(
    makeChangeSetRecord({ changeSetId: "rolled-summary", state: "rolled-back" })
  );

  assert.deepEqual(await memory.evidenceSummary(), {
    validations: 1,
    changeSets: 2,
    protectedChangeSets: 1,
    rolledBackChangeSets: 1,
    retention: { maxValidations: 2, maxChangeSets: 3 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation",
  });
});

test("memory rejects non-positive or non-integer evidence retention limits", () => {
  assert.throws(
    () => new InMemoryMemory({ evidenceRetention: { maxValidations: 0 } }),
    /positive integer/
  );
  assert.throws(
    () => new FileMemory({ filePath: "/tmp/dev-agent-retention.json", evidenceRetention: { maxChangeSets: 1.5 } }),
    /positive integer/
  );
});


test("metadata audit projection is allowlisted, sorted, and immutable", () => {
  const validationLate = {
    ...makeValidationResult("failed"),
    validationId: "validation:z",
    changeSetId: "cs-z",
    recordedAt: "2026-09-13T00:02:00.000Z",
    summary: "contains a command-like summary",
    reason: "secret/path should not be exported",
  };
  const validationEarly = {
    ...makeValidationResult("passed"),
    validationId: "validation:a",
    changeSetId: "cs-a",
    recordedAt: "2026-09-13T00:01:00.000Z",
  };
  const changeSetLate = makeChangeSetRecord({
    changeSetId: "cs-z",
    recordedAt: "2026-09-13T00:04:00.000Z",
    files: [
      {
        path: "src\\z.ts",
        kind: "file",
        beforeHash: "b".repeat(64),
        afterHash: "a".repeat(64),
        additions: 3,
        deletions: 1,
        beforeExists: true,
        afterExists: true,
      },
      {
        path: "README.md",
        kind: "file",
        afterHash: "c".repeat(64),
        additions: 1,
        deletions: 0,
        beforeExists: false,
        afterExists: true,
      },
    ],
  });
  const changeSetEarly = makeChangeSetRecord({
    changeSetId: "cs-a",
    recordedAt: "2026-09-13T00:03:00.000Z",
  });
  const summary = {
    validations: 2,
    changeSets: 2,
    protectedChangeSets: 2,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
    injected: "must not leak",
  } as typeof summary & { injected: string };
  const inputSnapshot = structuredClone({
    validations: [validationLate, validationEarly],
    changeSets: [changeSetLate, changeSetEarly],
    summary,
  });

  const audit = createEvidenceAuditExport(
    "session-memory",
    [validationLate, validationEarly],
    [changeSetLate, changeSetEarly],
    summary,
    { generatedAt: "2026-09-13T00:05:00.000Z" }
  );

  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.sessionId, "session-memory");
  assert.equal(audit.generatedAt, "2026-09-13T00:05:00.000Z");
  assert.deepEqual(
    audit.validations.map((record) => record.validationId),
    ["validation:a", "validation:z"]
  );
  assert.deepEqual(
    audit.changeSets.map((record) => record.changeSetId),
    ["cs-a", "cs-z"]
  );
  assert.deepEqual(audit.validations[0]?.checks, [
    { id: "workspace:diff-check", status: "passed", durationMs: 12, exitCode: 0 },
  ]);
  assert.deepEqual(audit.changeSets[1]?.files.map((file) => file.path), ["README.md", "src/z.ts"]);

  assert.equal("summary" in (audit.validations[1] as object), false);
  assert.equal("reason" in (audit.validations[1] as object), false);
  const serialized = JSON.stringify(audit);
  for (const forbidden of [
    "contains a command-like summary",
    "secret/path should not be exported",
    '"command"',
    '"executable"',
    '"args"',
    '"cwd"',
    '"workingDirectory"',
    '"output"',
    '"error"',
    '"diff"',
    '"patch"',
    '"beforeImage"',
    '"injected"',
    "/workspace",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden field leaked: ${forbidden}`);
  }
  assert.deepEqual(
    audit.validations[1],
    {
      validationId: "validation:z",
      changeSetId: "cs-z",
      status: "failed",
      durationMs: 12,
      recordedAt: "2026-09-13T00:02:00.000Z",
      checks: [{ id: "workspace:diff-check", status: "failed", durationMs: 12, exitCode: 1 }],
    }
  );
  assert.deepEqual(inputSnapshot, {
    validations: [validationLate, validationEarly],
    changeSets: [changeSetLate, changeSetEarly],
    summary,
  });
});

test("metadata audit projection rejects absolute and escaping evidence paths", () => {
  const summary = {
    validations: 0,
    changeSets: 1,
    protectedChangeSets: 1,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
  };
  for (const path of ["../secret.txt", "/tmp/secret.txt", "C:\\secret.txt", "dir/../secret.txt", "bad\u0000name"]) {
    assert.throws(
      () =>
        createEvidenceAuditExport(
          "session-memory",
          [],
          [makeChangeSetRecord({ files: [{
            path,
            kind: "file",
            afterHash: "a".repeat(64),
            additions: 0,
            deletions: 0,
            beforeExists: false,
            afterExists: true,
          }] })],
          summary,
          { generatedAt: "2026-09-13T00:05:00.000Z" }
        ),
      /relative path/
    );
  }
});

test("metadata audit projection supports an empty legacy evidence snapshot", () => {
  const audit = createEvidenceAuditExport(
    "legacy",
    [],
    [],
    {
      validations: 0,
      changeSets: 0,
      protectedChangeSets: 0,
      rolledBackChangeSets: 0,
      retention: { maxValidations: 100, maxChangeSets: 100 },
      protectedChangeSetsReason: "applied change-set guards are retained for validation",
    },
    { generatedAt: "2026-09-13T00:06:00.000Z" }
  );
  assert.deepEqual(audit.validations, []);
  assert.deepEqual(audit.changeSets, []);
});
