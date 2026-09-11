import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalExecutor } from "@dev-agent/executor";

import {
  CodeSearchTool,
  createDefaultTools,
  FilesystemTool,
  GitTool,
  SearchTool,
  ShellTool,
  ToolRegistry,
} from "../dist/index.js";

test("filesystem tool reads and lists a directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-fs-"));
  await writeFile(join(dir, "a.txt"), "hello");
  const tool: any = new FilesystemTool();

  const read = await tool.execute({ action: "read", path: join(dir, "a.txt") });
  assert.equal(read.content, "hello");

  const list = await tool.execute({ action: "list", path: dir });
  assert.ok(list.entries.some((entry) => entry.name === "a.txt"));

  await rm(dir, { recursive: true, force: true });
});

test("shell tool runs a command through LocalExecutor", async () => {
  const tool: any = new ShellTool(new LocalExecutor());
  const result = await tool.execute({
    command: "node",
    args: ["-e", "console.log('ok')"],
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /ok/);
});

test("filesystem tool resolves relative paths against tool context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-fs-ctx-"));
  await mkdir(join(dir, "nested"));
  await writeFile(join(dir, "nested", "a.txt"), "hello");

  const tool: any = new FilesystemTool();
  const context = { sessionId: "ctx-test", workingDirectory: dir };

  const list = await tool.execute({ action: "list", path: "nested" }, context);
  assert.ok(list.entries.some((entry) => entry.name === "a.txt"));

  const read = await tool.execute({ action: "read", path: "nested/a.txt" }, context);
  assert.equal(read.content, "hello");

  await rm(dir, { recursive: true, force: true });
});

test("shell tool honors working directory from tool context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-shell-ctx-"));

  const tool: any = new ShellTool(new LocalExecutor());
  const result = await tool.execute(
    { command: "node", args: ["-e", "console.log(process.cwd())"] },
    { sessionId: "ctx-test", workingDirectory: dir }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), await realpath(dir));
  await rm(dir, { recursive: true, force: true });
});

test("git tool reports git version", async () => {
  const tool: any = new GitTool(new LocalExecutor());
  const result = await tool.execute({ args: ["--version"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /git version/);
});

test("search tool finds text with ripgrep", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-search-"));
  await writeFile(join(dir, "sample.txt"), "needle line\n");

  const tool: any = new SearchTool(new LocalExecutor());
  const result = await tool.execute({ query: "needle", path: dir });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /needle/);
  await rm(dir, { recursive: true, force: true });
});

test("search tool treats a flag-like query as a literal pattern", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-search-"));
  await writeFile(join(dir, "a.txt"), "this file mentions --files in its text\n");
  const tool: any = new SearchTool(new LocalExecutor());

  try {
    const result = await tool.execute({ query: "--files", path: dir });

    assert.equal(result.exitCode, 0, "the literal pattern should match");
    assert.match(result.stdout, /mentions --files in its text/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("search tool does not let a flag-like query swallow the path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-search-"));
  await writeFile(join(dir, "b.txt"), "pattern-file.txt appears here\n");
  const tool: any = new SearchTool(new LocalExecutor());

  try {
    const result = await tool.execute({ query: "-f", path: dir });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /pattern-file\.txt appears here/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("default tools register under expected names", () => {
  const registry = new ToolRegistry();
  for (const tool of createDefaultTools(new LocalExecutor())) {
    registry.register(tool);
  }
  const names = registry
    .list()
    .map((tool) => tool.name)
    .sort();
  assert.deepEqual(names, ["code-search", "filesystem", "git", "search", "shell"]);
});

test("code-search tool scans a project and returns matching symbols", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-code-search-"));
  await mkdir(join(dir, "src"));
  await writeFile(
    join(dir, "src", "agent.ts"),
    "export function findAgent() {}\nexport class AgentContext { runAgent() {} }\n"
  );

  const tool: any = new CodeSearchTool();
  const result = await tool.execute(
    { query: "findAgent", path: "." },
    { sessionId: "ctx-test", workingDirectory: dir }
  );

  assert.equal(result.count, 1);
  assert.equal(result.results[0].name, "findAgent");
  assert.equal(result.results[0].line, 1);
  assert.ok(result.results[0].score >= 100);
  assert.ok(result.results[0].reasons.includes("name:exact"));

  const methods = await tool.execute(
    { query: "runAgent", path: ".", kind: "method", limit: 5 },
    { sessionId: "ctx-test", workingDirectory: dir }
  );
  assert.equal(methods.count, 1);
  assert.equal(methods.results[0].kind, "method");
  assert.equal(methods.results[0].containerName, "AgentContext");

  await rm(dir, { recursive: true, force: true });
});

test("code-search references mode locates symbol usages via TypeScript language service", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-code-search-refs-"));
  await mkdir(join(dir, "src"));
  await writeFile(
    join(dir, "src", "agent.ts"),
    [
      "export function findAgent() {}",
      "export class AgentContext {",
      "  runAgent() {}",
      "}",
      "const ctx = new AgentContext();",
      "ctx.runAgent();",
      "console.log(findAgent());",
    ].join("\n")
  );

  const tool: any = new CodeSearchTool();
  const result = await tool.execute(
    { mode: "references", file: join(dir, "src", "agent.ts"), line: 3, column: 10 },
    { sessionId: "ctx-test", workingDirectory: dir }
  );

  assert.equal(result.mode, "references");
  assert.equal(result.file, join(dir, "src", "agent.ts"));
  assert.equal(result.line, 3);
  assert.ok(result.count >= 2, `expected at least 2 references, got ${result.count}`);
  assert.ok(
    result.references.some((ref) => ref.snippet.includes("runAgent")),
    "expected at least one reference to include the runAgent snippet"
  );

  await rm(dir, { recursive: true, force: true });
});

test("code-search rejects a line beyond the end of the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-code-search-refs-"));
  await writeFile(join(dir, "a.ts"), "export function alpha() { return 1; }\n", "utf8");
  const tool: any = new CodeSearchTool();

  try {
    await assert.rejects(
      () => tool.execute({ mode: "references", file: "a.ts", line: 99, path: dir }),
      /line 99 is beyond the end of/
    );
    await assert.rejects(
      () => tool.execute({ mode: "references", file: "a.ts", line: 0, path: dir }),
      /line must be a positive integer/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("code-search rejects a column beyond the end of the line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-code-search-refs-"));
  await writeFile(join(dir, "a.ts"), "export function alpha() { return 1; }\n", "utf8");
  const tool: any = new CodeSearchTool();

  try {
    await assert.rejects(
      () =>
        tool.execute({
          mode: "definition",
          file: "a.ts",
          line: 1,
          column: 999,
          path: dir,
        }),
      /column 999 is beyond the end of line 1/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("code-search definition mode resolves a symbol via TypeScript language service", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-code-search-defn-"));
  await mkdir(join(dir, "src"));
  await writeFile(
    join(dir, "src", "agent.ts"),
    [
      "export function findAgent() {}",
      "export class AgentContext {",
      "  runAgent() {}",
      "}",
      "const ctx = new AgentContext();",
      "ctx.runAgent();",
    ].join("\n")
  );

  const tool: any = new CodeSearchTool();
  const result = await tool.execute(
    { mode: "definition", file: join(dir, "src", "agent.ts"), line: 6, column: 10 },
    { sessionId: "ctx-test", workingDirectory: dir }
  );

  assert.equal(result.mode, "definition");
  assert.equal(result.file, join(dir, "src", "agent.ts"));
  assert.equal(result.line, 6);
  assert.ok(result.definition, "expected a definition result");
  assert.equal(result.definition.name, "runAgent");
  assert.equal(result.definition.kind, "method");
  assert.equal(result.definition.line, 3);

  await rm(dir, { recursive: true, force: true });
});
