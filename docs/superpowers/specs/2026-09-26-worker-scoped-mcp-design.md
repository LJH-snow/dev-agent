# Worker-Scoped MCP Design

**Date:** 2026-09-26
**Status:** approved for implementation in the active continuation

## Goal

Make MCP tool execution honest about collaboration worktree isolation. A
worker must either use an MCP session rooted in its own task workspace or be
explicitly told that it is using a shared main-session MCP session; it must
never inherit a shared client while appearing worktree-isolated.

## Problem

The CLI currently starts MCP sessions once for the main session with the main
working directory. Collaboration workers receive an isolated Git worktree and
an Agent Core context rooted there, but their MCP tool closures still call the
main-session `McpServerSession`. MCP roots and environment variables therefore
can point at the source checkout even when the worker's built-in tools point at
the task worktree.

## Design

Add `collaboration.mcpScope` with three values:

- `disabled` (default): collaboration workers do not receive MCP tools. The
  normal interactive session keeps its configured MCP tools.
- `shared`: workers may use the main-session MCP tools, but the collaboration
  review explicitly labels them as shared and not worktree-rooted.
- `worker`: each task attempt gets MCP sessions rooted at its task workspace.

The policy is applied only to collaboration execution; it does not change
ordinary prompts, `--tools`, MCP management commands, or `--mcp-server` mode.

Agent Core gains a task-tool lease factory. After the reviewed task scope and
role binding have been intersected, the application may replace that task's
MCP tool implementations with a scoped `ToolCollection` and an async disposer.
The lease is created after the workspace exists and is disposed on success,
failure, retry, cancellation, or setup error. Agent Core remains unaware of
MCP and never grants tools; it only enforces the already-reviewed names.

The CLI worker lease creates one `McpServerSession` per configured server for
the task attempt, using the worktree path as `rootDirectory` and bounded task
session environment. It exposes only the MCP names already present in the
reviewed task collection. The lease never falls back to the main session.

The shared mode retains compatibility for users who explicitly request it and
adds a review warning. The default disabled mode is fail-closed for new
collaboration runs while preserving ordinary MCP behavior.

## Invariants

- A worker-scoped MCP root is exactly the current task workspace path.
- Main-session MCP sessions are never passed into worker-scoped leases.
- MCP child processes are closed at every task-attempt terminal path.
- Cancellation aborts the worker lease and closes all MCP children.
- The task scope review and role tool ceiling remain the authority for the
  names exposed to a worker.
- MCP server annotations cannot lower the existing dangerous-tool approval.
- Planner output cannot select `mcpScope`, MCP server configuration, or tool
  grants.
- Shared mode is visible in the review; no UI claims it is isolated.

## Non-goals

- No remote MCP installation or marketplace behavior.
- No change to ordinary interactive MCP sessions.
- No per-tool MCP permission language beyond the existing task scope review.
- No automatic fallback from worker mode to shared mode.
- No change to Rust sandbox semantics for built-in tools.
