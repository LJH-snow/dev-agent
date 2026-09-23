# 2026-09-21 Shared Approval Policy

> **For agentic workers:** implement this plan task-by-task with focused
> RED/GREEN tests and preserve the existing uncommitted worktree.

## Goal

Make Agent Core the single owner of approval-mode selection while keeping
interactive UI and filesystem change-set preparation at the edges. CLI,
Desktop, and MCP should select the same `allow`, `deny-dangerous`, `ask`, and
`review-writes` behavior without copying policy branching.

## Architecture

```text
CLI question box ───────┐
Desktop requester ──────┼──> Agent Core createApprovalPolicy()
MCP stdio (no requester)┘          │
                                   ├── dangerous rules
                                   ├── ask fallback
                                   └── reviewed-write boundary
```

The factory accepts transport-specific approval and change-set adapters. It
does not read stdin, render UI, start MCP servers, or depend on the built-in
tools package.

## Constraints

- Preserve existing approval decisions, denial reasons, always-allow session
  behavior, reviewed-write preparation, MCP fail-closed behavior, and
  non-interactive contracts.
- Keep `ApprovalPolicy` backward-compatible for direct callers.
- Do not add an Agent Core dependency on CLI, Desktop, or built-in tools.
- Do not weaken workspace containment, symlink, dangerous-command, or
  review-writes checks.
- Do not publish packages, create a tag, push, or make a network release.

## Tasks

### Task 1: Lock the core policy factory

- [x] Add focused tests for all modes, requester delegation, and reviewed
  preparation.
- [x] Keep policy failures fail-closed.

### Task 2: Migrate callers

- [x] Use the factory for CLI interactive and MCP-server policy selection.
- [x] Use the factory for Desktop approval selection.
- [x] Keep UI-specific prompts and session-only decision memory at the edges.

### Task 3: Verify and document

- [x] Run Agent Core, Tools, CLI, and Desktop tests.
- [x] Run the TypeScript gate, rich CLI evaluations, and diff checks.
- [x] Update the execution records only with verified evidence.

## Acceptance

- Approval mode branching exists in one Agent Core factory.
- CLI, Desktop, and MCP retain their existing user-facing behavior.
- The core policy layer remains UI- and tools-package-independent.

## Verification

Completed on 2026-09-21:

- Agent Core full suite: **173/173**.
- Tools full suite: **153/153**.
- CLI full suite: **442/442**.
- Desktop full suite: **144/144**.
- MCP full suite: **69/69**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.
