import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { refreshIndexDirectory } from "../dist/index-command.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

function runCli(args, env = process.env): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end();
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("--index writes a symbol index and skips ignored directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    await writeFile(
      join(dir, "agent.ts"),
      "export function runAgent() {}\nexport class AgentState {}\n",
      "utf8"
    );
    await writeFile(join(dir, "tool.py"), "def run_tool():\n    pass\n", "utf8");
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(dir, "node_modules", "pkg", "index.ts"),
      "export function ignored() {}\n",
      "utf8"
    );
    for (const skipped of [".git", "dist", ".dev-agent"]) {
      await mkdir(join(dir, skipped), { recursive: true });
      await writeFile(join(dir, skipped, "ignored.ts"), "export function ignored() {}\n", "utf8");
    }

    const result = await runCli(["--index", dir, "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.written, true);
    assert.equal(report.files, 2, "node_modules must be skipped");
    assert.ok(report.symbols >= 3, `expected several symbols, got ${report.symbols}`);
    assert.deepEqual(report.languages, { typescript: 1, python: 1 });

    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    assert.equal(index.version, 1);
    assert.equal(Object.keys(index.signatures).length, 2, "every file gets a signature");
    for (const signature of Object.values(index.signatures) as any[]) {
      assert.equal(typeof signature.mtimeMs, "number");
      assert.equal(typeof signature.size, "number");
    }
    const names = index.symbols.map((symbol) => symbol.name);
    assert.ok(names.includes("runAgent"));
    assert.ok(names.includes("run_tool"));
    assert.ok(!names.includes("ignored"));
    assert.deepEqual(Object.keys(index.files), [...Object.keys(index.files)].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index skips supported source files above the fixed 16 MiB read limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-limit-"));
  try {
    await writeFile(join(dir, "small.ts"), "export const keep = 1;\n", "utf8");
    await writeFile(
      join(dir, "large.ts"),
      `export const skip = 1;\n${"x".repeat(16 * 1024 * 1024)}`,
      "utf8"
    );

    const result = await runCli(["--index", dir, "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.files, 1);
    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    assert.deepEqual(Object.keys(index.files), [join(dir, "small.ts")]);
    assert.ok(!JSON.stringify(index).includes("skip"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index reports an oversized serialized write and preserves the previous index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-write-limit-"));
  const indexPath = join(dir, ".dev-agent", "index.json");
  try {
    const source = `/*${"x".repeat(16 * 1024 * 1024 - 256)}*/\nexport const kept = 1;\n`;
    assert.ok(Buffer.byteLength(source, "utf8") < 16 * 1024 * 1024);
    await writeFile(join(dir, "large.ts"), source, "utf8");

    const result = await runCli(["--index", dir, "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.files, 1);
    assert.equal(report.written, false);
    await assert.rejects(readFile(indexPath), { code: "ENOENT" });

    const human = await runCli(["--index", dir]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /Index not written: serialized index exceeds the 16 MiB limit/);
    assert.doesNotMatch(human.stdout, /Index written to/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index keeps file and symbol order stable and skips source symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-order-"));
  const outside = await mkdtemp(join(tmpdir(), "dev-agent-index-outside-"));
  try {
    await writeFile(join(dir, "z.ts"), "export function zSymbol() {}\n", "utf8");
    await writeFile(join(dir, "a.ts"), "export function aSymbol() {}\n", "utf8");
    const outsideFile = join(outside, "outside.ts");
    await writeFile(
      outsideFile,
      "export function outsideOnlySymbol() {}\n",
      "utf8"
    );
    await symlink(outsideFile, join(dir, "linked.ts"));

    const result = await runCli(["--index", dir, "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    assert.deepEqual(Object.keys(index.files), [join(dir, "a.ts"), join(dir, "z.ts")]);
    assert.deepEqual(Object.keys(index.signatures), [join(dir, "a.ts"), join(dir, "z.ts")]);
    assert.deepEqual(
      index.symbols.map((symbol) => symbol.name),
      ["aSymbol", "zSymbol"]
    );
    assert.ok(!JSON.stringify(index).includes("outsideOnlySymbol"));
    assert.equal(JSON.parse(result.stdout).files, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("--index ignores an oversized persisted index and rescans its sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-persisted-limit-"));
  const sourcePath = join(dir, "sample.ts");
  try {
    await writeFile(sourcePath, "export const real = 1;\n", "utf8");
    const first = await runCli(["--index", dir, "--json"]);
    assert.equal(first.code, 0, first.stderr);
    const indexPath = join(dir, ".dev-agent", "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    await writeFile(
      indexPath,
      JSON.stringify({
        ...index,
        symbols: [{ name: "ghost", kind: "variable", filePath: sourcePath, line: 1 }],
        padding: "x".repeat(16 * 1024 * 1024),
      }),
      "utf8"
    );

    const result = await runCli(["--index", dir, "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.reused, 0);
    const refreshed = JSON.parse(await readFile(indexPath, "utf8"));
    const names = refreshed.symbols.map((symbol) => symbol.name);
    assert.ok(names.includes("real"));
    assert.ok(!names.includes("ghost"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("index refresh rejects a scan limit before replacing the previous index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-scan-limit-"));
  const indexPath = join(dir, ".dev-agent", "index.json");
  try {
    await writeFile(join(dir, "first.ts"), "export const first = 1;\n", "utf8");
    const initial = await runCli(["--index", dir, "--json"]);
    assert.equal(initial.code, 0, initial.stderr);
    const before = await readFile(indexPath);

    await writeFile(join(dir, "second.ts"), "export const second = 2;\n", "utf8");

    await assert.rejects(
      refreshIndexDirectory(
        dir,
        undefined,
        [],
        indexPath,
        { maxFiles: 1, maxSourceBytes: 256 * 1024 * 1024 } as any
      ),
      (error) => {
        const candidate = error as any;
        assert.equal(candidate.code, "INDEX_SCAN_LIMIT_EXCEEDED");
        assert.equal(candidate.dimension, "files");
        assert.equal(candidate.limit, 1);
        assert.equal(candidate.observed, 2);
        assert.equal(candidate.message, "index scan files limit exceeded");
        assert.ok(!candidate.message.includes(dir));
        assert.ok(!JSON.stringify(candidate).includes(dir));
        return true;
      }
    );

    assert.deepEqual(await readFile(indexPath), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index excludes repeated paths relative to the final --cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    await writeFile(join(dir, "keep.ts"), "export const keep = 1;\n", "utf8");
    await mkdir(join(dir, "generated", "nested"), { recursive: true });
    await writeFile(join(dir, "generated", "ignored.ts"), "export const ignored = 1;\n", "utf8");
    await writeFile(
      join(dir, "generated", "nested", "also-ignored.ts"),
      "export const alsoIgnored = 1;\n",
      "utf8"
    );

    const result = await runCli([
      "--cwd",
      dir,
      "--index",
      ".",
      "--exclude",
      "generated",
      "--exclude",
      "./generated",
      "--json",
    ]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.files, 1);
    assert.equal(report.excluded, 1, "duplicate spellings must count once");
    assert.equal(report.warnings.length, 0);

    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    assert.deepEqual(Object.keys(index.files), [join(dir, "keep.ts")]);
    assert.ok(!JSON.stringify(index).includes("ignored"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index can exclude an individual source file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    await writeFile(join(dir, "keep.ts"), "export const keep = 1;\n", "utf8");
    await writeFile(join(dir, "secret.ts"), "export const secret = 1;\n", "utf8");

    const result = await runCli([
      "--cwd",
      dir,
      "--index",
      ".",
      "--exclude",
      "secret.ts",
      "--json",
    ]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.files, 1);
    assert.equal(report.excluded, 1);
    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    assert.deepEqual(Object.keys(index.files), [join(dir, "keep.ts")]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index rejects an exclude path outside the indexed root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    const result = await runCli([
      "--cwd",
      dir,
      "--index",
      ".",
      "--exclude",
      "../outside",
      "--json",
    ]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.match(payload.error, /exclude.*inside|inside.*exclude/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index never follows a directory symlink outside the root", async (t) => {
  if (process.platform === "win32") {
    return t.skip("directory symlink fixtures require platform privileges on Windows");
  }

  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  const outside = await mkdtemp(join(tmpdir(), "dev-agent-index-outside-"));
  try {
    await writeFile(join(outside, "external.ts"), "export const external = 1;\n", "utf8");
    await symlink(outside, join(dir, "linked"), "dir");

    const result = await runCli(["--cwd", dir, "--index", ".", "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.files, 0);
    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    assert.ok(!JSON.stringify(index).includes("external"));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("--index prints a human summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    await writeFile(join(dir, "a.ts"), "export const answer = 42;\n", "utf8");

    const result = await runCli(["--index", dir]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Indexed 1 files \/ \d+ symbols/);
    assert.match(result.stdout, /Index written to/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index skips an unreadable child directory and completes", async (t) => {
  if (process.platform === "win32") {
    return t.skip("chmod-based unreadable-directory fixtures are Unix-specific");
  }

  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  const protectedDirs = [
    join(dir, "z-protected"),
    join(dir, "a-protected"),
  ];
  try {
    await writeFile(join(dir, "readable.ts"), "export const answer = 42;\n", "utf8");
    for (const protectedDir of protectedDirs) {
      await mkdir(protectedDir);
      await writeFile(join(protectedDir, "hidden.ts"), "export const hidden = true;\n", "utf8");
      await chmod(protectedDir, 0);
    }

    const result = await runCli(["--index", dir, "--json"]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.doesNotThrow(() => JSON.parse(result.stdout));
    const report = JSON.parse(result.stdout);
    assert.equal(report.files, 1);
    assert.equal(report.skipped, 2);
    assert.deepEqual(
      report.warnings.map((warning) => warning.path),
      ["a-protected", "z-protected"]
    );
    assert.ok(report.warnings.every((warning) => ["EACCES", "EPERM"].includes(warning.code)));
    assert.ok(!JSON.stringify(report.warnings).includes(dir));
  } finally {
    for (const protectedDir of protectedDirs) {
      await chmod(protectedDir, 0o700).catch(() => undefined);
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index warns in human mode when a child directory cannot be read", async (t) => {
  if (process.platform === "win32") {
    return t.skip("chmod-based unreadable-directory fixtures are Unix-specific");
  }

  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  const protectedDir = join(dir, "protected");
  try {
    await writeFile(join(dir, "readable.ts"), "export const answer = 42;\n", "utf8");
    await mkdir(protectedDir);
    await chmod(protectedDir, 0);

    const result = await runCli(["--index", dir]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Indexed 1 files \/ \d+ symbols/);
    assert.match(result.stderr, /Warning: skipped directory protected \((?:EACCES|EPERM)\)/);
    assert.ok(!result.stderr.includes(dir));
  } finally {
    await chmod(protectedDir, 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index human output sanitizes the configured path", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  const dir = join(parent, "source\u001b[31m");
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, "a.ts"), "export const answer = 42;\n", "utf8");

    const result = await runCli(["--index", dir]);

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /\u001b/);
    assert.match(result.stdout, /Index written to/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("--index keeps an unreadable root directory as an error", async (t) => {
  if (process.platform === "win32") {
    return t.skip("chmod-based unreadable-directory fixtures are Unix-specific");
  }

  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    await chmod(dir, 0);

    const result = await runCli(["--index", dir, "--json"]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.match(payload.error, /EACCES|EPERM|permission denied/i);
  } finally {
    await chmod(dir, 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index fails for a missing directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    const result = await runCli(["--index", join(dir, "nope"), "--json"]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.match(payload.error, /ENOENT|no such file/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index reuses unchanged files on the next run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    await writeFile(join(dir, "changed.ts"), "export function first() {}\n", "utf8");
    await writeFile(join(dir, "stable.ts"), "export function stable() {}\n", "utf8");

    const first = JSON.parse((await runCli(["--index", dir, "--json"])).stdout);
    assert.equal(first.reused, 0, "a first run has nothing to reuse");

    await writeFile(join(dir, "changed.ts"), "export function second() {}\n", "utf8");

    const second = JSON.parse((await runCli(["--index", dir, "--json"])).stdout);
    assert.equal(second.files, 2);
    assert.equal(second.reused, 1, "only the untouched file should be reused");

    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    const names = index.symbols.map((symbol) => symbol.name);
    assert.ok(names.includes("second"));
    assert.ok(!names.includes("first"), "the stale symbol should be replaced");
    assert.ok(names.includes("stable"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index does not reuse a file whose content changed with the same mtime and size", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  const sourcePath = join(dir, "stable-size.ts");
  const fixedTime = new Date("2020-01-02T03:04:05.000Z");
  try {
    await writeFile(sourcePath, "export const alpha = 1;\n", "utf8");
    await utimes(sourcePath, fixedTime, fixedTime);
    const first = await runCli(["--index", dir, "--json"]);
    assert.equal(first.code, 0, first.stderr);

    await writeFile(sourcePath, "export const omega = 2;\n", "utf8");
    await utimes(sourcePath, fixedTime, fixedTime);
    const second = await runCli(["--index", dir, "--json"]);

    assert.equal(second.code, 0, second.stderr);
    const report = JSON.parse(second.stdout);
    assert.equal(report.reused, 0, "content changes must invalidate reuse");
    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    const names = index.symbols.map((symbol) => symbol.name);
    assert.ok(names.includes("omega"));
    assert.ok(!names.includes("alpha"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index recovers from a corrupted persisted index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    await writeFile(join(dir, "recover.ts"), "export const recover = true;\n", "utf8");
    const first = await runCli(["--index", dir, "--json"]);
    assert.equal(first.code, 0, first.stderr);
    await writeFile(join(dir, ".dev-agent", "index.json"), "{not-json", "utf8");

    const second = await runCli(["--index", dir, "--json"]);

    assert.equal(second.code, 0, second.stderr);
    const report = JSON.parse(second.stdout);
    assert.equal(report.reused, 0, "a corrupt cache must force a fresh scan");
    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    assert.ok(index.symbols.some((symbol) => symbol.name === "recover"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--index removes deleted files and adds renamed files on the next run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    await writeFile(join(dir, "old.ts"), "export const oldName = 1;\n", "utf8");
    await writeFile(join(dir, "stable.ts"), "export const stable = 1;\n", "utf8");
    const first = await runCli(["--index", dir, "--json"]);
    assert.equal(first.code, 0, first.stderr);

    await rm(join(dir, "old.ts"));
    await writeFile(join(dir, "renamed.ts"), "export const renamed = 1;\n", "utf8");
    const second = await runCli(["--index", dir, "--json"]);

    assert.equal(second.code, 0, second.stderr);
    const report = JSON.parse(second.stdout);
    assert.equal(report.files, 2);
    assert.equal(report.reused, 1, "only the unchanged file should be reused");
    const index = JSON.parse(await readFile(join(dir, ".dev-agent", "index.json"), "utf8"));
    const names = index.symbols.map((symbol) => symbol.name);
    assert.ok(names.includes("renamed"));
    assert.ok(!names.includes("oldName"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
