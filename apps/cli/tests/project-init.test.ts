import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeProject } from "../dist/project-init.js";

async function withWorkingDirectory(run: (workingDirectory: string) => Promise<void>): Promise<void> {
  const workingDirectory = await mkdtemp(join(tmpdir(), "dev-agent-project-init-"));
  try {
    await run(workingDirectory);
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function projectPaths(workingDirectory: string) {
  const projectDirectory = join(workingDirectory, ".dev-agent");
  return {
    projectDirectory,
    configPath: join(projectDirectory, "config.json"),
    sessionsDirectory: join(projectDirectory, "sessions"),
    gitignorePath: join(workingDirectory, ".gitignore"),
  };
}

test("initializes project state in an empty working directory", async () => {
  await withWorkingDirectory(async (workingDirectory) => {
    const paths = projectPaths(workingDirectory);

    const result = await initializeProject({ workingDirectory });

    assert.equal(result.dryRun, false);
    assert.deepEqual(result.created, [
      paths.projectDirectory,
      paths.configPath,
      paths.sessionsDirectory,
    ]);
    assert.deepEqual(result.existing, []);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.skipped, [paths.gitignorePath]);
    assert.equal(await readFile(paths.configPath, "utf8"), "{}\n");
    assert.equal((await stat(paths.sessionsDirectory)).isDirectory(), true);
    await assert.rejects(stat(paths.gitignorePath), { code: "ENOENT" });
  });
});

test("is idempotent when run repeatedly", async () => {
  await withWorkingDirectory(async (workingDirectory) => {
    const paths = projectPaths(workingDirectory);

    await initializeProject({ workingDirectory, addGitignore: true });
    const result = await initializeProject({ workingDirectory, addGitignore: true });

    assert.deepEqual(result.created, []);
    assert.deepEqual(result.existing, [
      paths.projectDirectory,
      paths.configPath,
      paths.sessionsDirectory,
      paths.gitignorePath,
    ]);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.skipped, []);
    assert.equal(await readFile(paths.configPath, "utf8"), "{}\n");
    assert.equal(await readFile(paths.gitignorePath, "utf8"), ".dev-agent/\n");
  });
});

test("does not overwrite an existing config file", async () => {
  await withWorkingDirectory(async (workingDirectory) => {
    const paths = projectPaths(workingDirectory);
    const existingConfig = '{"defaultProvider":"ollama","private":"do-not-echo"}\n';

    await mkdir(paths.projectDirectory);
    await writeFile(paths.configPath, existingConfig, "utf8");

    const result = await initializeProject({ workingDirectory });

    assert.equal(await readFile(paths.configPath, "utf8"), existingConfig);
    assert.ok(result.existing.includes(paths.configPath));
    assert.doesNotMatch(JSON.stringify(result), /do-not-echo/);
  });
});

test("adds .dev-agent/ to .gitignore without reordering content and remains idempotent", async () => {
  await withWorkingDirectory(async (workingDirectory) => {
    const paths = projectPaths(workingDirectory);
    const existingGitignore = "node_modules/\n# keep this comment\n";
    await writeFile(paths.gitignorePath, existingGitignore, "utf8");

    const first = await initializeProject({ workingDirectory, addGitignore: true });
    assert.deepEqual(first.changed, [paths.gitignorePath]);
    assert.equal(
      await readFile(paths.gitignorePath, "utf8"),
      `${existingGitignore}.dev-agent/\n`
    );

    const second = await initializeProject({ workingDirectory, addGitignore: true });
    assert.deepEqual(second.changed, []);
    assert.ok(second.existing.includes(paths.gitignorePath));
    assert.equal(
      await readFile(paths.gitignorePath, "utf8"),
      `${existingGitignore}.dev-agent/\n`
    );
  });
});

test("rejects a .gitignore file above the 16 MiB read limit before changing project state", async () => {
  await withWorkingDirectory(async (workingDirectory) => {
    const paths = projectPaths(workingDirectory);
    const existingGitignore = `node_modules/\n${"x".repeat(16 * 1024 * 1024)}\n`;
    await writeFile(paths.gitignorePath, existingGitignore, "utf8");

    await assert.rejects(
      initializeProject({ workingDirectory, addGitignore: true }),
      /16 MiB read limit/
    );
    assert.equal(await readFile(paths.gitignorePath, "utf8"), existingGitignore);
    await assert.rejects(stat(paths.projectDirectory), { code: "ENOENT" });
  });
});

test("dry-run reports planned work without modifying files", async () => {
  await withWorkingDirectory(async (workingDirectory) => {
    const paths = projectPaths(workingDirectory);
    const existingGitignore = "node_modules/\n";
    await writeFile(paths.gitignorePath, existingGitignore, "utf8");

    const result = await initializeProject({
      workingDirectory,
      addGitignore: true,
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.deepEqual(result.created, [
      paths.projectDirectory,
      paths.configPath,
      paths.sessionsDirectory,
    ]);
    assert.deepEqual(result.changed, [paths.gitignorePath]);
    assert.equal(await readFile(paths.gitignorePath, "utf8"), existingGitignore);
    await assert.rejects(stat(paths.projectDirectory), { code: "ENOENT" });
    await assert.rejects(stat(paths.configPath), { code: "ENOENT" });
    await assert.rejects(stat(paths.sessionsDirectory), { code: "ENOENT" });
  });
});

test("rejects a missing or non-directory working directory", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dev-agent-project-init-invalid-"));
  try {
    const missingDirectory = join(parent, "missing");
    await assert.rejects(
      initializeProject({ workingDirectory: missingDirectory }),
      /workingDirectory.*(exist|directory)/i
    );

    const filePath = join(parent, "not-a-directory");
    await writeFile(filePath, "not a directory", "utf8");
    await assert.rejects(
      initializeProject({ workingDirectory: filePath }),
      /workingDirectory.*directory/i
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
