# 2026-09-21 Unified Tool Registry

> **For agentic workers:** implement this plan task-by-task with focused
> RED/GREEN tests and preserve the existing uncommitted worktree.

## Goal

Make `@dev-agent/agent-core` the single owner of the tool contract used by the
Agent Loop and make `@dev-agent/tools` a built-in-tool implementation package.
The tools package keeps its historical `ToolRegistry` export for compatibility,
but delegates registration, metadata normalization, lookup, and schema exposure
to the core registry instead of maintaining a parallel shape.

## Architecture

```text
@dev-agent/agent-core
  AgentTool / ToolExecutionContext / ToolCollection
  AgentToolRegistry
          ▲
          │ compatibility subclass
@dev-agent/tools
  ToolName / Tool / ToolRegistry
  FilesystemTool / ShellTool / GitTool / SearchTool / CodeSearchTool
```

The Agent Loop continues to depend only on the core interfaces. Built-in tools
remain responsible for filesystem, executor, and code-index behavior; they do
not move UI or approval decisions into the tools package.

## Constraints

- Preserve existing tool names, schemas, metadata, execution behavior, and
  package exports.
- Do not add a dependency from `@dev-agent/agent-core` to `@dev-agent/tools`.
- Do not duplicate metadata normalization or registry state.
- Preserve the existing CLI, Desktop, MCP, approval, cancellation, JSON/SSE,
  and non-interactive contracts.
- Do not publish packages, create a tag, push, or make a network release.

## Tasks

### Task 1: Lock the canonical contract

- [x] Add a tools-package test proving its registry is assignable to the
  Agent Loop's `ToolCollection` and exposes the same normalized metadata.
- [x] Keep built-in tools type-compatible with the core execution context.

### Task 2: Delegate the compatibility registry

- [x] Make `@dev-agent/tools` reuse the core `AgentTool` and execution-context
  types.
- [x] Make its `ToolRegistry` delegate to `AgentToolRegistry`, including
  metadata lookup and normalization.
- [x] Preserve the `ToolName` union and existing public import paths.

### Task 3: Verify and document

- [x] Run focused tools/core tests and type checks.
- [x] Run the full TypeScript gate, rich CLI evaluations, and diff checks.
- [x] Update `task_plan.md` and `progress.md` only with verified evidence.

## Acceptance

- There is one runtime registry implementation and one metadata-normalization
  path for core and built-in tools.
- Existing callers importing `ToolRegistry` from `@dev-agent/tools` continue to
  work without changing tool names or behavior.
- The Agent Loop can consume the tools-package registry through its canonical
  `ToolCollection` contract.
- Existing package and user-facing contracts remain green.

## Verification

Completed on 2026-09-21:

- Agent Core full suite: **173/173**.
- Tools full suite: **153/153**.
- CLI full suite: **442/442**.
- Desktop full suite: **144/144**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.
