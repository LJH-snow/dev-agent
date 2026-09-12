import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FilesystemTool } from "../dist/index.js";

async function withFile(content, run) {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-edit-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, content, "utf8");
  try {
    return await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("edit replaces a unique snippet", async () => {
  await withFile("const answer = 1;\n", async (path) => {
    const tool: any = new FilesystemTool();
    const result = await tool.execute({
      action: "edit",
      path,
      oldText: "const answer = 1;",
      newText: "const answer = 42;",
    });

    assert.deepEqual(result, { ok: true, path, replacements: 1 });
    assert.equal(await readFile(path, "utf8"), "const answer = 42;\n");
  });
});

test("edit reports a missing snippet", async () => {
  await withFile("hello\n", async (path) => {
    const tool: any = new FilesystemTool();
    await assert.rejects(
      () => tool.execute({ action: "edit", path, oldText: "nope", newText: "x" }),
      /was not found/
    );
  });
});

test("edit refuses an ambiguous snippet and leaves the file alone", async () => {
  await withFile("dup\ndup\n", async (path) => {
    const tool: any = new FilesystemTool();
    await assert.rejects(
      () => tool.execute({ action: "edit", path, oldText: "dup", newText: "x" }),
      /matches 2 locations/
    );
    assert.equal(await readFile(path, "utf8"), "dup\ndup\n");
  });
});

test("edit deletes a snippet when newText is empty", async () => {
  await withFile("keep\nremove me\n", async (path) => {
    const tool: any = new FilesystemTool();
    await tool.execute({ action: "edit", path, oldText: "remove me\n", newText: "" });
    assert.equal(await readFile(path, "utf8"), "keep\n");
  });
});

test("edit requires oldText and newText", async () => {
  await withFile("hello\n", async (path) => {
    const tool: any = new FilesystemTool();
    await assert.rejects(
      () => tool.execute({ action: "edit", path, newText: "x" }),
      /non-empty oldText/
    );
    await assert.rejects(
      () => tool.execute({ action: "edit", path, oldText: "hello" }),
      /requires newText/
    );
  });
});

test("read returns a line range and marks truncation", async () => {
  const lines = Array.from({ length: 10 }, (_, index) => `line-${index + 1}`);
  await withFile(lines.join("\n"), async (path) => {
    const tool: any = new FilesystemTool();
    const slice = await tool.execute({ action: "read", path, offset: 3, limit: 2 });

    assert.equal(slice.content, "line-3\nline-4");
    assert.equal(slice.startLine, 3);
    assert.equal(slice.endLine, 4);
    assert.equal(slice.totalLines, 10);
    assert.equal(slice.truncated, true);
  });
});

test("read handles an offset past the end of the file", async () => {
  await withFile("only\n", async (path) => {
    const tool: any = new FilesystemTool();
    const slice = await tool.execute({ action: "read", path, offset: 5 });

    assert.equal(slice.content, "");
    assert.equal(slice.truncated, false);
  });
});

test("read counts a trailing newline as a terminator, not an empty line", async () => {
  await withFile("one\ntwo\nthree\n", async (path) => {
    const tool: any = new FilesystemTool();
    const all = await tool.execute({ action: "read", path });

    assert.equal(all.totalLines, 3, "a trailing newline must not add a line");
    assert.equal(all.content, "one\ntwo\nthree");
    assert.equal(all.endLine, 3);

    const last = await tool.execute({ action: "read", path, offset: 3 });
    assert.equal(last.content, "three");

    const past = await tool.execute({ action: "read", path, offset: 4 });
    assert.equal(past.content, "");
    assert.equal(past.truncated, false);
  });
});

test("read counts a file without a trailing newline the same way", async () => {
  await withFile("one\ntwo\nthree", async (path) => {
    const tool: any = new FilesystemTool();
    const all = await tool.execute({ action: "read", path });

    assert.equal(all.totalLines, 3);
    assert.equal(all.content, "one\ntwo\nthree");
  });
});

test("read treats a file holding only a newline as one line", async () => {
  await withFile("\n", async (path) => {
    const tool: any = new FilesystemTool();
    const all = await tool.execute({ action: "read", path });

    assert.equal(all.totalLines, 1);
    assert.equal(all.content, "");
    assert.equal(all.startLine, 1);
  });
});

test("read reports zero lines for an empty file", async () => {
  await withFile("", async (path) => {
    const tool: any = new FilesystemTool();
    const all = await tool.execute({ action: "read", path });

    assert.equal(all.totalLines, 0);
    assert.equal(all.content, "");
    assert.equal(all.truncated, false);
  });
});

test("read clamps a past-the-end range to the file instead of inverting it", async () => {
  await withFile("one\ntwo\nthree\n", async (path) => {
    const tool: any = new FilesystemTool();
    const slice = await tool.execute({ action: "read", path, offset: 99 });

    assert.equal(slice.totalLines, 3);
    assert.equal(slice.startLine, 4, "the range starts just past the last line");
    assert.equal(slice.endLine, 3);
    assert.ok(slice.endLine < slice.startLine, "an empty range, not a broken one");
    assert.equal(slice.content, "");
    assert.equal(slice.truncated, false);
  });
});
