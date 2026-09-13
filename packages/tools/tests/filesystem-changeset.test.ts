import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FilesystemTool } from "../dist/index.js";

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
