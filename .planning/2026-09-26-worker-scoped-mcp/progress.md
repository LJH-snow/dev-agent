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
