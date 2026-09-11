import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalExecutor } from "../dist/index.js";

const node = process.execPath;
const executor = new LocalExecutor();

test("LocalExecutor returns stdout, stderr, and exit code", async () => {
  const output = await executor.run("echo", ["hello"]);
  assert.equal(output.stdout.trim(), "hello");
  assert.equal(output.stderr, "");
  assert.equal(output.exitCode, 0);

  const failure = await executor.run(node, ["-e", "console.error('boom'); process.exit(7)"]);
  assert.ok(failure.stderr.includes("boom"));
  assert.equal(failure.exitCode, 7);
});

test("LocalExecutor passes environment variables", async () => {
  const script = [
    "process.stdout.write(JSON.stringify({",
    " path: !!process.env.PATH,",
    " value: process.env.DEV_AGENT_EXECUTOR_TEST",
    "}))",
  ].join("");

  const result = await executor.run(node, ["-e", script], {
    env: { DEV_AGENT_EXECUTOR_TEST: "yes" },
  });
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.path, true);
  assert.equal(parsed.value, "yes");
});

test("LocalExecutor writes input to stdin", async () => {
  const result = await executor.run(node, ["-e", "process.stdin.pipe(process.stdout)"], {
    input: "dev-agent",
  });
  assert.equal(result.stdout, "dev-agent");
  assert.equal(result.exitCode, 0);
});

test("LocalExecutor honors a working directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-agent-executor-"));
  try {
    const result = await executor.run(node, ["-e", "process.stdout.write(process.cwd())"], {
      cwd,
    });
    assert.equal(result.stdout, await realpath(cwd));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("LocalExecutor times out long-running commands", async () => {
  const result = await executor.run(node, ["-e", "setTimeout(() => {}, 30000)"], {
    timeoutMs: 50,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, -1);
});

test("LocalExecutor rejects an empty command", async () => {
  await assert.rejects(() => executor.run(""), /non-empty/);
  await assert.rejects(() => executor.run("   "), /non-empty/);
});

test("LocalExecutor surfaces nonexistent commands as errors", async () => {
  await assert.rejects(
    () => executor.run("definitely-not-a-real-command-xyz"),
    (error) => {
      assert.match((error as Error).message, /ENOENT|not found|spawn/);
      return true;
    }
  );
});

test("LocalExecutor preserves stdout across non-zero exits", async () => {
  const result = await executor.run(node, [
    "-e",
    "process.stdout.write('partial'); process.exit(42)",
  ]);
  assert.equal(result.stdout, "partial");
  assert.equal(result.exitCode, 42);
  assert.equal(result.timedOut, undefined);
});

test("LocalExecutor reports durationMs and command", async () => {
  const executor = new LocalExecutor();
  const result = await executor.run("echo", ["timing"]);
  assert.equal(result.command, "echo");
  assert.ok(typeof result.durationMs === "number");
  assert.ok(result.durationMs >= 0);
});

test("LocalExecutor records history when historyLimit is set", async () => {
  const executor = new LocalExecutor({ historyLimit: 2 });
  await executor.run("echo", ["one"]);
  await executor.run("echo", ["two"]);
  await executor.run("echo", ["three"]);

  const history = executor.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].command, "echo");
  assert.equal(history[1].command, "echo");
});

test("LocalExecutor does not record history by default", async () => {
  const executor = new LocalExecutor();
  await executor.run("echo", ["one"]);
  assert.equal(executor.getHistory().length, 0);
});
