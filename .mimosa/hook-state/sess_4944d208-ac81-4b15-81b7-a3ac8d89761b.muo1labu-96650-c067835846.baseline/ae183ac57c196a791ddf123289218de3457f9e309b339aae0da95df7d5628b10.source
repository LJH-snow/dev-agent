import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FilesystemTool } from "../dist/index.js";

const ORIGINAL = ["const a = 1;", "const b = 2;", "const c = 3;", ""].join("\n");

async function withFile(content, run) {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-patch-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, content, "utf8");
  try {
    return await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("patch applies several hunks in one write", async () => {
  await withFile(ORIGINAL, async (path) => {
    const tool: any = new FilesystemTool();
    const result = await tool.execute({
      action: "patch",
      path,
      hunks: [
        { oldText: "const a = 1;", newText: "const a = 10;" },
        { oldText: "const c = 3;", newText: "const c = 30;" },
      ],
    });

    assert.deepEqual(result, { ok: true, path, hunks: 2 });
    assert.equal(
      await readFile(path, "utf8"),
      ["const a = 10;", "const b = 2;", "const c = 30;", ""].join("\n")
    );
  });
});

test("patch leaves the file untouched when a later hunk fails", async () => {
  await withFile(ORIGINAL, async (path) => {
    const tool: any = new FilesystemTool();
    await assert.rejects(
      () =>
        tool.execute({
          action: "patch",
          path,
          hunks: [
            { oldText: "const a = 1;", newText: "const a = 10;" },
            { oldText: "const missing = 0;", newText: "x" },
          ],
        }),
      /hunk 2 search text was not found/
    );

    assert.equal(await readFile(path, "utf8"), ORIGINAL, "the first hunk must not be written");
  });
});

test("patch rejects overlapping hunks", async () => {
  await withFile("abcdef\n", async (path) => {
    const tool: any = new FilesystemTool();
    await assert.rejects(
      () =>
        tool.execute({
          action: "patch",
          path,
          hunks: [
            { oldText: "abc", newText: "abc" },
            { oldText: "bc", newText: "BC" },
          ],
        }),
      /hunk 2 overlaps hunk 1/
    );
    assert.equal(await readFile(path, "utf8"), "abcdef\n");
  });
});

test("patch requires at least one well-formed hunk", async () => {
  await withFile(ORIGINAL, async (path) => {
    const tool: any = new FilesystemTool();
    await assert.rejects(
      () => tool.execute({ action: "patch", path, hunks: [] }),
      /non-empty hunks array/
    );
    await assert.rejects(
      () =>
        tool.execute({
          action: "patch",
          path,
          hunks: [{ oldText: "", newText: "x" }],
        }),
      /hunk 1 requires a non-empty oldText/
    );
  });
});

test("a single hunk behaves like edit", async () => {
  await withFile(ORIGINAL, async (path) => {
    const tool: any = new FilesystemTool();
    const result = await tool.execute({
      action: "patch",
      path,
      hunks: [{ oldText: "const b = 2;", newText: "const b = 20;" }],
    });

    assert.deepEqual(result, { ok: true, path, hunks: 1 });
    assert.match(await readFile(path, "utf8"), /const b = 20;/);
  });
});
