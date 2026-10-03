import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentDefinitionRegistry } from "../dist/index.js";

async function writeAgent(
  root: string,
  id: string,
  content: string,
): Promise<void> {
  const directory = join(root, id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "AGENT.md"), content, "utf8");
}

test("loads project and user agents with project precedence and bounded role metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-agents-"));
  const user = join(root, "user-agents");
  try {
    const project = join(root, ".dev-agent", "agents");
    await writeAgent(user, "reviewer", `---
name: reviewer
description: User reviewer
provider: openai
model: gpt-4.1-mini
toolAllowlist: search, filesystem
maxTurns: 2
maxTokens: 8000
---
User instructions\n`);
    await writeAgent(project, "reviewer", `---
name: reviewer
description: Project reviewer
---
Project instructions\n`);
    await writeAgent(user, "architect", "# Architect\nInspect the repository before making a plan.\n");

    const registry = await AgentDefinitionRegistry.load({
      workingDirectory: root,
      userAgentsDirectory: user,
    });

    assert.deepEqual(registry.list().map((agent) => agent.id), ["architect", "reviewer"]);
    assert.deepEqual(registry.get("reviewer"), {
      id: "reviewer",
      description: "Project reviewer",
      instructions: "Project instructions",
      scope: "project",
      path: join(project, "reviewer", "AGENT.md"),
    });
    assert.equal(registry.get("architect")?.description, "Architect");
    assert.equal(registry.get("architect")?.scope, "user");
    assert.equal("path" in (registry.get("reviewer") ?? {}), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parses optional role fields and rejects malformed or unsupported definitions", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-agents-invalid-"));
  try {
    const agents = join(root, ".dev-agent", "agents");
    await writeAgent(agents, "valid", `---
name: valid
description: Valid agent
provider: anthropic
model: claude-sonnet-4.5
# comment is not a supported front matter field
toolAllowlist: [search, filesystem]
maxTurns: 3
maxDurationMs: 1200
maxOutputChars: 4000
---
Use evidence.\n`);
    await writeAgent(agents, "unknown-field", `---
name: unknown-field
unexpected: no
---
ignored\n`);
    await writeAgent(agents, "duplicate-tools", `---
name: duplicate-tools
toolAllowlist: search, search
---
ignored\n`);
    await writeAgent(agents, "bad-budget", `---
name: bad-budget
maxTurns: nope
---
ignored\n`);
    await writeAgent(agents, "empty", "---\nname: empty\n---\n");

    const registry = await AgentDefinitionRegistry.load({ workingDirectory: root });
    assert.deepEqual(registry.list().map((agent) => agent.id), ["valid"]);
    assert.deepEqual(registry.get("valid"), {
      id: "valid",
      description: "Valid agent",
      instructions: "Use evidence.",
      scope: "project",
      path: join(agents, "valid", "AGENT.md"),
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      toolAllowlist: ["search", "filesystem"],
      budget: {
        maxTurns: 3,
        maxDurationMs: 1200,
        maxOutputChars: 4000,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores oversized definitions and returns an empty registry for missing directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-agents-bounds-"));
  try {
    const agents = join(root, ".dev-agent", "agents");
    await writeAgent(agents, "too-large", `---\nname: too-large\n---\n${"x".repeat(200)}\n`);
    const bounded = await AgentDefinitionRegistry.load({
      workingDirectory: root,
      maxFileBytes: 128,
    });
    assert.deepEqual(bounded.list(), []);

    const missing = await AgentDefinitionRegistry.load({
      workingDirectory: join(root, "missing"),
      userAgentsDirectory: join(root, "also-missing"),
    });
    assert.deepEqual(missing.list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unterminated front matter and keeps an explicit no-tools role", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-agents-malformed-"));
  try {
    const agents = join(root, ".dev-agent", "agents");
    await writeAgent(agents, "unterminated", "---\nname: unterminated\nWithout a closing delimiter\n");
    await writeAgent(agents, "no-tools", "---\nname: no-tools\ntoolAllowlist: []\n---\nMake a plan without tools.\n");
    const registry = await AgentDefinitionRegistry.load({
      workingDirectory: root,
      userAgentsDirectory: join(root, "user-agents"),
    });
    assert.deepEqual(registry.list().map((agent) => agent.id), ["no-tools"]);
    assert.deepEqual(registry.get("no-tools")?.toolAllowlist, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("truncates optional agent instructions at the configured limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-agents-instructions-"));
  try {
    await writeAgent(join(root, ".dev-agent", "agents"), "short", "# Title\nabcdefghijk\n");
    const registry = await AgentDefinitionRegistry.load({
      workingDirectory: root,
      userAgentsDirectory: join(root, "user-agents"),
      maxInstructionChars: 8,
    });
    assert.equal(registry.get("short")?.instructions, "# Title\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores optional agent selectors unavailable to the active runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-agents-capabilities-"));
  const user = join(root, "user-agents");
  try {
    const project = join(root, ".dev-agent", "agents");
    await writeAgent(user, "reviewer", "---\nname: reviewer\nprovider: openai\ntoolAllowlist: filesystem\n---\nReview carefully.\n");
    await writeAgent(project, "reviewer", "---\nname: reviewer\nprovider: missing-provider\n---\nInvalid override.\n");
    await writeAgent(project, "broken-tool", "---\nname: broken-tool\ntoolAllowlist: unavailable-tool\n---\nDo not load.\n");
    await writeAgent(project, "valid", "---\nname: valid\ntoolAllowlist: []\n---\nPlan without tools.\n");
    const registry = await AgentDefinitionRegistry.load({
      workingDirectory: root,
      userAgentsDirectory: user,
      supportedProviders: ["openai", "ollama"],
      availableTools: ["filesystem", "search"],
    });
    assert.deepEqual(registry.list().map((agent) => agent.id), ["reviewer", "valid"]);
    assert.equal(registry.get("reviewer")?.scope, "user");
    assert.deepEqual(registry.get("valid")?.toolAllowlist, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
