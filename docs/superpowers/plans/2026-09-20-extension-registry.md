# Extension Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, metadata-first Extension Registry that discovers project and user extensions and exposes deterministic inspection commands in both CLI renderers.

**Architecture:** Extensions are directories containing a bounded `extension.json` manifest. Agent Core owns discovery, validation, precedence, and stable metadata; CLI owns presentation and never executes manifest-declared commands or MCP servers during discovery. Project extensions shadow user extensions with the same id, matching the existing SkillRegistry precedence rule.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Agent Core package, CLI command adapters, Ink/ANSI shared command hints, Node test runner.

**Spec:** `docs/geminicli/gemini-cli-coding-agent-architecture-study.md`, section 26 “Extensions”.

## Global Constraints

- Read only `.dev-agent/extensions` in the selected project and `~/.dev-agent/extensions` for user extensions unless an explicit test directory is injected.
- Read no manifest larger than `128 KiB`; ignore malformed, unreadable, non-directory, or oversized entries without preventing startup.
- Accept only bounded metadata fields; never return raw manifest JSON, absolute paths, environment values, command arguments, or MCP configuration in human CLI output.
- Discovery is metadata-only: it must not execute commands, load JavaScript modules, connect to MCP, or change tool policy.
- Project scope shadows user scope by extension id.
- Keep the existing CLI JSON, non-interactive, MCP, approval, and session behavior unchanged.
- Do not publish packages, create tags, or perform network release operations.

---

### Task 1: Define and test the core extension manifest contract

**Files:**
- Create: `packages/agent-core/src/extensions.ts`
- Create: `packages/agent-core/tests/extensions.test.ts`
- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**
- Produces `ExtensionRegistry`, `ExtensionDefinition`, `ExtensionScope`, and `ExtensionSurfaceSummary`.
- `ExtensionRegistry.load({ workingDirectory, userExtensionsDirectory?, maxManifestBytes? })` returns a registry.
- `ExtensionRegistry.list()` returns sorted immutable definitions.
- `ExtensionRegistry.get(id)` returns one definition or `undefined`.

- [x] **Step 1: Write the failing tests**

Cover these concrete behaviors:

```ts
test("loads bounded project and user manifests with project precedence", async () => {
  const registry = await ExtensionRegistry.load({ workingDirectory });
  assert.deepEqual(registry.list().map((item) => item.id), ["shared", "user-only"]);
  assert.equal(registry.get("shared")?.scope, "project");
  assert.deepEqual(registry.get("shared")?.surfaces, {
    tools: 1,
    commands: 2,
    skills: 1,
    mcpServers: 1,
    configKeys: 1,
    resources: 1,
  });
});
```

Also test malformed ids, unknown field values, oversized manifests, missing
directories, stable ordering, duplicate list entries, and that `list()` does
not expose the manifest path.

- [x] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter @dev-agent/agent-core exec tsc -p tsconfig.test.json
node --test --test-concurrency=1 packages/agent-core/tests-dist/extensions.test.js
```

Expected: compile or runtime failure because `extensions.ts` and the exported
registry do not exist yet.

- [x] **Step 3: Implement the minimal bounded registry**

Use `readdir`, `stat`, and `readFile` with the fixed 128 KiB manifest limit.
Parse only a plain JSON object with these fields:

```ts
{
  id: string;
  name?: string;
  version?: string;
  description?: string;
  tools?: string[];
  commands?: string[];
  skills?: string[];
  mcpServers?: string[];
  config?: string[];
  resources?: string[];
}
```

Normalize missing arrays to empty arrays, reject blank or invalid ids, trim
and deduplicate all names, and return only bounded metadata. Preserve the
internal source scope but do not expose filesystem paths in the public
definition.

- [x] **Step 4: Run the focused test to verify it passes**

Run the same focused commands and expect all extension tests to pass.

- [x] **Step 5: Export the new core API and run the core suite**

Run:

```bash
pnpm --filter @dev-agent/agent-core build
pnpm --filter @dev-agent/agent-core test
```

Expected: the existing core tests and the new extension tests pass.

### Task 2: Add explicit CLI inspection commands

**Files:**
- Create: `apps/cli/src/extension-command.ts`
- Create: `apps/cli/tests/extension-command.test.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/tui-renderer.ts`

**Interfaces:**
- `executeExtensionCommand(command, registry)` handles `:extensions`,
  `:extension <id>`, and slash aliases.
- `formatExtensionCommandResult(result)` returns bounded human-readable text.
- `:extensions` lists names, versions, scope, and surface counts.
- `:extension <id>` inspects one extension without printing its path or raw
  manifest.

- [x] **Step 1: Write the failing command tests**

Test list, inspect, unknown extension, usage, slash aliases, and the invariant
that command output contains neither an absolute path nor manifest command
arguments.

- [x] **Step 2: Run the focused command test to verify it fails**

Run:

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json
node --test --test-concurrency=1 apps/cli/tests-dist/extension-command.test.js
```

Expected: the module and command functions are missing.

- [x] **Step 3: Implement the command adapter**

Keep command parsing separate from Agent Core. Normalize `/extensions` and
`/extension` to the existing colon command convention, use stable summaries,
and return a bounded usage/error message for blank or unknown ids.

- [x] **Step 4: Wire both ANSI and Ink command paths**

Load one `ExtensionRegistry` during interactive CLI setup, pass it through
`InteractiveUiOptions`, handle the command before model prompts, and add
`:extensions` and `:extension <id>` to `DEFAULT_COMMAND_HINTS`. A command
notice must not enter conversation history or the provider.

- [x] **Step 5: Run focused CLI tests**

Run the command test and the existing renderer/interactive tests. Expected:
all pass with no changes to queued prompt ownership or composer behavior.

### Task 3: Document the extension boundary and verify the workspace

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/README.md`
- Modify: `task_plan.md`
- Modify: `progress.md`

- [x] **Step 1: Document the manifest shape and safety boundary**

Describe `.dev-agent/extensions/<id>/extension.json`, user extension
precedence, the supported metadata fields, the two interactive commands, and
the fact that discovery is metadata-only.

- [x] **Step 2: Add a Phase 13 checklist and verification record**

Record the core/CLI focused tests, full CLI suite, behavior evaluations,
TypeScript gate, and `git diff --check`. Use the applicable date
`2026-09-20`.

- [x] **Step 3: Run the complete gates**

Run:

```bash
pnpm --filter @dev-agent/agent-core test
pnpm --filter @agent_cli/cli test
pnpm test:evals
pnpm verify:typescript
git diff --check
```

Expected: all existing and new tests pass; no package is published.
