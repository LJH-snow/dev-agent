import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { denyDangerousPolicy } from "../dist/index.js";

interface Fixture {
  readonly workspace: string;
  readonly outside: string;
}

/** Workspace with symlinks pointing out of it, plus one pointing inside. */
async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "dev-agent-approval-link-"));
  const outside = await mkdtemp(join(tmpdir(), "dev-agent-approval-out-"));
  try {
    await writeFile(join(outside, "secret.txt"), "ORIGINAL\n", "utf8");
    await mkdir(join(outside, "sub"), { recursive: true });
    await mkdir(join(workspace, "inside"), { recursive: true });
    await symlink(join(outside, "secret.txt"), join(workspace, "link.txt"));
    await symlink(join(outside, "sub"), join(workspace, "outdir"));
    await symlink(join(workspace, "inside"), join(workspace, "internallink"));

    await run({ workspace, outside });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

function decide(workspace: string, input: Record<string, unknown>): string {
  const outcome = denyDangerousPolicy().decide({
    toolName: "filesystem",
    input,
    sessionId: "s",
    workingDirectory: workspace,
  }) as "allow" | "deny" | { readonly decision: "allow" | "deny" };
  return typeof outcome === "string" ? outcome : outcome.decision;
}

test("a symlink pointing outside the workspace cannot be written through", async () => {
  await withFixture(async ({ workspace, outside }) => {
    const decision = decide(workspace, {
      action: "write",
      path: join(workspace, "link.txt"),
      content: "HACKED\n",
    });

    assert.equal(decision, "deny");
    // The policy denies; prove the file it pointed at is untouched.
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "ORIGINAL\n");
  });
});

test("a symlinked directory outside the workspace cannot be written into", async () => {
  await withFixture(async ({ workspace }) => {
    const write = decide(workspace, {
      action: "write",
      path: join(workspace, "outdir", "new.txt"),
      content: "x",
    });
    const mkdir = decide(workspace, {
      action: "mkdir",
      path: join(workspace, "outdir", "newdir"),
    });

    assert.equal(write, "deny");
    assert.equal(mkdir, "deny");
  });
});

test("a new file whose parent is an outside symlink is denied", async () => {
  await withFixture(async ({ workspace }) => {
    const decision = decide(workspace, {
      action: "write",
      path: join(workspace, "outdir", "nested", "deep.txt"),
      content: "x",
    });

    assert.equal(decision, "deny");
  });
});

test("a symlink pointing inside the workspace is still allowed", async () => {
  await withFixture(async ({ workspace }) => {
    const decision = decide(workspace, {
      action: "write",
      path: join(workspace, "internallink", "note.txt"),
      content: "ok",
    });

    assert.equal(decision, "allow");
  });
});

test("ordinary in-workspace writes are unaffected", async () => {
  await withFixture(async ({ workspace }) => {
    assert.equal(
      decide(workspace, { action: "write", path: join(workspace, "plain.txt"), content: "x" }),
      "allow"
    );
    assert.equal(
      decide(workspace, { action: "mkdir", path: join(workspace, "fresh", "dir") }),
      "allow"
    );
    assert.equal(
      decide(workspace, { action: "write", path: "relative/inside.txt", content: "x" }),
      "allow"
    );
  });
});
