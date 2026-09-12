import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalExecutor, RustExecutor } from "../dist/index.js";

test("a missing working directory is reported as such, not as a missing command", async () => {
  const executor = new LocalExecutor();
  const missing = join(tmpdir(), `dev-agent-missing-cwd-${Date.now()}`);

  await assert.rejects(
    () => executor.run("echo", ["hi"], { cwd: missing }),
    (error: Error) => {
      assert.match(error.message, /working directory does not exist/);
      assert.match(error.message, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      // The old failure pointed at `echo`, which exists.
      assert.doesNotMatch(error.message, /spawn echo/);
      return true;
    }
  );
});

test("a working directory that is a file is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-cwd-file-"));
  const file = join(dir, "not-a-dir.txt");
  await writeFile(file, "x", "utf8");
  try {
    const executor = new LocalExecutor();
    await assert.rejects(
      () => executor.run("echo", ["hi"], { cwd: file }),
      /working directory is not a directory/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a genuinely missing command still reports the command", async () => {
  const executor = new LocalExecutor();

  await assert.rejects(
    () => executor.run("definitely-not-a-command-xyz", [], { cwd: tmpdir() }),
    /definitely-not-a-command-xyz/
  );
});

test("RustExecutor gives the same diagnosis before reaching the runtime", async () => {
  // The binary does not exist either; the cwd check must win, proving it runs
  // before anything is spawned.
  const executor = new RustExecutor({ binaryPath: "/tmp/definitely-not-a-runtime" });
  const missing = join(tmpdir(), `dev-agent-rust-cwd-${Date.now()}`);

  await assert.rejects(
    () => executor.run("echo", ["hi"], { cwd: missing }),
    /working directory does not exist/
  );
});
