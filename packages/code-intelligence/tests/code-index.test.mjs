import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryCodeIndex } from "../dist/index.js";

test("in-memory code index stores and finds symbols", () => {
  const index = new InMemoryCodeIndex();
  index.addSymbol({
    name: "runAgent",
    kind: "function",
    filePath: "src/index.ts",
    line: 10,
  });
  index.addSymbol({
    name: "AgentState",
    kind: "interface",
    filePath: "src/agent-state.ts",
    line: 5,
  });

  const found = index.search("agent");
  assert.equal(found.length, 2);
  assert.ok(found.some((symbol) => symbol.name === "runAgent"));
  assert.ok(found.some((symbol) => symbol.name === "AgentState"));

  const byPath = index.search("agent-state");
  assert.equal(byPath.length, 1);
  assert.equal(byPath[0].name, "AgentState");
});

test("in-memory code index ranks exact and token matches", () => {
  const index = new InMemoryCodeIndex();
  index.addSource(
    [
      "export function findAgent() {}",
      "export function otherAgentWork() {}",
      "const runAgent = () => {}",
      "export class AgentContext {}",
    ].join("\n"),
    "src/example.ts"
  );

  const exact = index.searchSymbols({ query: "findAgent", limit: 10 });
  assert.equal(exact.length, 1);
  assert.equal(exact[0].symbol.name, "findAgent");
  assert.ok(exact[0].score >= 100);
  assert.ok(exact[0].reasons.includes("name:exact"));

  const tokens = index.searchSymbols({ query: "agent", limit: 10 });
  assert.ok(tokens.length >= 2);
  assert.equal(tokens[0].symbol.name, "AgentContext");
  assert.ok(tokens[0].score >= 75);
  assert.ok(tokens[0].reasons.includes("name:token"));
});

test("in-memory code index filters by symbol kind", () => {
  const index = new InMemoryCodeIndex();
  index.addSource(
    [
      "export function runAgent() {}",
      "export class AgentContext {}",
      "type AgentStatus = 'idle' | 'done';",
    ].join("\n"),
    "src/example.ts"
  );

  const functions = index.searchSymbols({ query: "agent", kinds: ["function"] });
  assert.equal(functions.length, 1);
  assert.equal(functions[0].symbol.name, "runAgent");

  const types = index.searchSymbols({ query: "agent", kinds: ["type"] });
  assert.equal(types[0].symbol.name, "AgentStatus");
});

test("case-sensitive exact match scores higher than case-insensitive", async () => {
  const { InMemoryCodeIndex } = await import("../dist/index.js");
  const index = new InMemoryCodeIndex();
  index.addSource("function MyHelper() {}\nfunction myhelper() {}", "sample.ts");
  const matches = index.searchSymbols({ query: "MyHelper", limit: 10 });
  assert.ok(matches.length >= 2);
  const exact = matches.find((m) => m.symbol.name === "MyHelper");
  const fuzzy = matches.find((m) => m.symbol.name === "myhelper");
  assert.ok(exact, "expected MyHelper in results");
  assert.ok(fuzzy, "expected myhelper in results");
  assert.ok(exact.score > fuzzy.score, "case-sensitive match should score higher");
});

test("test files are demoted in ranking", async () => {
  const { InMemoryCodeIndex } = await import("../dist/index.js");
  const index = new InMemoryCodeIndex();
  index.addSource("function helper() {}", "src/helper.ts");
  index.addSource("function helper() {}", "tests/helper.test.ts");
  const matches = index.searchSymbols({ query: "helper", limit: 10 });
  assert.equal(matches.length, 2);
  assert.match(matches[0].symbol.filePath, /src\/helper/);
  assert.match(matches[1].symbol.filePath, /tests\/helper/);
  assert.ok(matches[0].score > matches[1].score);
});

test("deeply nested paths receive a depth penalty", async () => {
  const { InMemoryCodeIndex } = await import("../dist/index.js");
  const index = new InMemoryCodeIndex();
  index.addSource("function util() {}", "src/util.ts");
  index.addSource("function util() {}", "a/b/c/d/e/f/deep.ts");
  const matches = index.searchSymbols({ query: "util", limit: 10 });
  assert.equal(matches.length, 2);
  assert.match(matches[0].symbol.filePath, /src\/util/);
  assert.ok(matches[0].score > matches[1].score);
});
