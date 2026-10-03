import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ExtensionRegistry } from "../dist/index.js";

async function writeManifest(
  root: string,
  directoryName: string,
  manifest: unknown,
): Promise<void> {
  const directory = join(root, directoryName);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "extension.json"), JSON.stringify(manifest), "utf8");
}

test("loads project and user extensions with project precedence and stable surfaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-extensions-"));
  const userDirectory = join(directory, "user-extensions");
  try {
    const projectExtensions = join(directory, ".dev-agent", "extensions");
    await writeManifest(projectExtensions, "shared", {
      id: "shared",
      name: "Project Shared",
      version: "2.0.0",
      description: "Project extension",
      tools: ["read_file"],
      commands: [":review", ":check"],
      skills: ["review"],
      mcpServers: ["docs"],
      config: ["review.strict"],
      resources: ["templates/review.md"],
    });
    await writeManifest(userDirectory, "shared", {
      id: "shared",
      name: "User Shared",
      version: "1.0.0",
      tools: ["old_tool"],
    });
    await writeManifest(userDirectory, "user-only", {
      id: "user-only",
      description: "User extension",
      commands: [":hello"],
    });

    const registry = await ExtensionRegistry.load({
      workingDirectory: directory,
      userExtensionsDirectory: userDirectory,
    });

    assert.deepEqual(
      registry.list().map((extension) => extension.id),
      ["shared", "user-only"],
    );
    assert.deepEqual(registry.get("shared"), {
      id: "shared",
      name: "Project Shared",
      version: "2.0.0",
      description: "Project extension",
      scope: "project",
      surfaces: {
        tools: 1,
        commands: 2,
        skills: 1,
        mcpServers: 1,
        configKeys: 1,
        resources: 1,
      },
    });
    assert.equal(registry.get("user-only")?.scope, "user");
    assert.equal("path" in (registry.get("shared") ?? {}), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ignores malformed, unsupported, and oversized manifests without failing discovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-extensions-invalid-"));
  try {
    const extensions = join(directory, ".dev-agent", "extensions");
    await writeManifest(extensions, "valid-z", {
      id: "valid-z",
      name: "Zed",
      commands: [":zed", ":zed"],
    });
    await writeManifest(extensions, "valid-a", {
      id: "valid-a",
      name: "Alpha",
    });
    await writeManifest(extensions, "bad-id", {
      id: "not valid",
      name: "Bad",
    });
    await writeManifest(extensions, "bad-type", {
      id: "bad-type",
      commands: "not-an-array",
    });
    await writeManifest(extensions, "unknown-field", {
      id: "unknown-field",
      unexpected: true,
    });
    await writeManifest(extensions, "too-large", {
      id: "too-large",
      description: "this manifest should be ignored",
    });
    await writeFile(
      join(extensions, "too-large", "extension.json"),
      JSON.stringify({ id: "too-large", description: "x".repeat(4096) }),
      "utf8",
    );

    const registry = await ExtensionRegistry.load({
      workingDirectory: directory,
      maxManifestBytes: 128,
    });

    assert.deepEqual(
      registry.list().map((extension) => extension.id),
      ["valid-a", "valid-z"],
    );
    assert.equal(registry.get("valid-z")?.surfaces.commands, 1);
    assert.equal(registry.get("missing"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing extension directories produce an empty registry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-extensions-empty-"));
  try {
    const registry = await ExtensionRegistry.load({
      workingDirectory: directory,
      userExtensionsDirectory: join(directory, "does-not-exist"),
    });
    assert.deepEqual(registry.list(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
