# Agent Definition Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded Markdown Specialist Agent discovery and expose it through the existing `:team` role path without widening execution authority.

**Architecture:** Add a metadata-and-instructions-only registry in Agent Core, merge its definitions with trusted JSON role configuration at the CLI edge, and keep the existing `resolveSpecialistRoles` tool-ceiling intersection as the authority boundary. Add a small CLI command module for read-only inspection.

**Tech Stack:** TypeScript, Node.js built-in `node:fs/promises`, Node test runner, pnpm workspace, existing Agent Core/Ink CLI.

**Spec:** `docs/superpowers/specs/2026-09-25-agent-definition-registry-design.md`

## Global Constraints

- Do not execute code, hooks, scripts, MCP servers, or network requests from an Agent Markdown definition.
- Project definitions shadow user definitions; malformed or oversized optional definitions are ignored.
- JSON `collaboration.roles` remains backward compatible and wins duplicate IDs.
- Existing approval, tool-scope review, plan-mode, sandbox, worktree, and merge boundaries remain authoritative.
- Preserve unrelated uncommitted Desktop/MCP/Validation and output changes.

### Task 1: Agent Core registry

**Files:**
- Create: `packages/agent-core/src/agents.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/tests/agents.test.ts`

- [x] Write RED tests for project/user precedence, safe parsing, invalid fields, bounds, and missing directories.
- [x] Run the focused Agent Core test and confirm the new tests fail for the expected missing-registry reason.
- [x] Implement `AgentDefinitionRegistry.load/list/get` with bounded front matter parsing and deterministic precedence.
- [x] Run the focused tests and confirm GREEN.

### Task 2: Trusted role merge

**Files:**
- Modify: `apps/cli/src/specialist-roles.ts`
- Test: `apps/cli/tests/specialist-roles.test.ts`

- [x] Write RED tests proving discovered definitions augment defaults and explicit JSON roles shadow duplicate IDs.
- [x] Run the focused test and confirm failure.
- [x] Add a pure merge helper and adapt role resolution to accept discovered definitions.
- [x] Run specialist-role tests and confirm GREEN.

### Task 3: CLI discovery and inspection command

**Files:**
- Create: `apps/cli/src/agent-command.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/tui-renderer.ts`
- Test: `apps/cli/tests/agent-command.test.ts`

- [x] Write RED command tests for list/inspect/usage/unknown and sanitization.
- [x] Implement the read-only command formatter and wire it into rich/plain interactive command handling.
- [x] Load the registry once per interactive session and pass it to specialist role resolution.
- [x] Run focused CLI tests and typecheck.

### Task 4: Documentation and verification

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/gemini-cli-architecture-alignment.md`
- Modify: `docs/README.md` if the documentation index requires it
- Modify: `.planning/2026-09-25-agent-definition-registry/progress.md`
- Modify: `.planning/2026-09-25-agent-definition-registry/findings.md`

- [x] Document the file format, precedence, bounds, and non-executable boundary.
- [x] Run package build/typecheck, focused tests, full CLI tests, `git diff --check`, and the relevant release gate.
- [x] Review the diff to ensure no unrelated files were changed.
