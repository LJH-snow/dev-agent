import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SkillRegistry } from "../dist/index.js";

test("loads project skills before user skills and activates bounded instructions on demand", async () => {
  const root = await mkdtemp(join(homedir(), ".dev-agent-skill-test-"));
  const project = join(root, "project");
  const user = join(root, "user");
  try {
    await mkdir(join(project, ".dev-agent", "skills", "review"), { recursive: true });
    await mkdir(join(user, "review"), { recursive: true });
    await mkdir(join(project, ".dev-agent", "skills", "large"), { recursive: true });
    await writeFile(
      join(project, ".dev-agent", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Project review guidance\n---\n# Project review\nUse the project rules.",
    );
    await writeFile(
      join(user, "review", "SKILL.md"),
      "---\nname: review\ndescription: User review guidance\n---\nUser instructions must not win.",
    );
    await writeFile(
      join(project, ".dev-agent", "skills", "large", "SKILL.md"),
      "---\nname: large\ndescription: Bounded skill\n---\n" + "x".repeat(200),
    );

    const registry = await SkillRegistry.load({
      workingDirectory: project,
      userSkillsDirectory: user,
      maxInstructionChars: 64,
    });

    assert.deepEqual(registry.list().map((skill) => skill.name), ["large", "review"]);
    assert.equal(registry.get("review")?.description, "Project review guidance");
    assert.match(registry.activate("review"), /Use the project rules/);
    assert.equal(registry.activate("large").length <= 64, true);
    assert.throws(() => registry.activate("missing"), /unknown skill/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
