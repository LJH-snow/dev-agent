# 2026-09-21 Desktop MCP capability parity

> **For agentic workers:** implement this plan task-by-task with focused RED/GREEN
> tests and preserve the existing uncommitted worktree.

## Goal

Bring the Desktop MCP boundary in line with the Gemini CLI architecture study:
one owned MCP session exposes tools, resources, and prompts; capability
metadata is bounded and model-facing; list-change notifications update the
registered capability set without restarting the Desktop session.

## Architecture

`ChatSession` keeps Agent Core and the Desktop transport independent from MCP
process details. `McpServerSession` owns connect/reconnect/close and returns
bounded capability snapshots. Desktop adapts each snapshot into the existing
`AgentToolRegistry`:

```text
McpServerSession
  ├── native MCP tools       -> <prefix>:<tool>
  ├── resources              -> <prefix>:resource
  └── prompts                -> <prefix>:prompt
```

Resource and prompt reads are read-only JSON tools. Their names and descriptions
are added through a shared, sanitized MCP prompt formatter. The formatter is
kept in `@dev-agent/mcp` so CLI and Desktop cannot drift in metadata handling.

## Constraints

- Do not change the Desktop SSE event names or existing MCP tool names.
- Do not expose command lines, environment values, absolute paths, raw errors,
  credentials, or unbounded MCP metadata to the model or status endpoint.
- Preserve the current CLI `mcp` behavior and the existing `McpServerSession`
  reconnect/list-change semantics.
- Do not add a new MCP transport or an MCP SDK dependency.
- Do not publish packages, create a tag, push, or make a network release.

## Tasks

### Task 1: Lock the shared capability prompt and Desktop behavior

- [x] Add package-level tests for empty, resource, prompt, combined, and
  control-sequence/credential sanitization cases.
- [x] Add a Desktop integration fixture exposing a tool, resource, and prompt.
- [x] Add a Desktop e2e test proving:
  - the provider receives the resource/prompt synthetic tools;
  - a model-selected resource read reaches the MCP server;
  - the returned resource content is included in the next model request;
  - bounded metadata is included in the system prompt.
- [x] Run focused tests and confirm the new behavior is GREEN, including
  dynamic `tools/resources/prompts/list_changed` refresh and failed-startup
  capability cleanup regressions.

### Task 2: Share the bounded MCP prompt formatter

- [x] Add `packages/mcp/src/capability-prompt.ts` and export it from the
  package entrypoint.
- [x] Keep `apps/cli/src/mcp-system-prompt.ts` as a compatibility re-export so
  existing CLI imports and tests remain stable.
- [x] Preserve terminal-control and credential redaction behavior.

### Task 3: Make Desktop own the complete MCP session capability set

- [x] Replace Desktop's raw `McpStdioClient[]` ownership with
  `McpServerSession[]`.
- [x] Register native tools plus bounded resource/prompt adapter tools.
- [x] Rebuild the model-facing MCP prompt module after initial connect and
  `tools/resources/prompts/list_changed` notifications.
- [x] Close all owned sessions on shutdown and keep cancellation behavior
  unchanged.
- [x] Remove all synthetic capabilities when startup fails or the Desktop
  session closes, preventing stale tools from targeting closed clients.

### Task 4: Verify and document

- [x] Run focused MCP and Desktop tests, then full workspace TypeScript gates.
- [x] Run rich CLI evaluations and `git diff --check`.
- [x] Update `task_plan.md` and `progress.md` only with verified evidence.

## Acceptance

- [x] Desktop and CLI use the same MCP capability vocabulary and bounded metadata
  formatter.
- [x] A configured Desktop MCP resource or prompt is callable through the Agent
  Loop without manually restarting the session.
- [x] A list-change notification replaces the corresponding capability set instead
  of duplicating stale tools.
- [x] Existing CLI, Desktop, MCP, approval, cancellation, and JSON/SSE contracts
  remain green.

## Verification

Completed on September 22, 2026:

- MCP package suite: **70/70**.
- Desktop suite: **161/161**.
- Dynamic capability refresh: tools, resources, and prompts replace stale
  entries after debounced `list_changed` notifications.
- Failed MCP startup cleanup: **1/1** regression test.
- Retry action contract: **1/1** targeted test.
- `git diff --check`: passed.
