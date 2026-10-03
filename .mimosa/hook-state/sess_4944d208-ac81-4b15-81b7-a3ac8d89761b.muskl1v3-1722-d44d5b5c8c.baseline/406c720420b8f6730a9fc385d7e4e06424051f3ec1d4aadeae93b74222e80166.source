import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentToolRegistry, runTool } from "../dist/index.js";

test("a timeout aborts the signal the tool receives", async () => {
  let aborted = false;
  let resolveAbort: (() => void) | undefined;
  const sawAbort = new Promise<void>((resolve) => {
    resolveAbort = resolve;
  });

  const tools = new AgentToolRegistry();
  tools.register({
    name: "slow-tool",
    description: "Never finishes on its own.",
    async execute(_input, context) {
      await new Promise<void>((resolve) => {
        context?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolveAbort?.();
            resolve();
          },
          { once: true }
        );
      });
      return { finished: true };
    },
  });

  const result = await runTool(
    tools,
    { id: "c1", name: "slow-tool", input: {} },
    { sessionId: "s", workingDirectory: process.cwd() },
    { timeoutMs: 50 }
  );

  await Promise.race([sawAbort, new Promise((resolve) => setTimeout(resolve, 500))]);
  assert.match(result, /timed out after 50ms/);
  assert.equal(aborted, true, "the tool must be told to stop, not just ignored");
});

test("a timed-out command is killed instead of finishing in the background", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-timeout-cancel-"));
  const marker = join(dir, "finished.txt");
  const tools = new AgentToolRegistry();
  // Mirrors what the shell tool + LocalExecutor do: spawn a child and kill it
  // when the context signal aborts. `agent-core` does not depend on the
  // executor package, so the child is spawned directly here.
  tools.register({
    name: "shell",
    description: "Runs a command, honouring the abort signal.",
    async execute(input, context) {
      const { command, args } = input as { command: string; args: string[] };
      return await new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: "ignore" });
        const onAbort = (): void => {
          child.kill("SIGKILL");
        };
        context?.signal?.addEventListener("abort", onAbort, { once: true });
        child.on("error", reject);
        child.on("close", (code) => {
          context?.signal?.removeEventListener("abort", onAbort);
          resolve({ exitCode: code ?? 0, aborted: context?.signal?.aborted === true });
        });
      });
    },
  });

  try {
    const result = await runTool(
      tools,
      {
        id: "c1",
        name: "shell",
        input: { command: "sh", args: ["-c", `sleep 3; echo ran > ${marker}`] },
      },
      { sessionId: "s", workingDirectory: dir },
      { timeoutMs: 300 }
    );
    assert.match(result, /timed out after 300ms/);

    // Wait past the point where the command would have written the marker.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const written = await readFile(marker, "utf8").then(() => true).catch(() => false);
    assert.equal(written, false, "the command must be killed, not left running");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a tool that finishes in time is not aborted", async () => {
  let sawAbort = false;
  const tools = new AgentToolRegistry();
  tools.register({
    name: "fast-tool",
    description: "Finishes immediately.",
    async execute(_input, context) {
      context?.signal?.addEventListener("abort", () => {
        sawAbort = true;
      });
      return { ok: true };
    },
  });

  const result = await runTool(
    tools,
    { id: "c1", name: "fast-tool", input: {} },
    { sessionId: "s", workingDirectory: process.cwd() },
    { timeoutMs: 5000 }
  );

  assert.deepEqual(JSON.parse(result), { ok: true });
  // Give a stray timer a chance to fire before asserting.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sawAbort, false, "a completed call must not be aborted afterwards");
});

test("an outer run abort still propagates to the tool", async () => {
  let aborted = false;
  let resolveAbort: (() => void) | undefined;
  const sawAbort = new Promise<void>((resolve) => {
    resolveAbort = resolve;
  });
  const tools = new AgentToolRegistry();
  tools.register({
    name: "waiting-tool",
    description: "Waits for an abort.",
    async execute(_input, context) {
      await new Promise<void>((resolve) => {
        context?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolveAbort?.();
            resolve();
          },
          { once: true }
        );
      });
      return { ok: true };
    },
  });

  const outer = new AbortController();
  const pending = runTool(
    tools,
    { id: "c1", name: "waiting-tool", input: {} },
    { sessionId: "s", workingDirectory: process.cwd(), signal: outer.signal },
    { timeoutMs: 5000 }
  );
  setTimeout(() => outer.abort(), 50);
  await pending;
  await Promise.race([sawAbort, new Promise((resolve) => setTimeout(resolve, 500))]);

  assert.equal(aborted, true);
});
