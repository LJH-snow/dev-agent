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
  const tool: any = new CodeSearchTool();
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
      persisted: 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a changed file is re-indexed without rebuilding the whole cache", async () => {
  const { dir, file } = await createProject();
  const tool: any = new CodeSearchTool();
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
  const tool: any = new CodeSearchTool();
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

test("a file-count scan limit rejects before caching a partial symbol index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-code-search-file-limit-"));
  try {
    await writeFile(join(dir, "first.rs"), "fn first() {}\n", "utf8");
    await writeFile(join(dir, "second.rs"), "fn second() {}\n", "utf8");
    await writeFile(join(dir, "third.rs"), "fn third() {}\n", "utf8");
    const tool: any = new (CodeSearchTool as any)({
      maxFiles: 2,
      maxSourceBytes: 1_000,
    });

    await assert.rejects(
      tool.execute({ mode: "search", query: "first", path: dir }),
      (error) => {
        const candidate = error as any;
        assert.equal(candidate.code, "CODE_SEARCH_SCAN_LIMIT_EXCEEDED");
        assert.equal(candidate.dimension, "files");
        assert.equal(candidate.limit, 2);
        assert.equal(candidate.observed, 3);
        assert.equal(candidate.message, "code-search scan files limit exceeded");
        assert.ok(!candidate.message.includes(dir));
        return true;
      }
    );
    assert.deepEqual(tool.getCacheStats(), {
      hits: 0,
      misses: 0,
      rescanned: 0,
      loadedFromDisk: 0,
      persisted: 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a source-byte scan limit rejects before returning partial symbols", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-code-search-byte-limit-"));
  try {
    await writeFile(join(dir, "first.rs"), "fn a(){}", "utf8");
    await writeFile(join(dir, "second.rs"), "fn b(){}", "utf8");
    const tool: any = new (CodeSearchTool as any)({
      maxFiles: 2,
      maxSourceBytes: 10,
    });

    await assert.rejects(
      tool.execute({ mode: "search", query: "a", path: dir }),
      (error) => {
        const candidate = error as any;
        assert.equal(candidate.code, "CODE_SEARCH_SCAN_LIMIT_EXCEEDED");
        assert.equal(candidate.dimension, "bytes");
        assert.equal(candidate.limit, 10);
        assert.equal(candidate.observed, 16);
        assert.equal(candidate.message, "code-search scan bytes limit exceeded");
        assert.ok(!candidate.message.includes(dir));
        return true;
      }
    );
    assert.deepEqual(tool.getCacheStats(), {
      hits: 0,
      misses: 0,
      rescanned: 0,
      loadedFromDisk: 0,
      persisted: 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a file above the 16 MiB scan limit is skipped without indexing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-code-search-oversize-"));
  try {
    await writeFile(
      join(dir, "small.ts"),
      "export function smallSymbol() { return 1; }\n",
      "utf8"
    );
    await writeFile(
      join(dir, "huge.ts"),
      "export function hugeSymbol() { return 2; }\n" + "x".repeat(16 * 1024 * 1024),
      "utf8"
    );
    const tool: any = new CodeSearchTool();

    const found = await tool.execute({ mode: "search", query: "hugeSymbol", path: dir });
    assert.equal(found.count, 0, "symbols from an oversized file must not be indexed");

    const small = await tool.execute({ mode: "search", query: "smallSymbol", path: dir });
    assert.equal(small.count, 1, "small files remain indexed");
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
  const tool: any = new CodeSearchTool();
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
