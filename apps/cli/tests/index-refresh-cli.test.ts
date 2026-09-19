import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

function runCli(
  args: readonly string[],
  cwd: string,
  interruptAfterMs?: number
): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly sentInterrupt: boolean;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, DEV_AGENT_MODEL_PROVIDER: "ollama", DEV_AGENT_MCP_SERVERS: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let sentInterrupt = false;
    let interruptTimer: ReturnType<typeof setTimeout> | undefined;
    if (interruptAfterMs !== undefined) {
      interruptTimer = setTimeout(() => {
        sentInterrupt = child.kill("SIGINT");
      }, interruptAfterMs);
    }
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code, signal) => {
      if (interruptTimer !== undefined) clearTimeout(interruptTimer);
      resolveResult({ code, signal, sentInterrupt, stdout, stderr });
    });
  });
}

test("CLI index refresh SIGINT returns stable cancellation without replacing the old index", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-index-refresh-cli-cancel-"));
  const indexPath = join(root, "cache", "index.json");
  try {
    await writeFile(join(root, "stable.ts"), "export const stable = 1;\n", "utf8");
    const baseline = await runCli(
      ["index", "refresh", "--cwd", root, "--index-file", indexPath, "--json"],
      root
    );
    assert.equal(baseline.code, 0, baseline.stderr);
    const previousIndex = await readFile(indexPath);

    const largeSource = `${Array.from(
      { length: 30_000 },
      (_, index) => `export const cancelSymbol${index} = ${index};`
    ).join("\n")}\n`;
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        writeFile(join(root, `new-${index}.ts`), largeSource, "utf8")
      )
    );

    const interrupted = await runCli(
      ["index", "refresh", "--cwd", root, "--index-file", indexPath, "--json"],
      root,
      500
    );

    assert.equal(interrupted.sentInterrupt, true, interrupted.stderr);
    assert.equal(interrupted.signal, null, interrupted.stderr);
    assert.equal(interrupted.code, 130, interrupted.stderr);
    const cancellation = JSON.parse(interrupted.stdout);
    assert.deepEqual(
      {
        command: cancellation.command,
        status: cancellation.status,
        cancelled: cancellation.cancelled,
      },
      {
        command: "index refresh",
        status: "cancelled",
        cancelled: true,
      }
    );
    assert.ok(["discovering", "processing", "persisting"].includes(cancellation.phase));
    assert.equal(typeof cancellation.completed, "number");
    assert.equal(typeof cancellation.total, "number");
    assert.deepEqual(await readFile(indexPath), previousIndex);

    const cacheEntries = await readdir(join(root, "cache"));
    assert.equal(
      cacheEntries.some((entry) => entry.startsWith("index.json.tmp-")),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
