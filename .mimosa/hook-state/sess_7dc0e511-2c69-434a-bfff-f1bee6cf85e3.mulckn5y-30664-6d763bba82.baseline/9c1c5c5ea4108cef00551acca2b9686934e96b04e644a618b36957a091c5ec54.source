import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalExecutor } from "@dev-agent/executor";
import { CodeSearchTool, FilesystemTool, SearchTool } from "../dist/index.js";

async function withFixture(run: (workspace: string, outside: string) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "dev-agent-filesystem-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "dev-agent-filesystem-outside-"));
  try {
    await run(workspace, outside);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

const context = (workingDirectory: string) => ({
  sessionId: "isolation-test",
  workingDirectory,
});

test("filesystem rejects paths that escape the project working directory", async () => {
  await withFixture(async (workspace, outside) => {
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "do not read", "utf8");
    const tool: any = new FilesystemTool();

    await assert.rejects(
      () => tool.execute({ action: "read", path: secret }, context(workspace)),
      /escapes the working directory/
    );
    await assert.rejects(
      () => tool.execute({ action: "write", path: "../dev-agent-filesystem-outside-target.txt", content: "blocked" }, context(workspace)),
      /escapes the working directory/
    );
  });
});

test("filesystem rejects symlinks that resolve outside the project", async () => {
  await withFixture(async (workspace, outside) => {
    await writeFile(join(outside, "secret.txt"), "do not read", "utf8");
    await symlink(outside, join(workspace, "linked-outside"));
    const tool: any = new FilesystemTool();

    await assert.rejects(
      () => tool.execute({ action: "read", path: "linked-outside/secret.txt" }, context(workspace)),
      /escapes the working directory|symbolic link/
    );
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "do not read");
  });
});

test("search tools reject paths outside the project working directory", async () => {
  await withFixture(async (workspace, outside) => {
    await writeFile(join(outside, "secret.ts"), "export const secretSymbol = 42;\n", "utf8");
    const toolContext = context(workspace);

    await assert.rejects(
      () => new SearchTool(new LocalExecutor()).execute({ query: "secretSymbol", path: outside }, toolContext),
      /escapes the working directory/
    );
    await assert.rejects(
      () => new CodeSearchTool().execute({ query: "secretSymbol", path: outside }, toolContext),
      /escapes the working directory/
    );
  });
});
