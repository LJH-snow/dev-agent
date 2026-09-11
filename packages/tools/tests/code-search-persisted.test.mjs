import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodeSearchTool } from "../dist/index.js";

const SOURCE = "export function realSymbol() { return 1; }\n";

/** Writes a project plus a persisted index that claims a symbol the source lacks. */
async function createProject({ signatureOverride } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-persisted-"));
  const file = join(dir, "sample.ts");
  await writeFile(file, SOURCE, "utf8");
  const info = await stat(file);

  await mkdir(join(dir, ".dev-agent"), { recursive: true });
  await writeFile(
    join(dir, ".dev-agent", "index.json"),
    JSON.stringify({
      version: 1,
      files: { [file]: SOURCE },
      symbols: [{ name: "ghostSymbol", kind: "function", filePath: file, line: 1 }],
      signatures: {
        [file]: signatureOverride ?? { mtimeMs: info.mtimeMs, size: info.size },
      },
    }),
    "utf8"
  );

  return { dir, file };
}

test("a persisted index is loaded on the first search", async () => {
  const { dir } = await createProject();
  const tool = new CodeSearchTool();
  try {
    const result = await tool.execute({ mode: "search", query: "ghostSymbol", path: dir });

    assert.equal(result.count, 1, "the symbol from the index should be found");
    assert.equal(tool.getCacheStats().loadedFromDisk, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("files whose signature changed are re-read after loading the index", async () => {
  const { dir, file } = await createProject({ signatureOverride: { mtimeMs: 1, size: 1 } });
  const tool = new CodeSearchTool();
  try {
    const stale = await tool.execute({ mode: "search", query: "ghostSymbol", path: dir });
    assert.equal(stale.count, 0, "the stale symbol should be dropped");

    const fresh = await tool.execute({ mode: "search", query: "realSymbol", path: dir });
    assert.equal(fresh.count, 1, "the re-read file should be indexed");
    assert.equal(tool.getCacheStats().rescanned, 1);
    assert.equal(file.endsWith("sample.ts"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("files missing from disk are dropped from a loaded index", async () => {
  const { dir, file } = await createProject();
  const tool = new CodeSearchTool();
  try {
    // Point the index at a file that does not exist.
    await writeFile(
      join(dir, ".dev-agent", "index.json"),
      JSON.stringify({
        version: 1,
        files: { [join(dir, "gone.ts")]: "export function goneSymbol() {}" },
        symbols: [
          { name: "goneSymbol", kind: "function", filePath: join(dir, "gone.ts"), line: 1 },
        ],
        signatures: { [file]: { mtimeMs: 1, size: 1 } },
      }),
      "utf8"
    );

    const result = await tool.execute({ mode: "search", query: "goneSymbol", path: dir });

    assert.equal(result.count, 0);
    assert.equal(tool.getCacheStats().loadedFromDisk, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a corrupted index falls back to a full scan", async () => {
  const { dir } = await createProject();
  const tool = new CodeSearchTool();
  try {
    await writeFile(join(dir, ".dev-agent", "index.json"), "{ not json", "utf8");

    const result = await tool.execute({ mode: "search", query: "realSymbol", path: dir });

    assert.equal(result.count, 1);
    const stats = tool.getCacheStats();
    assert.equal(stats.loadedFromDisk, 0);
    assert.equal(stats.misses, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a corrupted index is rewritten from the full scan", async () => {
  const { dir } = await createProject();
  const tool = new CodeSearchTool();
  const indexPath = join(dir, ".dev-agent", "index.json");
  try {
    await writeFile(indexPath, "{ not json", "utf8");

    const result = await tool.execute({ mode: "search", query: "realSymbol", path: dir });

    assert.equal(result.count, 1);
    const stats = tool.getCacheStats();
    assert.equal(stats.loadedFromDisk, 0);
    assert.equal(stats.persisted, 1);

    const index = JSON.parse(await readFile(indexPath, "utf8"));
    assert.equal(index.version, 1);
    const names = index.symbols.map((symbol) => symbol.name);
    assert.ok(names.includes("realSymbol"), "the scan should be persisted");
    assert.ok(!names.includes("ghostSymbol"), "the stale symbol should be gone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a changed scan is written back to the persisted index", async () => {
  const { dir, file } = await createProject({ signatureOverride: { mtimeMs: 1, size: 1 } });
  const tool = new CodeSearchTool();
  try {
    const result = await tool.execute({ mode: "search", query: "realSymbol", path: dir });

    assert.equal(result.count, 1);
    assert.equal(tool.getCacheStats().persisted, 1);

    const index = JSON.parse(
      await readFile(join(dir, ".dev-agent", "index.json"), "utf8")
    );
    const names = index.symbols.map((symbol) => symbol.name);
    assert.ok(names.includes("realSymbol"), "the refreshed symbol should be persisted");
    assert.ok(!names.includes("ghostSymbol"), "the stale symbol should be gone");
    const info = await stat(file);
    assert.equal(index.signatures[file].size, info.size);
    assert.equal(index.files[file], SOURCE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unchanged persisted index is not rewritten", async () => {
  const { dir } = await createProject();
  const tool = new CodeSearchTool();
  const indexPath = join(dir, ".dev-agent", "index.json");
  try {
    const before = await stat(indexPath);
    const result = await tool.execute({ mode: "search", query: "ghostSymbol", path: dir });
    const after = await stat(indexPath);

    assert.equal(result.count, 1);
    assert.equal(tool.getCacheStats().persisted, 0);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.size, before.size);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a scan that did not start from an index does not create one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-persisted-"));
  const file = join(dir, "sample.ts");
  const tool = new CodeSearchTool();
  try {
    await writeFile(file, SOURCE, "utf8");
    await tool.execute({ mode: "search", query: "realSymbol", path: dir });

    await writeFile(file, "export function otherSymbol() {}\n", "utf8");
    const result = await tool.execute({ mode: "search", query: "otherSymbol", path: dir });

    assert.equal(result.count, 1);
    assert.equal(tool.getCacheStats().persisted, 0);
    await assert.rejects(stat(join(dir, ".dev-agent", "index.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed write-back does not break the search", async (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("directory permissions are not enforced for root");
    return;
  }

  const { dir } = await createProject({ signatureOverride: { mtimeMs: 1, size: 1 } });
  const tool = new CodeSearchTool();
  const indexPath = join(dir, ".dev-agent", "index.json");
  await chmod(indexPath, 0o444);
  try {
    const result = await tool.execute({ mode: "search", query: "realSymbol", path: dir });

    assert.equal(result.count, 1);
    assert.equal(tool.getCacheStats().persisted, 0);
  } finally {
    await chmod(indexPath, 0o644).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
