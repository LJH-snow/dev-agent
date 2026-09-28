# Progress — Worker-Scoped MCP

## 2026-09-26

- Confirmed the current gap: collaboration worker contexts and built-in tools
  use task worktrees, while MCP tool closures reuse main-session sessions.
- Wrote the design and implementation plan before changing production code.

- Implemented the Agent Core task tool-lease lifecycle: lease creation follows
  reviewed scope/workspace creation and disposal runs on every worker exit path.
- Implemented CLI MCP scope policy: `disabled` is the default, `shared` emits a
  review warning, and `worker` creates task-worktree-rooted MCP sessions.
- Added focused unit and CLI coverage for task-local roots, environment, session
  disposal, and disabled-scope filtering.
- Fresh verification on September 26, 2026: Agent Core build and suite
  passed 220/220; CLI TypeScript checks, package bundling, and full CLI suite
  passed 705/705; scoped `git diff --check` passed.
- The full repository remains a shared working tree with unrelated concurrent
  changes; no reset, cleanup, commit, or release gate was performed.


## 2026-09-26 — dependency handoff continuation

- Identified and specified the next multi-agent gap: DAG dependencies previously
  ordered tasks but did not transfer verified prerequisite context.
- Added the design and implementation plan for bounded direct dependency
  handoffs in `docs/superpowers/specs/2026-09-26-collaboration-task-handoffs-design.md`
  and `docs/superpowers/plans/2026-09-26-collaboration-task-handoffs.md`.
- Added RED/GREEN Agent Core coverage for direct handoffs, independent-task
  isolation, and bounded summaries; implementation is now in progress.

## 2026-09-28 — closure of the handoff continuation

- The bounded handoff projection landed in
  `packages/agent-core/src/collaboration-execution.ts` (provider-neutral,
  no workspace paths or raw errors, per-handoff and aggregate prompt limits)
  and is injected as the untrusted `DEPENDENCY HANDOFFS` prompt section before
  each downstream worker run. Shipped with the desktop/CLI workbench commit
  `6e607a7` (feat: add agent registry, collaboration MCP, task center, and CI
  diagnosis).
- Task 4 of `docs/superpowers/plans/2026-09-26-collaboration-task-handoffs.md`
  is complete: `docs/architecture.md` (bounded handoff projection, untrusted
  labeling) and `docs/gemini-cli-architecture-alignment.md` (information
  handoff) document the flow boundary.
- Fresh verification on September 28, 2026: agent-core typecheck clean and the
  full agent-core suite passed 222/222 (includes the direct handoff and
  independent-task isolation regression tests); scoped `git diff --check`
  passed with no whitespace errors.
