import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FilesystemTool, findUnexpectedRollbackEntry } from "../dist/index.js";

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false
  );
}

async function withWorkspace(run) {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-changeset-"));
  try {
    return await run(directory, { sessionId: "changeset-test", workingDirectory: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function applyPrepared(tool: any, prepared: any, context: any) {
  return tool.execute(prepared.executeInput, context);
}

test("an approved single-file change set applies atomically", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );

    const result = await applyPrepared(tool, prepared, context);

    assert.equal(result.ok, true);
    assert.equal(result.changeSetId, prepared.review.changeSetId);
    assert.equal(result.additions, 1);
    assert.equal(result.deletions, 1);
    assert.equal(await readFile(path, "utf8"), "after\n");
  });
});

test("apply preflights every file so a later preimage conflict leaves earlier files unchanged", async () => {
  await withWorkspace(async (directory, context) => {
    const firstPath = join(directory, "first.txt");
    const secondPath = join(directory, "second.txt");
    await writeFile(firstPath, "first-old\n", "utf8");
    await writeFile(secondPath, "second-old\n", "utf8");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      {
        action: "preview",
        changes: [
          { action: "write", path: "first.txt", content: "first-new\n" },
          { action: "write", path: "second.txt", content: "second-new\n" },
        ],
      },
      context
    );
    await writeFile(secondPath, "second-conflict\n", "utf8");

    await assert.rejects(
      () => applyPrepared(tool, { executeInput: { action: "apply", changeSetId: prepared.review.changeSetId } }, context),
      /second\.txt|hash|preimage/
    );
    assert.equal(await readFile(firstPath, "utf8"), "first-old\n");
    assert.equal(await readFile(secondPath, "utf8"), "second-conflict\n");
  });
});

test("rollback restores existing bytes and removes files created by the change set", async () => {
  await withWorkspace(async (directory, context) => {
    const existingPath = join(directory, "existing.txt");
    const createdPath = join(directory, "created.txt");
    await writeFile(existingPath, "original\n", "utf8");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      {
        action: "preview",
        changes: [
          { action: "write", path: "existing.txt", content: "changed\n" },
          { action: "write", path: "created.txt", content: "new\n" },
        ],
      },
      context
    );
    await applyPrepared(tool, prepared, context);
    assert.equal(await readFile(existingPath, "utf8"), "changed\n");
    assert.equal(await exists(createdPath), true);

    const result = await tool.rollbackChangeSet(prepared.review.changeSetId);

    assert.equal(result.ok, true);
    assert.equal(await readFile(existingPath, "utf8"), "original\n");
    assert.equal(await exists(createdPath), false);
  });
});

test("rollback removes only the empty directories created for mkdir", async () => {
  await withWorkspace(async (directory, context) => {
    const target = join(directory, "created", "nested");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet({ action: "mkdir", path: "created/nested" }, context);
    await applyPrepared(tool, prepared, context);
    assert.equal(await exists(target), true);

    await tool.rollbackChangeSet(prepared.review.changeSetId);

    assert.equal(await exists(target), false);
    assert.equal(await exists(join(directory, "created")), false);
  });
});

test("rollback directory inspection stops after the first unexpected entry", async () => {
  const directory = "/workspace/created";
  const createdDirectorySet = new Set([join(directory, "nested")]);
  const rollbackFileSet = new Set([join(directory, "created.txt")]);
  const entries = (async function* () {
    yield { name: "nested" } as Dirent;
    yield { name: "unexpected.txt" } as Dirent;
    throw new Error("entries after the first unexpected entry were consumed");
  })();

  const unexpectedPath = await findUnexpectedRollbackEntry(
    directory,
    entries,
    createdDirectorySet,
    rollbackFileSet
  );

  assert.equal(unexpectedPath, join(directory, "unexpected.txt"));
});

test("rollback refuses a created directory with an unexpected file and leaves it untouched", async () => {
  await withWorkspace(async (directory, context) => {
    const target = join(directory, "created");
    const unexpectedPath = join(target, "unexpected.txt");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet({ action: "mkdir", path: "created" }, context);
    await applyPrepared(tool, prepared, context);
    await writeFile(unexpectedPath, "leave me\n", "utf8");

    await assert.rejects(
      () => tool.rollbackChangeSet(prepared.review.changeSetId),
      /cannot rollback non-empty directory/
    );
    assert.equal(await readFile(unexpectedPath, "utf8"), "leave me\n");
  });
});

test("rollback refuses a postimage conflict without changing the conflicted file", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(tool, prepared, context);
    await writeFile(path, "changed-after-approval\n", "utf8");

    await assert.rejects(
      () => tool.rollbackChangeSet(prepared.review.changeSetId),
      /sample\.txt|postimage|hash/
    );
    assert.equal(await readFile(path, "utf8"), "changed-after-approval\n");
  });
});

test("a multi-file change set can create a directory and a file beneath it", async () => {
  await withWorkspace(async (directory, context) => {
    const nestedFile = join(directory, "created", "nested", "file.txt");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      {
        action: "preview",
        changes: [
          { action: "mkdir", path: "created/nested" },
          { action: "write", path: "created/nested/file.txt", content: "hello\n" },
        ],
      },
      context
    );

    await applyPrepared(tool, prepared, context);
    assert.equal(await readFile(nestedFile, "utf8"), "hello\n");

    await tool.rollbackChangeSet(prepared.review.changeSetId);
    assert.equal(await exists(nestedFile), false);
    assert.equal(await exists(join(directory, "created")), false);
  });
});

test("a change set may list files before the directories they need", async () => {
  await withWorkspace(async (directory, context) => {
    const nestedFile = join(directory, "created", "nested", "file.txt");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      {
        action: "preview",
        changes: [
          { action: "write", path: "created/nested/file.txt", content: "hello\n" },
          { action: "mkdir", path: "created/nested" },
        ],
      },
      context
    );

    await applyPrepared(tool, prepared, context);
    assert.equal(await readFile(nestedFile, "utf8"), "hello\n");
  });
});


test("an applied change-set guard verifies the postimage without changing files", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(tool, prepared, context);

    const observed = await tool.withAppliedChangeSet(
      prepared.review.changeSetId,
      async (review) => ({ changeSetId: review.changeSetId, path: review.files[0].path })
    );

    assert.deepEqual(observed, { changeSetId: prepared.review.changeSetId, path });
    assert.equal(await readFile(path, "utf8"), "after\n");
  });
});

test("an applied change-set guard rejects unknown, prepared, and rolled-back sets", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );

    await assert.rejects(
      () => tool.withAppliedChangeSet("missing", async () => undefined),
      /unknown or expired/
    );
    await assert.rejects(
      () => tool.withAppliedChangeSet(prepared.review.changeSetId, async () => undefined),
      /cannot be used because it is prepared/
    );

    await applyPrepared(tool, prepared, context);
    await tool.rollbackChangeSet(prepared.review.changeSetId);
    await assert.rejects(
      () => tool.withAppliedChangeSet(prepared.review.changeSetId, async () => undefined),
      /cannot be used because it is rolled-back/
    );
  });
});

test("an applied change-set guard rejects a postimage conflict before validation starts", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(tool, prepared, context);
    await writeFile(path, "changed-by-user\n", "utf8");
    let called = false;

    await assert.rejects(
      () => tool.withAppliedChangeSet(prepared.review.changeSetId, async () => {
        called = true;
      }),
      /postimage|hash conflict/
    );
    assert.equal(called, false);
    assert.equal(await readFile(path, "utf8"), "changed-by-user\n");
  });
});

test("an applied change-set guard catches a workspace change during validation", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(tool, prepared, context);

    await assert.rejects(
      () => tool.withAppliedChangeSet(prepared.review.changeSetId, async () => {
        await writeFile(path, "changed-during-validation\n", "utf8");
        return "must not escape";
      }),
      /postimage|hash conflict/
    );
    assert.equal(await readFile(path, "utf8"), "changed-during-validation\n");
  });
});

test("rollback cannot race an active applied change-set guard", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const tool: any = new FilesystemTool();
    const prepared = await tool.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(tool, prepared, context);

    let enteredResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    let releaseResolve: (() => void) | undefined;
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    const running = tool.withAppliedChangeSet(prepared.review.changeSetId, async () => {
      enteredResolve?.();
      await release;
    });
    await entered;

    await assert.rejects(
      () => tool.rollbackChangeSet(prepared.review.changeSetId),
      /already in flight/
    );
    releaseResolve?.();
    await running;
  });
});

test("a fresh filesystem tool restores applied evidence for a read-only guard", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const original: any = new FilesystemTool();
    const prepared = await original.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(original, prepared, context);

    const restored: any = new FilesystemTool();
    await restored.restoreAppliedChangeSet(toEvidence(prepared.review, directory, context.sessionId), context);

    const observed = await restored.withAppliedChangeSet(
      prepared.review.changeSetId,
      async (review) => ({ changeSetId: review.changeSetId, path: review.files[0].path })
    );
    assert.deepEqual(observed, { changeSetId: prepared.review.changeSetId, path });
    assert.equal(await readFile(path, "utf8"), "after\n");
  });
});

test("restoring applied evidence enforces session, working-directory, and relative-path binding", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const original: any = new FilesystemTool();
    const prepared = await original.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(original, prepared, context);
    const record = toEvidence(prepared.review, directory, context.sessionId);

    await assert.rejects(
      () => new (FilesystemTool as any)().restoreAppliedChangeSet({ ...record, sessionId: "other-session" }, context),
      /session/
    );
    await assert.rejects(
      () => new (FilesystemTool as any)().restoreAppliedChangeSet({ ...record, workingDirectory: join(directory, "alias") }, context),
      /working directory/
    );
    await assert.rejects(
      () => new (FilesystemTool as any)().restoreAppliedChangeSet({
        ...record,
        files: [{ ...record.files[0], path: "../outside.txt" }],
      }, context),
      /relative|outside|path/
    );
    await assert.rejects(
      () => new (FilesystemTool as any)().restoreAppliedChangeSet({
        ...record,
        files: [{ ...record.files[0], path }],
      }, context),
      /relative|outside|path/
    );
  });
});

test("restoring applied evidence rejects duplicate paths and ancestor symlink escapes", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const original: any = new FilesystemTool();
    const prepared = await original.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(original, prepared, context);
    const record = toEvidence(prepared.review, directory, context.sessionId);

    await assert.rejects(
      () => new (FilesystemTool as any)().restoreAppliedChangeSet({
        ...record,
        files: [...record.files, record.files[0]],
      }, context),
      /duplicate|persisted evidence|path/
    );

    const outside = await mkdtemp(join(tmpdir(), "dev-agent-restore-outside-"));
    try {
      const link = join(directory, "linked");
      await symlink(outside, link, "dir");
      const outsidePath = join(outside, "sample.txt");
      await writeFile(outsidePath, "outside\n", "utf8");
      await assert.rejects(
        () => new (FilesystemTool as any)().restoreAppliedChangeSet({
          ...record,
          files: [{ ...record.files[0], path: "linked/sample.txt" }],
        }, context),
        /symbolic link|symlink|outside|path/
      );
      assert.equal(await readFile(outsidePath, "utf8"), "outside\n");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("restored evidence rechecks the postimage and cannot be rolled back", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const original: any = new FilesystemTool();
    const prepared = await original.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(original, prepared, context);
    const record = toEvidence(prepared.review, directory, context.sessionId);

    const restored: any = new FilesystemTool();
    await restored.restoreAppliedChangeSet(record, context);
    await assert.rejects(
      () => restored.rollbackChangeSet(prepared.review.changeSetId),
      /before-image unavailable|before image unavailable|cross-process/i
    );
    await writeFile(path, "changed-by-user\n", "utf8");
    await assert.rejects(
      () => restored.withAppliedChangeSet(prepared.review.changeSetId, async () => undefined),
      /postimage|hash conflict/
    );
    assert.equal(await readFile(path, "utf8"), "changed-by-user\n");
  });
});

test("batch restore reports blocked records without restoring them", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const original: any = new FilesystemTool();
    const prepared = await original.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(original, prepared, context);
    const valid = toEvidence(prepared.review, directory, context.sessionId);
    const wrongSession = { ...valid, changeSetId: "cs-wrong-session", sessionId: "other-session" };

    const restored: any = new FilesystemTool();
    const results = await restored.restoreAppliedChangeSets([valid, wrongSession], context);

    assert.deepEqual(results.map((result) => result.status), ["restored", "blocked"]);
    assert.match(results[1].reason, /session/);
    await assert.rejects(
      () => restored.withAppliedChangeSet(wrongSession.changeSetId, async () => undefined),
      /unknown or expired/
    );
  });
});

test("restore regression matrix blocks unsafe evidence without touching the workspace", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "sample.txt");
    await writeFile(path, "before\n", "utf8");
    const original: any = new FilesystemTool();
    const prepared = await original.prepareChangeSet(
      { action: "write", path: "sample.txt", content: "after\n" },
      context
    );
    await applyPrepared(original, prepared, context);
    const valid = toEvidence(prepared.review, directory, context.sessionId);
    const otherDirectory = await mkdtemp(join(tmpdir(), "dev-agent-restore-matrix-other-"));

    try {
      const cases = [
        {
          label: "session mismatch",
          record: { ...valid, changeSetId: "cs-matrix-session", sessionId: "other-session" },
          reason: /session/,
        },
        {
          label: "working-directory mismatch",
          record: { ...valid, changeSetId: "cs-matrix-directory", workingDirectory: otherDirectory },
          reason: /working directory/,
        },
        {
          label: "postimage conflict",
          record: {
            ...valid,
            changeSetId: "cs-matrix-postimage",
            files: [{ ...valid.files[0], afterHash: "0".repeat(64) }],
          },
          reason: /postimage|hash/,
        },
        {
          label: "rolled-back evidence",
          record: { ...valid, changeSetId: "cs-matrix-rolled-back", state: "rolled-back" },
          reason: /rolled-back/,
        },
      ];

      for (const candidate of cases) {
        const restored: any = new FilesystemTool();
        const results = await restored.restoreAppliedChangeSets([candidate.record], context);
        assert.equal(results.length, 1, `${candidate.label} should return one result`);
        assert.equal(results[0]?.status, "blocked", candidate.label);
        assert.match(results[0]?.reason ?? "", candidate.reason, candidate.label);
        await assert.rejects(
          () => restored.withAppliedChangeSet(candidate.record.changeSetId, async () => undefined),
          /unknown or expired/
        );
        assert.equal(await readFile(path, "utf8"), "after\n", `${candidate.label} changed the file`);
      }
    } finally {
      await rm(otherDirectory, { recursive: true, force: true });
    }
  });
});

function toEvidence(review: any, directory: string, sessionId: string): any {
  return {
    changeSetId: review.changeSetId,
    sessionId,
    workingDirectory: directory,
    files: review.files.map((file: any) => ({
      ...file,
      path: file.path.slice(directory.length + 1),
      diff: undefined,
    })),
    additions: review.additions,
    deletions: review.deletions,
    createdAt: review.createdAt,
    recordedAt: "2026-09-13T00:00:01.000Z",
    state: "applied",
  };
}
