# Worker-Scoped MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure collaboration workers either use worktree-rooted MCP sessions or explicitly use a reviewed shared session, with disabled MCP as the safe default.

**Architecture:** Agent Core exposes a generic per-task tool lease factory after task and role scope intersection. The CLI owns MCP session creation and converts each lease into a task-local tool collection; main interactive MCP sessions remain unchanged. A collaboration policy selects disabled, shared, or worker scope before role binding and task review.

**Tech Stack:** TypeScript, Node.js, `@dev-agent/agent-core`, `@dev-agent/mcp`, Node test runner, existing CLI configuration and collaboration worktree provider.

**Spec:** `docs/superpowers/specs/2026-09-26-worker-scoped-mcp-design.md`

## Global Constraints

- Default `collaboration.mcpScope` is `disabled`.
- Worker mode must never fall back to a main-session MCP client.
- Existing role tool ceilings, reviewed task scopes, approvals, and sandbox profiles remain authoritative.
- Do not modify unrelated concurrent Desktop, marketplace, security, or agent-registry changes.
- Follow TDD: each production change starts with a failing test.

---

### Task 1: Add the generic Agent Core task-tool lease lifecycle

**Files:**
- Modify: `packages/agent-core/src/collaboration-execution.ts`
- Test: `packages/agent-core/tests/collaboration-execution.test.ts`

**Interfaces:**
- Add `CollaborationTaskToolLease` with `tools: ToolCollection` and optional `dispose()`.
- Add `createTaskToolLease(task, taskIndex, workspace, scopedTools, signal)` to `CollaborativeExecutionOptions`.
- Agent Core invokes the factory only after task/role scope intersection and disposes the lease on every attempt path.

- [ ] Write a failing test proving a lease receives the task workspace and reviewed tool subset.
- [ ] Run the focused Agent Core test and confirm it fails because the factory interface is absent.
- [ ] Add the lease interface and invoke it around the worker AgentLoop.
- [ ] Add failing cancellation and retry tests proving disposal occurs exactly once per attempt.
- [ ] Implement `finally`-based disposal and preserve existing failure/cancellation results.
- [ ] Run the focused collaboration execution tests.

### Task 2: Add collaboration MCP scope configuration and safe filtering

**Files:**
- Modify: `apps/cli/src/config.ts`
- Modify: `apps/cli/src/config-validation.ts`
- Modify: `apps/cli/src/index.ts`
- Test: `apps/cli/tests/config-validation.test.ts`
- Test: `apps/cli/tests/collaboration-cli.test.ts`

**Interfaces:**
- Add `collaboration.mcpScope?: "disabled" | "shared" | "worker"`.
- Add a CLI helper that identifies configured main-session MCP tool prefixes and creates a filtered collaboration tool view.
- Disabled mode removes MCP tools from role binding and task scope review without removing them from the main session.
- Shared mode keeps current tools and supplies a bounded review warning.

- [ ] Write failing validation and disabled-mode tests.
- [ ] Run focused tests and verify the new field and filtering behavior fail.
- [ ] Implement bounded config validation and policy resolution.
- [ ] Update role binding and available tool names to use the effective collaboration collection.
- [ ] Add the shared-mode warning to the existing task scope review copy.
- [ ] Run config and collaboration focused tests.

### Task 3: Implement worktree-rooted MCP task leases

**Files:**
- Create: `apps/cli/src/collaboration-mcp.ts`
- Modify: `apps/cli/src/index.ts`
- Test: `apps/cli/tests/collaboration-mcp.test.ts`
- Test: `apps/cli/tests/collaboration-cli.test.ts`

**Interfaces:**
- Create `createWorkerMcpTaskToolLeaseFactory(options)` returning the Agent Core lease factory.
- The factory starts MCP sessions with `rootDirectory: workspace.path`, task-scoped session id, and bounded environment.
- It returns only names in the already-reviewed MCP subset and closes every session in `dispose()`.

- [ ] Write a fake stdio MCP server test that records its root and environment.
- [ ] Run it and verify the test fails because the worker lease does not exist.
- [ ] Implement the task-local MCP session factory using existing `McpServerSession` and registration semantics.
- [ ] Add tests for no shared-client reuse, cancellation cleanup, and missing allowed MCP names.
- [ ] Wire worker mode into `createCollaborativeExecution`.
- [ ] Run MCP package, worker lease, and collaboration integration tests.

### Task 4: Document and verify the trust boundary

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/gemini-cli-architecture-alignment.md`
- Modify: `.planning/2026-09-26-worker-scoped-mcp/progress.md`
- Create: `.planning/2026-09-26-worker-scoped-mcp/findings.md`

- [ ] Document all three modes, the default, and the shared-mode warning.
- [ ] Add architecture notes explaining why MCP session scope differs from
      Agent Loop working-directory scope.
- [ ] Run package tests, CLI tests, TypeScript verification, documentation
      contracts, and scoped `git diff --check`.
- [ ] Record exact evidence and limitations; do not claim Rust/integration
      gates unless they are run.
