import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

    const result = await runCli(["--index", dir, "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
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
  } finally {
    await rm(dir, { recursive: true, force: true });
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

test("--index fails for a missing directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-index-"));
  try {
    const result = await runCli(["--index", join(dir, "nope"), "--json"]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /ENOENT|no such file/i);
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
