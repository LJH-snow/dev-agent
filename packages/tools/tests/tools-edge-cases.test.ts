import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CodeSearchTool,
  FilesystemTool,
  GitTool,
  SearchTool,
  ShellTool,
} from "../dist/index.js";

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Records the command/args/options a tool hands to its executor. */
function recordingExecutor(result = { stdout: "", stderr: "", exitCode: 0 }) {
  const calls = [];
  return {
    calls,
    async run(command, args, options) {
      calls.push({ command, args, options });
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// FilesystemTool
// ---------------------------------------------------------------------------

test("filesystem tool writes and reads back a file", async () => {
  await withTempDir("dev-agent-fs-rw-", async (dir) => {
    const tool: any = new FilesystemTool();
    const path = join(dir, "note.txt");

    const written = await tool.execute({ action: "write", path, content: "hello" });
    assert.equal(written.ok, true);

    const read = await tool.execute({ action: "read", path });
    assert.equal(read.content, "hello");
  });
});

test("filesystem tool writes an empty file when content is omitted", async () => {
  await withTempDir("dev-agent-fs-empty-", async (dir) => {
    const tool: any = new FilesystemTool();
    const path = join(dir, "empty.txt");

    await tool.execute({ action: "write", path });

    const read = await tool.execute({ action: "read", path });
    assert.equal(read.content, "");
  });
});

test("filesystem tool rejects non-string content instead of writing an empty file", async () => {
  await withTempDir("dev-agent-fs-badcontent-", async (dir) => {
    const tool: any = new FilesystemTool();
    await assert.rejects(
      () => tool.execute({ action: "write", path: join(dir, "x.txt"), content: { a: 1 } }),
      /filesystem content must be a string when provided/
    );
  });
});

test("filesystem tool rejects write content above the 16 MiB limit", async () => {
  await withTempDir("dev-agent-fs-write-limit-", async (dir) => {
    const path = join(dir, "too-large.txt");
    const tool: any = new FilesystemTool();

    await assert.rejects(
      () =>
        tool.execute({
          action: "write",
          path,
          content: "x".repeat(16 * 1024 * 1024 + 1),
        }),
      /filesystem file exceeds the 16 MiB write limit/
    );
    assert.equal(await lstat(path).then(() => true, () => false), false);
  });
});

test("filesystem tool mkdir creates nested directories", async () => {
  await withTempDir("dev-agent-fs-mkdir-", async (dir) => {
    const tool: any = new FilesystemTool();

    const created = await tool.execute({ action: "mkdir", path: join(dir, "a", "b", "c") });
    assert.equal(created.ok, true);

    const listed = await tool.execute({ action: "list", path: join(dir, "a") });
    assert.deepEqual(
      listed.entries.map((entry) => entry.name),
      ["b"]
    );
    assert.equal(listed.entries[0].isDirectory, true);
  });
});

test("filesystem tool bounds large directory listings and reports truncation", async () => {
  await withTempDir("dev-agent-fs-list-limit-", async (dir) => {
    const fileNames = Array.from({ length: 257 }, (_, index) => `entry-${index}.txt`);
    await Promise.all(fileNames.map((name) => writeFile(join(dir, name), "")));

    const listed: any = await new FilesystemTool().execute({ action: "list", path: dir });

    assert.equal(listed.entries.length, 256);
    assert.equal(listed.truncated, true);
  });
});

test("filesystem tool stat reports file metadata", async () => {
  await withTempDir("dev-agent-fs-stat-", async (dir) => {
    const tool: any = new FilesystemTool();
    const path = join(dir, "sized.txt");
    await writeFile(path, "12345");

    const result = await tool.execute({ action: "stat", path });

    assert.equal(result.size, 5);
    assert.equal(result.isFile, true);
    assert.equal(result.isDirectory, false);
  });
});

test("filesystem tool rejects an unknown action", async () => {
  const tool: any = new FilesystemTool();
  await assert.rejects(
    () => tool.execute({ action: "delete", path: "x" }),
    /filesystem action must be one of/
  );
});

test("filesystem tool rejects an empty path", async () => {
  const tool: any = new FilesystemTool();
  await assert.rejects(
    () => tool.execute({ action: "read", path: "" }),
    /filesystem path must be a non-empty string/
  );
});

test("filesystem tool rejects non-object input", async () => {
  const tool: any = new FilesystemTool();
  await assert.rejects(() => tool.execute("nope"), /tool input must be an object/);
});

// ---------------------------------------------------------------------------
// ShellTool
// ---------------------------------------------------------------------------

test("shell tool forwards command, args, and working directory to the executor", async () => {
  const executor = recordingExecutor();
  const tool: any = new ShellTool(executor);

  await tool.execute(
    { command: "echo", args: ["hi"] },
    { sessionId: "s", workingDirectory: "/tmp" }
  );

  assert.deepEqual(executor.calls, [
    { command: "echo", args: ["hi"], options: { cwd: "/tmp" } },
  ]);
});

test("shell tool forwards the abort signal to the executor", async () => {
  const executor = recordingExecutor();
  const tool: any = new ShellTool(executor);
  const controller = new AbortController();

  await tool.execute(
    { command: "sleep", args: ["10"] },
    { sessionId: "s", workingDirectory: "/tmp", signal: controller.signal }
  );

  assert.equal(executor.calls[0].options.signal, controller.signal);
});

test("shell tool treats missing args as an empty list", async () => {
  const executor = recordingExecutor();
  const tool: any = new ShellTool(executor);

  await tool.execute({ command: "pwd" });

  assert.deepEqual(executor.calls[0].args, []);
});

test("shell tool rejects an empty command", async () => {
  const tool: any = new ShellTool(recordingExecutor());
  await assert.rejects(
    () => tool.execute({ command: "" }),
    /shell command must be a non-empty string/
  );
});

test("shell tool rejects non-string args", async () => {
  const tool: any = new ShellTool(recordingExecutor());
  await assert.rejects(
    () => tool.execute({ command: "echo", args: [1] }),
    /expected an array of strings/
  );
  await assert.rejects(
    () => tool.execute({ command: "echo", args: "not-an-array" }),
    /expected an array of strings/
  );
});

// ---------------------------------------------------------------------------
// GitTool
// ---------------------------------------------------------------------------

test("git tool forwards args to git in the working directory", async () => {
  const executor = recordingExecutor();
  const tool: any = new GitTool(executor);

  await tool.execute({ args: ["status", "--short"] }, { sessionId: "s", workingDirectory: "/repo" });

  assert.deepEqual(executor.calls, [
    { command: "git", args: ["status", "--short"], options: { cwd: "/repo" } },
  ]);
});

test("git tool requires at least one argument", async () => {
  const tool: any = new GitTool(recordingExecutor());
  await assert.rejects(() => tool.execute({ args: [] }), /git tool requires args/);
});

test("git tool rejects non-array args", async () => {
  const tool: any = new GitTool(recordingExecutor());
  await assert.rejects(() => tool.execute({ args: "status" }), /git args must be an array/);
});

// ---------------------------------------------------------------------------
// SearchTool
// ---------------------------------------------------------------------------

test("search tool defaults the path to the working directory", async () => {
  const executor = recordingExecutor();
  const tool: any = new SearchTool(executor);

  await tool.execute({ query: "needle" }, { sessionId: "s", workingDirectory: "/repo" });

  assert.deepEqual(executor.calls, [
    {
      command: "rg",
      args: ["--line-number", "--color", "never", "--", "needle", "."],
      options: { cwd: "/repo" },
    },
  ]);
});

test("search tool adds -l when filesOnly is set", async () => {
  const executor = recordingExecutor();
  const tool: any = new SearchTool(executor);

  await tool.execute({ query: "needle", path: "src", filesOnly: true });

  assert.deepEqual(executor.calls[0].args, [
    "--line-number",
    "--color",
    "never",
    "-l",
    "--",
    "needle",
    "src",
  ]);
});

test("search tool rejects an empty query", async () => {
  const tool: any = new SearchTool(recordingExecutor());
  await assert.rejects(
    () => tool.execute({ query: "" }),
    /search query must be a non-empty string/
  );
});

// ---------------------------------------------------------------------------
// CodeSearchTool
// ---------------------------------------------------------------------------

async function writeSearchProject(dir) {
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
}

test("code-search references mode accepts a path relative to the working directory", async () => {
  await withTempDir("dev-agent-cs-rel-refs-", async (dir) => {
    await writeSearchProject(dir);
    const tool: any = new CodeSearchTool();

    const result = await tool.execute(
      { mode: "references", file: "src/agent.ts", line: 3, column: 10 },
      { sessionId: "s", workingDirectory: dir }
    );

    assert.ok(result.count >= 2, `expected at least 2 references, got ${result.count}`);
  });
});

test("code-search definition mode accepts a path relative to the working directory", async () => {
  await withTempDir("dev-agent-cs-rel-def-", async (dir) => {
    await writeSearchProject(dir);
    const tool: any = new CodeSearchTool();

    const result = await tool.execute(
      { mode: "definition", file: "src/agent.ts", line: 6, column: 5 },
      { sessionId: "s", workingDirectory: dir }
    );

    assert.ok(result.definition, "expected a definition result for a relative path");
  });
});

test("code-search definition mode accepts a source file passed as path", async () => {
  await withTempDir("dev-agent-cs-file-in-path-", async (dir) => {
    await writeSearchProject(dir);
    const tool: any = new CodeSearchTool();

    const result = await tool.execute(
      { mode: "definition", path: "src/agent.ts", line: 6, column: 5 },
      { sessionId: "s", workingDirectory: dir }
    );

    assert.ok(result.definition, "expected a definition result when path names the source file");
  });
});

test("code-search definition mode resolves a symbol query without a position", async () => {
  await withTempDir("dev-agent-cs-query-def-", async (dir) => {
    await writeSearchProject(dir);
    const tool: any = new CodeSearchTool();

    const result = await tool.execute(
      { mode: "definition", query: "findAgent" },
      { sessionId: "s", workingDirectory: dir }
    );

    assert.equal(result.definition.name, "findAgent");
    assert.equal(result.definition.filePath, join(dir, "src", "agent.ts"));
    assert.equal(result.definition.line, 1);
  });
});

test("code-search search mode accepts a source file passed as path", async () => {
  await withTempDir("dev-agent-cs-file-search-", async (dir) => {
    await writeSearchProject(dir);
    await writeFile(join(dir, "src", "other.ts"), "export function findAgentElsewhere() {}\n");
    const tool: any = new CodeSearchTool();

    const result = await tool.execute(
      { mode: "search", query: "findAgent", path: "src/agent.ts" },
      { sessionId: "s", workingDirectory: dir }
    );

    assert.ok(result.count > 0, "expected a symbol result in the selected source file");
    assert.ok(
      result.results.every((entry) => entry.filePath === join(dir, "src", "agent.ts")),
      "expected file-scoped search results"
    );
  });
});

test("code-search search mode filters by symbol kind", async () => {
  await withTempDir("dev-agent-cs-kind-", async (dir) => {
    await writeSearchProject(dir);
    const tool: any = new CodeSearchTool();

    const result = await tool.execute(
      { mode: "search", query: "AgentContext", kind: "class" },
      { sessionId: "s", workingDirectory: dir }
    );

    assert.ok(result.count >= 1, `expected at least 1 class match, got ${result.count}`);
    assert.ok(result.results.every((entry) => entry.kind === "class"));
  });
});

test("code-search position modes explain that file and line are required", async () => {
  const tool: any = new CodeSearchTool();

  await assert.rejects(
    () => tool.execute({ mode: "references", path: "." }),
    /requires file and line.*use search mode or definition with query/i
  );
});

test("code-search rejects query and position inputs being mixed", async () => {
  const tool: any = new CodeSearchTool();

  await assert.rejects(
    () =>
      tool.execute({
        mode: "definition",
        query: "Protocol",
        file: "app/agents/protocols.py",
        line: 17,
      }),
    /cannot combine query with line or column.*omit query for position lookup/i
  );
});

test("code-search search mode honors the limit", async () => {
  await withTempDir("dev-agent-cs-limit-", async (dir) => {
    await writeSearchProject(dir);
    const tool: any = new CodeSearchTool();

    const result = await tool.execute(
      { mode: "search", query: "agent", limit: 1 },
      { sessionId: "s", workingDirectory: dir }
    );

    assert.equal(result.count, 1);
  });
});

test("code-search skips node_modules and dist during a scan", async () => {
  await withTempDir("dev-agent-cs-skip-", async (dir) => {
    await writeSearchProject(dir);
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(dir, "node_modules", "pkg", "index.ts"), "export const VendoredSymbol = 1;");
    await mkdir(join(dir, "dist"));
    await writeFile(join(dir, "dist", "bundle.ts"), "export const BundledSymbol = 1;");

    const tool: any = new CodeSearchTool();
    const result = await tool.execute(
      { mode: "search", query: "Symbol" },
      { sessionId: "s", workingDirectory: dir }
    );

    assert.equal(result.count, 0, "expected vendored and bundled symbols to be skipped");
  });
});

test("code-search applies project ignore files and virtual-environment defaults", async () => {
  await withTempDir("dev-agent-cs-ignore-", async (dir) => {
    await writeFile(join(dir, ".gitignore"), "generated/\n", "utf8");
    await mkdir(join(dir, "generated"), { recursive: true });
    await writeFile(join(dir, "generated", "ignored.ts"), "export const GeneratedSymbol = 1;", "utf8");
    await mkdir(join(dir, ".venv"), { recursive: true });
    await writeFile(join(dir, ".venv", "ignored.py"), "def VirtualEnvSymbol():\n    pass\n", "utf8");
    await writeFile(join(dir, "kept.ts"), "export const KeptSymbol = 1;", "utf8");

    const tool: any = new CodeSearchTool();
    const result = await tool.execute(
      { mode: "search", query: "Symbol" },
      { sessionId: "s", workingDirectory: dir }
    );

    assert.deepEqual(result.results.map((item) => item.name), ["KeptSymbol"]);
  });
});

test("code-search rejects an invalid mode", async () => {
  const tool: any = new CodeSearchTool();
  await assert.rejects(
    () => tool.execute({ mode: "rename" }),
    /code-search mode must be one of/
  );
});

test("code-search search mode requires a query", async () => {
  const tool: any = new CodeSearchTool();
  await assert.rejects(
    () => tool.execute({ mode: "search" }),
    /code-search query must be a non-empty string/
  );
});

test("code-search rejects an invalid symbol kind", async () => {
  const tool: any = new CodeSearchTool();
  await assert.rejects(
    () => tool.execute({ mode: "search", query: "x", kind: "namespace" }),
    /code-search kind must be a valid symbol kind/
  );
});

// ---------------------------------------------------------------------------
// FilesystemTool oversized reads
// ---------------------------------------------------------------------------

async function writeOversizeFile(dir, name) {
  const path = join(dir, name);
  await writeFile(path, "x".repeat(16 * 1024 * 1024 + 1), "utf8");
  return path;
}

test("filesystem read rejects a file above the 16 MiB read limit", async () => {
  await withTempDir("dev-agent-fs-read-limit-", async (dir) => {
    const path = await writeOversizeFile(dir, "big.txt");
    const tool: any = new FilesystemTool();

    await assert.rejects(
      () => tool.execute({ action: "read", path }),
      /filesystem file exceeds the 16 MiB read limit/
    );
  });
});

test("filesystem edit rejects a file above the 16 MiB read limit without writing", async () => {
  await withTempDir("dev-agent-fs-edit-limit-", async (dir) => {
    const path = await writeOversizeFile(dir, "big.txt");
    const before = await readFile(path, "utf8");
    const tool: any = new FilesystemTool();

    await assert.rejects(
      () => tool.execute({ action: "edit", path, oldText: "x", newText: "y" }),
      /filesystem file exceeds the 16 MiB read limit/
    );

    const after = await readFile(path, "utf8");
    assert.equal(after, before);
  });
});
