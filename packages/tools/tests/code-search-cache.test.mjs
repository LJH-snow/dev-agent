import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodeSearchTool } from "../dist/index.js";

async function createProject(source = "export function alphaSymbol() { return 1; }\n") {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-code-search-cache-"));
  const file = join(dir, "sample.ts");
  await writeFile(file, source, "utf8");
  return { dir, file };
}

test("a repeated symbol search reuses the cached index", async () => {
  const { dir } = await createProject();
  const tool = new CodeSearchTool();
  try {
    const first = await tool.execute({ mode: "search", query: "alphaSymbol", path: dir });
    assert.equal(first.count, 1);

    const second = await tool.execute({ mode: "search", query: "alphaSymbol", path: dir });
    assert.equal(second.count, 1);

    assert.deepEqual(tool.getCacheStats(), {
      hits: 1,
      misses: 1,
      rescanned: 0,
      loadedFromDisk: 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a changed file is re-indexed without rebuilding the whole cache", async () => {
  const { dir, file } = await createProject();
  const tool = new CodeSearchTool();
  try {
    await tool.execute({ mode: "search", query: "alphaSymbol", path: dir });
    await writeFile(file, "export function betaSymbolName() { return 2; }\n", "utf8");

    const stale = await tool.execute({ mode: "search", query: "alphaSymbol", path: dir });
    assert.equal(stale.count, 0);

    const fresh = await tool.execute({ mode: "search", query: "betaSymbolName", path: dir });
    assert.equal(fresh.count, 1);

    const stats = tool.getCacheStats();
    assert.equal(stats.misses, 1, "the scan should have been built once");
    assert.equal(stats.rescanned, 1, "only the changed file should be re-read");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a deleted file is dropped from the cached index", async () => {
  const { dir, file } = await createProject();
  const tool = new CodeSearchTool();
  try {
    const before = await tool.execute({ mode: "search", query: "alphaSymbol", path: dir });
    assert.equal(before.count, 1);

    await unlink(file);

    const after = await tool.execute({ mode: "search", query: "alphaSymbol", path: dir });
    assert.equal(after.count, 0);
    assert.equal(tool.getCacheStats().rescanned, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reference lookups reuse the cached sources", async () => {
  const { dir, file } = await createProject(
    [
      "export function alphaSymbol() {",
      "  return 1;",
      "}",
      "console.log(alphaSymbol());",
      "",
    ].join("\n")
  );
  const tool = new CodeSearchTool();
  try {
    await tool.execute({ mode: "search", query: "alphaSymbol", path: dir });

    const result = await tool.execute({
      mode: "references",
      file,
      line: 1,
      column: 17,
      path: dir,
    });

    assert.equal(result.mode, "references");
    assert.ok(result.count >= 2, `expected at least 2 references, got ${result.count}`);

    const stats = tool.getCacheStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.rescanned, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
