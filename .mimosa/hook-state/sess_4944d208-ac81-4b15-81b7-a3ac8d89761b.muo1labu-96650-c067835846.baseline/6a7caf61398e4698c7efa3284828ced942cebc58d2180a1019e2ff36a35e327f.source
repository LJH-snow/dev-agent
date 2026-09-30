import assert from "node:assert/strict";
import test from "node:test";

import { scanTypeScriptSymbols, typeScriptScanner } from "../dist/index.js";

test("TypeScript scanner finds functions, classes, interfaces, types, and variables", () => {
  const source = [
    "// leading comment",
    "export async function runAgent() {}",
    "export class AgentContext {}",
    "interface AgentState {}",
    "export type AgentStatus = 'idle' | 'done';",
    "const defaultValue = 'cli';",
  ].join("\n");

  const symbols = scanTypeScriptSymbols(source, "src/example.ts");

  assert.deepEqual(
    symbols.map((symbol) => `${symbol.kind}:${symbol.name}@${symbol.line}`),
    [
      "function:runAgent@2",
      "class:AgentContext@3",
      "interface:AgentState@4",
      "type:AgentStatus@5",
      "variable:defaultValue@6",
    ]
  );
});

test("typeScriptScanner uses the same symbol parser", () => {
  const symbols = typeScriptScanner.scan("export function findMe() {}", "src/a.ts");
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].name, "findMe");
});

test("TypeScript scanner captures methods, enums, multiline declarations, and arrow functions", () => {
  const source = [
    "export enum AgentRunStatus {",
    "  Idle = 'idle',",
    "  Done = 'done',",
    "}",
    "export class AgentContext {",
    "  async runAgent(",
    "    input: string",
    "  ): Promise<string> {",
    "    return input;",
    "  }",
    "  readonly version = 1;",
    "}",
    "export interface AgentState {",
    "  status: AgentRunStatus;",
    "  resume(): Promise<void>;",
    "}",
    "const execute = async () => {",
    "  return 'ok';",
    "};",
  ].join("\n");

  const symbols = scanTypeScriptSymbols(source, "src/agent.ts");
  const indexed = new Map(
    symbols.map((symbol) => [
      `${symbol.kind}:${symbol.containerName ?? ""}:${symbol.name}`,
      symbol,
    ])
  );

  assert.ok(indexed.has("enum::AgentRunStatus"));
  assert.ok(indexed.has("class::AgentContext"));
  assert.ok(indexed.has("method:AgentContext:runAgent"));
  assert.ok(indexed.has("property:AgentContext:version"));
  assert.ok(indexed.has("interface::AgentState"));
  assert.ok(indexed.has("property:AgentState:status"));
  assert.ok(indexed.has("method:AgentState:resume"));
  assert.ok(indexed.has("function::execute"));

  const runAgent = symbols.find((symbol) => symbol.name === "runAgent");
  assert.equal(runAgent.line, 6);
  assert.equal(runAgent.column, 3);
  assert.match(runAgent.signature, /runAgent/);
});
