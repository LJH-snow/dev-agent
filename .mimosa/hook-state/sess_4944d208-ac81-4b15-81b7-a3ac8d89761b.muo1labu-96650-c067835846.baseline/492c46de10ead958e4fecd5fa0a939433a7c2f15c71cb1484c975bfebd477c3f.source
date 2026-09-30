import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { ProjectContextManager, detectProjectContext } from "../dist/project-context.js";

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-project-context-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("loads user, project-root, and nested AGENTS.md in precedence and scope order", async () => {
  await withWorkspace(async (root) => {
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "apps", "web"), { recursive: true });
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
    const userInstructionsPath = join(root, "user", "AGENTS.md");
    await mkdir(join(root, "user"), { recursive: true });
    await writeFile(userInstructionsPath, "User defaults", "utf8");
    await writeFile(join(root, "AGENTS.md"), "Project rules", "utf8");
    await writeFile(join(root, "apps", "AGENTS.md"), "App rules", "utf8");
    await writeFile(join(root, "apps", "web", "AGENTS.md"), "Web rules", "utf8");
    await writeFile(join(root, "README.md"), "README is not an instruction", "utf8");
    await writeFile(join(root, "node_modules", "ignored", "AGENTS.md"), "Do not load", "utf8");

    const manager = new ProjectContextManager({ workingDirectory: join(root, "apps", "web"), userInstructionsPath });
    const snapshot = await manager.refresh();
    assert.deepEqual(snapshot.instructions.map((item) => item.displayPath), [
      userInstructionsPath,
      "AGENTS.md",
      "apps/AGENTS.md",
      "apps/web/AGENTS.md",
    ]);
    assert.deepEqual(snapshot.instructions.map((item) => item.scope), [
      "user",
      "project",
      "directory",
      "directory",
    ]);

    const prompt = manager.promptModules().map((item) => item.content).join("\n");
    assert.match(prompt, /User defaults/);
    assert.match(prompt, /Project rules/);
    assert.match(prompt, /App rules/);
    assert.match(prompt, /Web rules/);
    assert.match(prompt, /more specific child-directory AGENTS\.md takes precedence/);
    assert.doesNotMatch(prompt, /README is not an instruction|Do not load/);
  });
});

test("reports stale, new, and missing instruction files until explicitly refreshed", async () => {
  await withWorkspace(async (root) => {
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "src"), { recursive: true });
    const rootInstruction = join(root, "AGENTS.md");
    await writeFile(rootInstruction, "old rules", "utf8");
    const manager = new ProjectContextManager({ workingDirectory: root });
    await manager.refresh();

    await writeFile(rootInstruction, "new and longer rules", "utf8");
    await writeFile(join(root, "src", "AGENTS.md"), "new nested rules", "utf8");
    let statuses = await manager.instructionStatuses();
    assert.equal(statuses.find((item) => item.path === rootInstruction)?.freshness, "stale");
    assert.equal(statuses.find((item) => item.displayPath === "src/AGENTS.md")?.freshness, "new");

    await manager.refresh();
    statuses = await manager.instructionStatuses();
    assert.equal(statuses.length, 2);
    assert.ok(statuses.every((item) => item.freshness === "fresh"));

    await rm(rootInstruction);
    statuses = await manager.instructionStatuses();
    assert.equal(statuses.find((item) => item.path === rootInstruction)?.freshness, "missing");
  });
});

test("detects active project stack and safe package metadata from the project root", async () => {
  await withWorkspace(async (root) => {
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "sample-app",
      packageManager: "pnpm@12.3.4",
      dependencies: { next: "1", react: "1" },
      scripts: { test: "secret command contents", build: "secret" },
    }), "utf8");
    await writeFile(join(root, "pnpm-lock.yaml"), "", "utf8");
    const detected = await detectProjectContext(join(root, "src"));
    assert.equal(detected.root, root);
    assert.equal(detected.name, "sample-app");
    assert.deepEqual(detected.languages, ["JavaScript/TypeScript"]);
    assert.deepEqual(detected.frameworks, ["Next.js", "React"]);
    assert.equal(detected.packageManager, "pnpm");
    assert.deepEqual(detected.scripts, ["build", "test"]);

    const manager = new ProjectContextManager({ workingDirectory: join(root, "src") });
    await manager.refresh();
    const prompt = manager.promptModules().map((item) => item.content).join("\n");
    assert.match(prompt, /Active project root:/);
    assert.match(prompt, /Next\.js, React/);
    assert.doesNotMatch(prompt, /secret command contents|"secret"/);
  });
});

test("instruction discovery does not follow symlinked directories or instruction files", async (t) => {
  await withWorkspace(async (root) => {
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await mkdir(join(workspace, ".git"), { recursive: true });
    await mkdir(join(workspace, "actual"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await mkdir(join(workspace, "linked-file"), { recursive: true });
    await writeFile(join(workspace, "actual", "AGENTS.md"), "inside", "utf8");
    await writeFile(join(outside, "AGENTS.md"), "outside", "utf8");
    try {
      await symlink(outside, join(workspace, "linked-dir"), "dir");
      await symlink(join(outside, "AGENTS.md"), join(workspace, "linked-file", "AGENTS.md"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("symlinks are unavailable on this platform");
        return;
      }
      throw error;
    }
    const manager = new ProjectContextManager({ workingDirectory: workspace });
    const snapshot = await manager.refresh();
    assert.deepEqual(snapshot.instructions.map((item) => item.displayPath), ["actual/AGENTS.md"]);
  });
});
