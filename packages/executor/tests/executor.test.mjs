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
