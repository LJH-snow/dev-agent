import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addUsage,
  createEvidenceAuditExport,
  createEvidenceAuditPreview,
  createMemoryEntry,
  EVIDENCE_AUDIT_LIMIT_CAPS,
  EVIDENCE_AUDIT_PREVIEW_SCHEMA_VERSION,
  EvidenceAuditLimitError,
  serializeEvidenceAuditExport,
  selectEvidenceForAudit,
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

test("file memory uses the configured session id for a new file", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "sessions", "smoke.json");
    const memory = new FileMemory({ filePath, sessionId: "smoke" });
    await memory.append(createMemoryEntry("user", "hello"));

    const metadata = await memory.getMetadata();
    assert.equal(metadata?.sessionId, "smoke");
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
    evidenceRetention: { maxValidations: 2, maxChangeSets: 3 },
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


test("metadata audit preview is a fixed allowlist with canonical UTF-8 byte accounting", () => {
  const summary = {
    validations: 2,
    changeSets: 2,
    protectedChangeSets: 2,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
    injected: "preview must not expose this secret",
  } as typeof summary & { injected: string };
  const validation = {
    ...makeValidationResult("failed"),
    validationId: "验证:🚀",
    changeSetId: "变更集:用户",
    recordedAt: "2026-09-14T00:09:00.000Z",
    summary: "secret command output",
    reason: "/workspace/secret",
  };
  const changeSet = makeChangeSetRecord({
    changeSetId: "变更集:用户",
    files: [
      makeChangeSetRecord().files[0]!,
      {
        ...makeChangeSetRecord().files[0]!,
        path: "文档/说明-✅.md",
      },
    ],
  });
  const generatedAt = "2026-09-14T00:10:00.000Z";
  const audit = createEvidenceAuditExport(
    "会话:用户",
    [validation],
    [changeSet],
    summary,
    { generatedAt }
  );
  const preview = createEvidenceAuditPreview(
    "会话:用户",
    [validation],
    [changeSet],
    summary,
    { generatedAt }
  );

  assert.deepEqual(Object.keys(preview), [
    "schemaVersion",
    "sessionId",
    "generatedAt",
    "validationCount",
    "changeSetCount",
    "fileCount",
    "serializedBytes",
  ]);
  assert.deepEqual(preview, {
    schemaVersion: EVIDENCE_AUDIT_PREVIEW_SCHEMA_VERSION,
    sessionId: "会话:用户",
    generatedAt,
    validationCount: 1,
    changeSetCount: 1,
    fileCount: 2,
    serializedBytes: Buffer.byteLength(serializeEvidenceAuditExport(audit), "utf8"),
  });
  const serialized = JSON.stringify(preview);
  assert.ok(preview.serializedBytes > serialized.length);
  for (const forbidden of [
    "secret command output",
    "/workspace/secret",
    "preview must not expose this secret",
    '"command"',
    '"workingDirectory"',
    '"beforeImage"',
    '"output"',
    '"error"',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden preview field leaked: ${forbidden}`);
  }
});

test("metadata audit preview and serializer are stable for reordered evidence and preserve inputs", () => {
  const summary = {
    validations: 2,
    changeSets: 2,
    protectedChangeSets: 2,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
  };
  const validationEarly = {
    ...makeValidationResult("passed"),
    validationId: "validation:a",
    changeSetId: "cs-a",
    recordedAt: "2026-09-14T00:11:00.000Z",
  };
  const validationLate = {
    ...makeValidationResult("failed"),
    validationId: "validation:z",
    changeSetId: "cs-z",
    recordedAt: "2026-09-14T00:12:00.000Z",
  };
  const changeSetEarly = makeChangeSetRecord({
    changeSetId: "cs-a",
    recordedAt: "2026-09-14T00:13:00.000Z",
  });
  const changeSetLate = makeChangeSetRecord({
    changeSetId: "cs-z",
    recordedAt: "2026-09-14T00:14:00.000Z",
  });
  const inputs = {
    validations: [validationLate, validationEarly],
    changeSets: [changeSetLate, changeSetEarly],
    summary,
  };
  const before = structuredClone(inputs);
  const options = { generatedAt: "2026-09-14T00:15:00.000Z" };
  const first = createEvidenceAuditExport(
    "session-preview",
    inputs.validations,
    inputs.changeSets,
    inputs.summary,
    options
  );
  const second = createEvidenceAuditExport(
    "session-preview",
    [validationEarly, validationLate],
    [changeSetEarly, changeSetLate],
    inputs.summary,
    options
  );
  assert.equal(serializeEvidenceAuditExport(first), JSON.stringify(first));
  assert.equal(serializeEvidenceAuditExport(first), serializeEvidenceAuditExport(second));
  assert.deepEqual(
    createEvidenceAuditPreview(
      "session-preview",
      inputs.validations,
      inputs.changeSets,
      inputs.summary,
      options
    ),
    createEvidenceAuditPreview(
      "session-preview",
      [validationEarly, validationLate],
      [changeSetEarly, changeSetLate],
      inputs.summary,
      options
    )
  );
  assert.deepEqual(inputs, before);
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


test("evidence lifecycle matrix preserves active guards through filtering and cleanup", async () => {
  const memory = new InMemoryMemory({
    evidenceRetention: { maxValidations: 2, maxChangeSets: 3 },
  });
  const active = makeChangeSetRecord({
    changeSetId: "matrix-active",
    recordedAt: "2026-09-13T00:10:00.000Z",
  });
  const rolledBack = makeChangeSetRecord({
    changeSetId: "matrix-rolled-back",
    recordedAt: "2026-09-13T00:11:00.000Z",
  });
  await memory.recordChangeSet(active);
  await memory.recordChangeSet(rolledBack);
  assert.equal(await memory.markChangeSetRolledBack(rolledBack.changeSetId), true);
  await memory.recordValidation({
    ...makeValidationResult("passed"),
    validationId: "validation:matrix-active",
    changeSetId: active.changeSetId,
  });
  await memory.recordValidation({
    ...makeValidationResult("failed"),
    validationId: "validation:matrix-rolled-back",
    changeSetId: rolledBack.changeSetId,
  });

  const filters = [
    { name: "all", filters: {}, validationIds: ["validation:matrix-active", "validation:matrix-rolled-back"], changeSetIds: ["matrix-active", "matrix-rolled-back"] },
    { name: "status", filters: { status: "failed" as const }, validationIds: ["validation:matrix-rolled-back"], changeSetIds: ["matrix-rolled-back"] },
    { name: "change set", filters: { changeSetId: active.changeSetId }, validationIds: ["validation:matrix-active"], changeSetIds: ["matrix-active"] },
    { name: "validation", filters: { validationId: "validation:matrix-rolled-back" }, validationIds: ["validation:matrix-rolled-back"], changeSetIds: ["matrix-rolled-back"] },
  ];
  for (const candidate of filters) {
    const selected = selectEvidenceForAudit(
      await memory.validations(),
      await memory.changeSets(),
      candidate.filters
    );
    assert.deepEqual(
      selected.validations.map((record) => record.validationId),
      candidate.validationIds,
      candidate.name
    );
    assert.deepEqual(
      selected.changeSets.map((record) => record.changeSetId),
      candidate.changeSetIds,
      candidate.name
    );
  }

  const beforeCleanup = await memory.changeSets();
  const cleanup = await memory.pruneEvidence({
    maxValidations: 1,
    maxChangeSets: 1,
    removeRolledBack: true,
  });
  assert.equal(cleanup.changeSetsRemoved, 1);
  assert.equal(cleanup.protectedChangeSets, 1);
  assert.deepEqual(
    (await memory.changeSets()).map((record) => record.changeSetId),
    [active.changeSetId]
  );
  assert.equal((await memory.changeSets())[0]?.state, "applied");
  assert.equal(beforeCleanup[0]?.state, "applied");

  const audit = createEvidenceAuditExport(
    "session-memory",
    await memory.validations(),
    await memory.changeSets(),
    await memory.evidenceSummary(),
    { generatedAt: "2026-09-13T00:12:00.000Z" }
  );
  assert.deepEqual(audit.changeSets.map((record) => record.changeSetId), [active.changeSetId]);
  assert.equal(audit.changeSets[0]?.state, "applied");
  assert.equal(audit.summary.protectedChangeSets, 1);
});

test("metadata audit projection reads a legacy memory with no evidence fields", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "legacy-audit.json");
    writeFileSync(filePath, JSON.stringify({ version: 1, entries: [] }), "utf8");
    const memory = new FileMemory({ filePath });
    const audit = createEvidenceAuditExport(
      "legacy",
      await memory.validations(),
      await memory.changeSets(),
      await memory.evidenceSummary(),
      { generatedAt: "2026-09-13T00:13:00.000Z" }
    );
    assert.equal(audit.schemaVersion, 1);
    assert.deepEqual(audit.validations, []);
    assert.deepEqual(audit.changeSets, []);
    assert.equal(audit.summary.validations, 0);
    assert.equal(audit.summary.changeSets, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("metadata audit limits reject validation, change-set, and file counts", () => {
  const summary = {
    validations: 2,
    changeSets: 2,
    protectedChangeSets: 2,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
  };
  const validations = [
    { ...makeValidationResult("passed"), validationId: "validation:a", recordedAt: "2026-09-14T00:00:00.000Z" },
    { ...makeValidationResult("passed"), validationId: "validation:b", recordedAt: "2026-09-14T00:00:01.000Z" },
  ];
  const firstChangeSet = makeChangeSetRecord({
    changeSetId: "cs:a",
    files: [
      makeChangeSetRecord().files[0]!,
      { ...makeChangeSetRecord().files[0]!, path: "src/second.ts" },
    ],
  });
  const secondChangeSet = makeChangeSetRecord({ changeSetId: "cs:b" });

  const cases = [
    {
      limits: { maxValidations: 1 },
      kind: "validations" as const,
      limit: 1,
      actual: 2,
    },
    {
      limits: { maxChangeSets: 1 },
      kind: "changeSets" as const,
      limit: 1,
      actual: 2,
    },
    {
      limits: { maxFiles: 1 },
      kind: "files" as const,
      limit: 1,
      actual: 3,
    },
  ];

  for (const candidate of cases) {
    assert.throws(
      () =>
        createEvidenceAuditExport(
          "session-memory",
          validations,
          [firstChangeSet, secondChangeSet],
          summary,
          { generatedAt: "2026-09-14T00:00:00.000Z", limits: candidate.limits }
        ),
      (error: unknown) => {
        assert.equal(error instanceof EvidenceAuditLimitError, true);
        assert.deepEqual(Object.keys(error as object).sort(), [
          "actual",
          "code",
          "kind",
          "limit",
        ]);
        assert.deepEqual(JSON.parse(JSON.stringify(error)), {
          code: "EVIDENCE_AUDIT_LIMIT_EXCEEDED",
          kind: candidate.kind,
          limit: candidate.limit,
          actual: candidate.actual,
        });
        return true;
      }
    );
  }
});

test("metadata audit byte limits count canonical UTF-8 bytes, not characters", () => {
  const summary = {
    validations: 0,
    changeSets: 1,
    protectedChangeSets: 1,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
  };
  const changeSet = makeChangeSetRecord({
    changeSetId: "变更集:🚀",
    files: [
      {
        ...makeChangeSetRecord().files[0]!,
        path: "文档/说明-✅.md",
      },
    ],
  });
  const baseline = createEvidenceAuditExport(
    "会话:用户",
    [],
    [changeSet],
    summary,
    { generatedAt: "2026-09-14T00:01:00.000Z" }
  );
  const serialized = JSON.stringify(baseline);
  const characterCount = serialized.length;
  const byteCount = Buffer.byteLength(serialized, "utf8");
  assert.ok(byteCount > characterCount);
  assert.ok(byteCount <= EVIDENCE_AUDIT_LIMIT_CAPS.maxBytes);

  assert.throws(
    () =>
      createEvidenceAuditExport(
        "会话:用户",
        [],
        [changeSet],
        summary,
        {
          generatedAt: "2026-09-14T00:01:00.000Z",
          limits: { maxBytes: characterCount },
        }
      ),
    (error: unknown) => {
      assert.equal(error instanceof EvidenceAuditLimitError, true);
      assert.deepEqual(JSON.parse(JSON.stringify(error)), {
        code: "EVIDENCE_AUDIT_LIMIT_EXCEEDED",
        kind: "bytes",
        limit: characterCount,
        actual: byteCount,
      });
      return true;
    }
  );
});

test("metadata audit limits preserve v1 output when omitted or empty", () => {
  const summary = {
    validations: 0,
    changeSets: 0,
    protectedChangeSets: 0,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
  };
  const options = { generatedAt: "2026-09-14T00:02:00.000Z" };
  const withoutLimits = createEvidenceAuditExport("session-memory", [], [], summary, options);
  const withEmptyLimits = createEvidenceAuditExport("session-memory", [], [], summary, {
    ...options,
    limits: {},
  });
  assert.deepEqual(withEmptyLimits, withoutLimits);
});

test("metadata audit limits validate positive integers and code-defined caps", () => {
  const summary = {
    validations: 0,
    changeSets: 0,
    protectedChangeSets: 0,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
  };
  const invalidLimits = [
    { maxValidations: 0 },
    { maxChangeSets: -1 },
    { maxFiles: 1.5 },
    { maxBytes: Number.NaN },
    { maxBytes: Number.POSITIVE_INFINITY },
    { maxBytes: EVIDENCE_AUDIT_LIMIT_CAPS.maxBytes + 1 },
    { maxValidations: EVIDENCE_AUDIT_LIMIT_CAPS.maxValidations + 1 },
  ];
  for (const limits of invalidLimits) {
    assert.throws(
      () =>
        createEvidenceAuditExport(
          "session-memory",
          [],
          [],
          summary,
          { generatedAt: "2026-09-14T00:03:00.000Z", limits }
        ),
      /positive integer|maximum|supported evidence audit limit/
    );
  }
});

test("metadata audit limit rejection does not mutate source evidence", () => {
  const summary = {
    validations: 1,
    changeSets: 1,
    protectedChangeSets: 1,
    rolledBackChangeSets: 0,
    retention: { maxValidations: 100, maxChangeSets: 100 },
    protectedChangeSetsReason: "applied change-set guards are retained for validation" as const,
  };
  const validations = [{ ...makeValidationResult("passed"), recordedAt: "2026-09-14T00:04:00.000Z" }];
  const changeSets = [makeChangeSetRecord()];
  const inputSnapshot = structuredClone({ validations, changeSets, summary });

  assert.throws(
    () =>
      createEvidenceAuditExport(
        "session-memory",
        validations,
        changeSets,
        summary,
        { generatedAt: "2026-09-14T00:04:00.000Z", limits: { maxBytes: 1 } }
      ),
    EvidenceAuditLimitError
  );
  assert.deepEqual({ validations, changeSets, summary }, inputSnapshot);
});

test("file memory rejects a memory file above the 16 MiB read limit", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "huge.json");
    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, entries: [{ role: "user", content: "x".repeat(16 * 1024 * 1024) }] }),
      "utf8"
    );
    const memory = new FileMemory({ filePath });

    await assert.rejects(
      () => memory.entries(),
      /memory file exceeds the 16 MiB read limit/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file memory rejects a write above the 16 MiB limit and keeps the previous content", async () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, "sessions", "bounded.json");
    const memory = new FileMemory({ filePath });
    const entry = createMemoryEntry("user", "x".repeat(16 * 1024 * 1024));

    await assert.rejects(
      () => memory.append(entry),
      /memory file exceeds the 16 MiB write limit/
    );
    await assert.rejects(() => readFile(filePath), { code: "ENOENT" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
