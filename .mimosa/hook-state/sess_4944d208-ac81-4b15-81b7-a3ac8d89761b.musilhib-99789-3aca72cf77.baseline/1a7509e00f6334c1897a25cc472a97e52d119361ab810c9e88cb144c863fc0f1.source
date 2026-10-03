import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { FilesystemTool } from "../dist/index.js";

async function withWorkspace(run) {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-preview-"));
  try {
    return await run(directory, { sessionId: "preview-test", workingDirectory: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("preview returns real diffs and hashes without changing files or modes", async () => {
  await withWorkspace(async (directory, context) => {
    const editedPath = join(directory, "edited.txt");
    const patchedPath = join(directory, "patched.txt");
    await writeFile(editedPath, "before\n", "utf8");
    await writeFile(patchedPath, "first\nsecond\n", "utf8");
    await chmod(editedPath, 0o640);
    const modeBefore = (await stat(editedPath)).mode & 0o7777;

    const tool: any = new FilesystemTool();
    const review = await tool.execute(
      {
        action: "preview",
        changes: [
          { action: "write", path: "new.txt", content: "hello\nworld\n" },
          { action: "edit", path: "edited.txt", oldText: "before", newText: "after" },
          {
            action: "patch",
            path: "patched.txt",
            hunks: [{ oldText: "first", newText: "updated" }],
          },
          { action: "mkdir", path: "created/nested" },
        ],
      },
      context
    );

    assert.match(review.changeSetId, /^[0-9a-f-]{36}$/);
    assert.equal(review.files.length, 4);
    assert.equal(review.additions, 4);
    assert.equal(review.deletions, 2);

    const byPath = new Map((review.files as any[]).map((file) => [file.path, file]));
    const newFile = byPath.get(resolve(directory, "new.txt"));
    assert.equal(newFile.beforeExists, false);
    assert.equal(newFile.beforeHash, undefined);
    assert.equal(newFile.afterExists, true);
    assert.match(newFile.diff, /\+hello/);
    assert.match(newFile.diff, /\+world/);

    const edited = byPath.get(editedPath);
    assert.equal(edited.beforeExists, true);
    assert.equal(edited.afterExists, true);
    assert.equal(edited.additions, 1);
    assert.equal(edited.deletions, 1);
    assert.match(edited.diff, /-before/);
    assert.match(edited.diff, /\+after/);

    const created = byPath.get(resolve(directory, "created/nested"));
    assert.equal(created.kind, "directory");
    assert.equal(created.beforeExists, false);
    assert.equal(created.afterExists, true);

    assert.equal(await lstat(join(directory, "new.txt")).then(() => true, () => false), false);
    assert.equal(await readFile(editedPath, "utf8"), "before\n");
    assert.equal(await readFile(patchedPath, "utf8"), "first\nsecond\n");
    assert.equal(await lstat(join(directory, "created")).then(() => true, () => false), false);
    assert.equal((await stat(editedPath)).mode & 0o7777, modeBefore);
  });
});

test("prepareChangeSet wraps a single mutation and returns an apply input", async () => {
  await withWorkspace(async (directory, context) => {
    await writeFile(join(directory, "sample.txt"), "old\n", "utf8");
    const tool: any = new FilesystemTool();

    const prepared = await tool.prepareChangeSet(
      { action: "edit", path: "sample.txt", oldText: "old", newText: "new" },
      context
    );

    assert.equal(prepared.executeInput.action, "apply");
    assert.equal(prepared.executeInput.changeSetId, prepared.review.changeSetId);
    assert.equal(prepared.review.files.length, 1);
    assert.equal(await readFile(join(directory, "sample.txt"), "utf8"), "old\n");
  });
});

test("preview rejects invalid or unsafe changes without touching the workspace", async () => {
  await withWorkspace(async (directory, context) => {
    const duplicatePath = join(directory, "duplicate.txt");
    const occupiedPath = join(directory, "occupied");
    await writeFile(duplicatePath, "dup\ndup\n", "utf8");
    await writeFile(occupiedPath, "file\n", "utf8");
    const tool: any = new FilesystemTool();

    await assert.rejects(
      () =>
        tool.execute(
          {
            action: "preview",
            changes: [{ action: "edit", path: "duplicate.txt", oldText: "dup", newText: "x" }],
          },
          context
        ),
      /matches 2 locations/
    );
    await assert.rejects(
      () => tool.execute({ action: "preview", changes: [{ action: "mkdir", path: "occupied" }] }, context),
      /directory/
    );
    await assert.rejects(
      () => tool.execute({ action: "apply", changeSetId: "unknown-change-set" }, context),
      /unknown-change-set/
    );

    assert.equal(await readFile(duplicatePath, "utf8"), "dup\ndup\n");
    assert.equal(await readFile(occupiedPath, "utf8"), "file\n");
  });
});

test("preview rejects a postimage above the 16 MiB write limit", async () => {
  await withWorkspace(async (directory, context) => {
    const path = join(directory, "too-large.txt");
    const tool: any = new FilesystemTool();

    await assert.rejects(
      () =>
        tool.execute(
          {
            action: "preview",
            changes: [
              {
                action: "write",
                path: "too-large.txt",
                content: "x".repeat(16 * 1024 * 1024 + 1),
              },
            ],
          },
          context
        ),
      /filesystem file exceeds the 16 MiB write limit/
    );
    assert.equal(await lstat(path).then(() => true, () => false), false);
  });
});
