import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  completeWorkspacePath,
  scanWorkspacePaths,
} from "../dist/path-completion.js";

async function withWorkspace(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-path-completion-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("scans bounded workspace-relative files and directories", async () => {
  await withWorkspace(async (workingDirectory) => {
    await mkdir(join(workingDirectory, "src", "nested"), { recursive: true });
    await mkdir(join(workingDirectory, ".git"), { recursive: true });
    await mkdir(join(workingDirectory, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(workingDirectory, "src", "index.ts"), "export {};\n", "utf8");
    await writeFile(join(workingDirectory, "src", "nested", "utils.ts"), "export {};\n", "utf8");
    await writeFile(join(workingDirectory, ".git", "config"), "ignored", "utf8");
    await writeFile(join(workingDirectory, "node_modules", "pkg", "index.js"), "ignored", "utf8");

    const paths = await scanWorkspacePaths(workingDirectory);
    assert.deepEqual(
      paths.map((item) => item.path),
      ["src/", "src/index.ts", "src/nested/", "src/nested/utils.ts"],
    );
  });
});

test("matches the current @ token and returns workspace-relative suggestions", async () => {
  await withWorkspace(async (workingDirectory) => {
    await mkdir(join(workingDirectory, "src"), { recursive: true });
    await writeFile(join(workingDirectory, "src", "utils.ts"), "export {};\n", "utf8");
    await writeFile(join(workingDirectory, "src", "usage.ts"), "export {};\n", "utf8");

    const value = "inspect @src/ut";
    const result = await completeWorkspacePath(value, value.length, workingDirectory);

    assert.equal(result?.tokenStart, "inspect ".length);
    assert.equal(result?.tokenEnd, value.length);
    assert.equal(result?.token, "@src/ut");
    assert.deepEqual(result?.suggestions.map((item) => item.path), ["src/utils.ts"]);
  });
});

test("keeps replacement bounded to the full token when the caret is inside it", async () => {
  await withWorkspace(async (workingDirectory) => {
    await mkdir(join(workingDirectory, "src"), { recursive: true });
    await writeFile(join(workingDirectory, "src", "utils.ts"), "export {};\n", "utf8");

    const value = "inspect @src/utils.ts now";
    const caret = "inspect @src/u".length;
    const result = await completeWorkspacePath(value, caret, workingDirectory);

    assert.equal(result?.token, "@src/utils.ts");
    assert.equal(result?.tokenEnd, "inspect @src/utils.ts".length);
    assert.deepEqual(result?.suggestions.map((item) => item.path), ["src/utils.ts"]);
  });
});

test("rejects absolute, parent-escaping, and symlink-escaping references", async () => {
  await withWorkspace(async (workingDirectory) => {
    const outside = await mkdtemp(join(tmpdir(), "dev-agent-path-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "secret", "utf8");
      await symlink(outside, join(workingDirectory, "linked"));

      assert.equal(
        await completeWorkspacePath("@/tmp", 4, workingDirectory),
        undefined,
      );
      assert.equal(
        await completeWorkspacePath("@../secret.txt", "@../secret.txt".length, workingDirectory),
        undefined,
      );
      const paths = await scanWorkspacePaths(workingDirectory);
      assert.doesNotMatch(paths.map((item) => item.path).join("\n"), /linked|secret/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
