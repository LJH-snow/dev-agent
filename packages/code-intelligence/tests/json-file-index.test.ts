import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JsonFileCodeIndex } from "../dist/index.js";

test("JsonFileCodeIndex adds sources and searches by name", async () => {
  const index = new JsonFileCodeIndex({ filePath: join(tmpdir(), "test-index.json") });
  await index.addSource("export function greet() {}\nexport class Greeter {}", "src/greeter.ts");
  await index.addSource("export function helper() {}", "src/helper.ts");

  assert.equal(index.getFileCount(), 2);
  assert.equal(index.getSymbolCount(), 3);

  const results = index.searchByName("greet");
  assert.equal(results.length, 2);
  assert.ok(results.some((s) => s.name === "greet"));
  assert.ok(results.some((s) => s.name === "Greeter"));
});

test("JsonFileCodeIndex persists to and loads from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  const filePath = join(dir, "index.json");

  try {
    const index = new JsonFileCodeIndex({ filePath });
    await index.addSource("export function alpha() {}", "src/alpha.ts");
    await index.addSource("export function beta() {}", "src/beta.ts");
    await index.save();

    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1);
    assert.equal(Object.keys(parsed.files).length, 2);
    assert.equal(parsed.symbols.length, 2);

    const reloaded = new JsonFileCodeIndex({ filePath });
    await reloaded.load();
    assert.equal(reloaded.getFileCount(), 2);
    assert.equal(reloaded.getSymbolCount(), 2);
    assert.equal(reloaded.searchByName("alpha").length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("JsonFileCodeIndex removeFile drops symbols", async () => {
  const index = new JsonFileCodeIndex({ filePath: join(tmpdir(), "test-index-2.json") });
  await index.addSource("export function keep() {}\nexport function drop() {}", "keep.ts");
  await index.addSource("export function drop() {}", "drop.ts");

  assert.equal(index.getSymbolCount(), 3);
  await index.removeFile("drop.ts");
  assert.equal(index.getSymbolCount(), 2);
  assert.equal(index.getFileCount(), 1);
});

test("JsonFileCodeIndex load handles missing file gracefully", async () => {
  const index = new JsonFileCodeIndex({ filePath: join(tmpdir(), "nonexistent-index.json") });
  await index.load();
  assert.equal(index.getSymbolCount(), 0);
  assert.equal(index.getFileCount(), 0);
});
