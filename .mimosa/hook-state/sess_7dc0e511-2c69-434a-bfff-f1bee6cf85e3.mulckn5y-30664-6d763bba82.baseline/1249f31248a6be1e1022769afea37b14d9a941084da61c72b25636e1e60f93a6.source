import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearIndex,
  createIncrementalRefreshPlan,
  getIndexStatus,
  summarizeIncrementalRefresh,
  type FileInventoryEntry,
  type RefreshAction,
} from "../dist/index-status.js";
import { createProjectIgnoreMatcher } from "../dist/project-ignore.js";

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validIndex(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    files: {
      "src/keep.ts": "export function keep() {}",
      "src/change.ts": "export function old() {}",
      "src/delete.ts": "export function gone() {}",
      "src/old-name.ts": "export function renameMe() {}",
    },
    symbols: [
      { name: "keep", kind: "function", filePath: "src/keep.ts", line: 1 },
      { name: "old", kind: "function", filePath: "src/change.ts", line: 1 },
    ],
    ...overrides,
  };
}

test("getIndexStatus reports metadata for a valid v1 index", async () => {
  const raw = JSON.stringify(validIndex());
  const status = await getIndexStatus({
    indexPath: "project/.dev-agent/index.json",
    readFile: async () => raw,
  });

  assert.equal(status.status, "ready");
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.fileCount, 4);
  assert.equal(status.symbolCount, 2);
  assert.equal(status.usable, true);
});

test("getIndexStatus accepts a legacy v1 signature without ctimeMs", async () => {
  const status = await getIndexStatus({
    indexPath: "project/.dev-agent/index.json",
    readFile: async () => JSON.stringify(validIndex({
      signatures: { "src/keep.ts": { mtimeMs: 1, size: 2 } },
    })),
  });

  assert.equal(status.status, "ready");
  assert.equal(status.usable, true);
  assert.equal(status.hasSignatures, true);
});

test("getIndexStatus reports refresh cache metadata without exposing index contents", async () => {
  const status = await getIndexStatus({
    indexPath: "project/.dev-agent/index.json",
    readFile: async () => JSON.stringify(validIndex({
      refresh: { updatedAt: "2026-09-17T00:00:00.000Z", cacheHits: 3, cacheMisses: 1, errors: 2 },
    })),
  });

  assert.equal(status.cacheHits, 3);
  assert.equal(status.cacheMisses, 1);
  assert.equal(status.cacheHitRate, 0.75);
  assert.equal(status.errorCount, 2);
  assert.equal(status.updatedAt, "2026-09-17T00:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(status), /src\/keep\.ts|export function/);
});

test("getIndexStatus is metadata-only and does not expose path or source content", async () => {
  const absolutePath = "/Users/example/project/.dev-agent/index.json";
  const source = "export const secret = 'do-not-return';";
  const status = await getIndexStatus({
    indexPath: absolutePath,
    readFile: async () =>
      JSON.stringify({
        version: 1,
        files: { "src/secret.ts": source },
        symbols: [{ name: "secret", kind: "variable", filePath: "src/secret.ts", line: 1 }],
      }),
  });

  const serialized = JSON.stringify(status);
  assert.equal(status.status, "ready");
  assert.equal(serialized.includes(absolutePath), false);
  assert.equal(serialized.includes(source), false);
  assert.equal(serialized.includes("src/secret.ts"), false);
});

test("getIndexStatus reports missing, malformed, and incompatible indexes without throwing", async () => {
  const missing = await getIndexStatus({
    indexPath: "project/.dev-agent/index.json",
    readFile: async () => {
      const error = new Error("missing");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    },
  });
  assert.deepEqual(
    { status: missing.status, usable: missing.usable, errorCode: missing.errorCode },
    { status: "missing", usable: false, errorCode: "not_found" }
  );

  const malformed = await getIndexStatus({
    indexPath: "project/.dev-agent/index.json",
    readFile: async () => "{not-json",
  });
  assert.deepEqual(
    { status: malformed.status, usable: malformed.usable, errorCode: malformed.errorCode },
    { status: "invalid", usable: false, errorCode: "invalid_json" }
  );

  const incompatible = await getIndexStatus({
    indexPath: "project/.dev-agent/index.json",
    readFile: async () => JSON.stringify(validIndex({ version: 2 })),
  });
  assert.deepEqual(
    {
      status: incompatible.status,
      usable: incompatible.usable,
      schemaVersion: incompatible.schemaVersion,
      errorCode: incompatible.errorCode,
    },
    {
      status: "incompatible",
      usable: false,
      schemaVersion: 2,
      errorCode: "schema_incompatible",
    }
  );
});

test("clearIndex fails closed until explicitly confirmed and never returns the path", async () => {
  const removed: string[] = [];
  const indexPath = "/Users/example/project/.dev-agent/index.json";
  const blocked = await clearIndex({
    indexPath,
    removeFile: async (path) => { removed.push(path); },
  });

  assert.deepEqual(blocked, {
    status: "blocked",
    cleared: false,
    reason: "confirmation_required",
  });
  assert.deepEqual(removed, []);
  assert.equal(JSON.stringify(blocked).includes(indexPath), false);

  const preview = await clearIndex({
    indexPath,
    confirm: true,
    dryRun: true,
    removeFile: async (path) => { removed.push(path); },
  });
  assert.deepEqual(preview, { status: "dry_run", cleared: false });
  assert.deepEqual(removed, []);

  const cleared = await clearIndex({
    indexPath,
    confirm: true,
    removeFile: async (path) => { removed.push(path); },
  });
  assert.deepEqual(cleared, { status: "cleared", cleared: true });
  assert.deepEqual(removed, [indexPath]);
});

test("clearIndex rejects unsafe targets and handles a missing index idempotently", async () => {
  const unsafe = await clearIndex({ indexPath: "/" , confirm: true });
  assert.deepEqual(unsafe, { status: "blocked", cleared: false, reason: "unsafe_path" });

  const missing = await clearIndex({
    indexPath: "project/.dev-agent/index.json",
    confirm: true,
    removeFile: async () => {
      const error = new Error("missing");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    },
  });
  assert.deepEqual(missing, { status: "missing", cleared: false });
});

test("createIncrementalRefreshPlan classifies cache hits, misses, deletes, renames, and errors", () => {
  const inventory: readonly FileInventoryEntry[] = [
    { path: "src/keep.ts", fingerprint: fingerprint("export function keep() {}") },
    { path: "src/change.ts", fingerprint: fingerprint("export function changed() {}") },
    { path: "src/new.ts", fingerprint: fingerprint("export function fresh() {}") },
    { path: "src/new-name.ts", fingerprint: fingerprint("export function renameMe() {}") },
    { path: "src/broken.ts", errorCode: "EACCES" },
  ];

  const result = createIncrementalRefreshPlan({
    indexJson: JSON.stringify(validIndex()),
    inventory,
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.stats, {
    totalIndexed: 4,
    totalInventory: 5,
    cacheHits: 1,
    cacheMisses: 2,
    added: 1,
    updated: 1,
    deleted: 1,
    renamed: 1,
    errors: 1,
    actions: 6,
  });
  assert.deepEqual(
    result.actions.map((action) => action.kind),
    ["reuse", "update", "add", "rename", "error", "delete"]
  );
  assert.equal(result.actions.some((action) => "content" in action), false);
  assert.equal(JSON.stringify(result).includes("export function"), false);
  assert.equal(JSON.stringify(result).includes("/Users/"), false);
});

test("legacy signatures cannot be cache hits without a content fingerprint", () => {
  const legacyIndex = {
    version: 1,
    files: { "src/keep.ts": "export function keep() {}" },
    symbols: [{ name: "keep", kind: "function", filePath: "src/keep.ts", line: 1 }],
    signatures: { "src/keep.ts": { mtimeMs: 1, size: 2 } },
  };
  const result = createIncrementalRefreshPlan({
    indexJson: JSON.stringify(legacyIndex),
    inventory: [{
      path: "src/keep.ts",
      signature: { mtimeMs: 1, size: 2, ctimeMs: 3 },
    }],
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.actions, [{ kind: "update", path: "src/keep.ts" }]);
  assert.equal(result.stats.cacheHits, 0);
  assert.equal(result.stats.cacheMisses, 1);
});

test("summarizeIncrementalRefresh is a pure stable statistic function", () => {
  const actions: readonly RefreshAction[] = [
    { kind: "reuse", path: "src/a.ts" },
    { kind: "add", path: "src/b.ts" },
    { kind: "update", path: "src/c.ts" },
    { kind: "delete", path: "src/d.ts" },
    { kind: "rename", from: "src/e.ts", to: "src/f.ts" },
    { kind: "error", path: "src/g.ts", errorCode: "EACCES" },
  ];

  assert.deepEqual(summarizeIncrementalRefresh(actions), {
    totalIndexed: 0,
    totalInventory: 0,
    cacheHits: 1,
    cacheMisses: 2,
    added: 1,
    updated: 1,
    deleted: 1,
    renamed: 1,
    errors: 1,
    actions: 6,
  });
});

test("incremental refresh fails closed for an incompatible schema", () => {
  const result = createIncrementalRefreshPlan({
    indexJson: JSON.stringify(validIndex({ version: 99 })),
    inventory: [{ path: "src/new.ts", fingerprint: fingerprint("new") }],
  });

  assert.equal(result.status, "incompatible");
  assert.equal(result.usable, false);
  assert.equal(result.errorCode, "schema_incompatible");
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.stats, {
    totalIndexed: 0,
    totalInventory: 0,
    cacheHits: 0,
    cacheMisses: 0,
    added: 0,
    updated: 0,
    deleted: 0,
    renamed: 0,
    errors: 0,
    actions: 0,
  });
});

test("status can read the real persisted v1 index without returning its contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-index-status-"));
  const indexPath = join(directory, ".dev-agent", "index.json");
  try {
    const raw = JSON.stringify(validIndex({ signatures: { "src/keep.ts": { mtimeMs: 1, size: 2, ctimeMs: 1 } } }));
    await writeFile(indexPath, raw).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(directory, ".dev-agent"), { recursive: true });
      await writeFile(indexPath, raw);
    });
    const status = await getIndexStatus({ indexPath, readFile: (path) => readFile(path, "utf8") });
    assert.equal(status.status, "ready");
    assert.equal(status.hasSignatures, true);
    assert.equal(JSON.stringify(status).includes(raw), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("project ignore rules combine defaults, gitignore, ignore, and explicit excludes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-ignore-"));
  try {
    await writeFile(join(directory, ".gitignore"), "generated/\n*.generated.ts\n!generated/keep.ts\n", "utf8");
    await writeFile(join(directory, ".ignore"), "private/\n", "utf8");
    const matcher = await createProjectIgnoreMatcher(directory, [join(directory, "explicit")]);
    assert.equal(matcher.isIgnored("node_modules/pkg/index.ts"), true);
    assert.equal(matcher.isIgnored("generated/file.ts", true), true);
    assert.equal(matcher.isIgnored("generated/keep.ts"), false);
    assert.equal(matcher.isIgnored("src/model.generated.ts"), true);
    assert.equal(matcher.isIgnored("private/data.ts"), true);
    assert.equal(matcher.isIgnored("explicit/data.ts"), true);
    assert.equal(matcher.isIgnored("src/keep.ts"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
