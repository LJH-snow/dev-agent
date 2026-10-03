import assert from "node:assert/strict";
import test from "node:test";

import { TypeScriptReferenceIndex } from "../dist/reference-index.js";

async function buildIndex(files) {
  const map = new Map();
  for (const [name, content] of Object.entries(files)) {
    map.set(`/virtual/${name}`, content);
  }
  return new TypeScriptReferenceIndex({ files: map });
}

test("findDefinition resolves a local function declaration", async () => {
  const index = await buildIndex({
    "main.ts": [
      "function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
      "const result = add(1, 2);",
    ].join("\n"),
  });

  const definition = index.findDefinition("/virtual/main.ts", 4, 16);

  assert.ok(definition);
  assert.equal(definition.name, "add");
  assert.equal(definition.kind, "function");
  assert.equal(definition.line, 1);
});

test("findDefinition resolves a class method", async () => {
  const index = await buildIndex({
    "main.ts": [
      "class Calculator {",
      "  value = 0;",
      "  increment(): void {",
    "    this.value += 1;",
      "  }",
      "}",
      "const calc = new Calculator();",
      "calc.increment();",
    ].join("\n"),
  });

  const definition = index.findDefinition("/virtual/main.ts", 8, 10);

  assert.ok(definition);
  assert.equal(definition.name, "increment");
  assert.equal(definition.kind, "method");
  assert.equal(definition.line, 3);
});

test("findReferences locates usages of a symbol", async () => {
  const index = await buildIndex({
    "main.ts": [
      "function greet(name: string): string {",
      "  return `hi ${name}`;",
      "}",
      'console.log(greet("world"));',
      'console.log(greet("dev-agent"));',
    ].join("\n"),
  });

  const references = index.findReferences("/virtual/main.ts", 1, 10);

  assert.ok(references.length >= 2, `expected at least 2 references, got ${references.length}`);
  assert.equal(references[0].filePath, "/virtual/main.ts");
  assert.equal(references.every((ref) => typeof ref.line === "number"), true);
  assert.equal(references.some((ref) => ref.snippet.includes("greet")), true);
});

test("findDefinition returns undefined for unknown files", async () => {
  const index = await buildIndex({
    "main.ts": "export const a = 1;\n",
  });

  assert.equal(index.findDefinition("/virtual/missing.ts", 1, 1), undefined);
});

test("findReferences returns an empty array for unknown files", async () => {
  const index = await buildIndex({
    "main.ts": "export const a = 1;\n",
  });

  assert.deepEqual(index.findReferences("/virtual/missing.ts", 1, 1), []);
});
