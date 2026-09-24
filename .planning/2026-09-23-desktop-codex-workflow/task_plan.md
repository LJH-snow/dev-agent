# Desktop workflow parity implementation plan

## Goal
Implement the full user-requested Desktop workflow improvement: task-scoped Git worktrees with visible task status and paths; inspect/compare/merge/clean task changes; unified Git diff review; integrated terminal and browser preview; GitHub PR/CI workflow; first-class skills/plugins, automation, and remote operation. Preserve existing approval, validation, evidence, and bounded-input contracts. Work additively because the shared worktree has extensive unrelated uncommitted changes.

## Phases
- [x] Phase 1 — Task-scoped worktree lifecycle: create/assign a linked worktree to a Desktop session, persist the assignment, list status/path/branch/diff summary, and support guarded compare/merge/cleanup.
- [ ] Phase 2 — Unified Git review: changed-file list, full diff, staged/unstaged distinction, bounded diff output, file navigation, and line-anchored review comments forwarded into the task prompt.
- [ ] Phase 3 — Integrated task terminal and local browser preview with process lifecycle, output bounds, and cleanup.
- [ ] Phase 4 — GitHub PR/CI workflow with explicit authentication boundaries and review/merge protections.
- [ ] Phase 5 — Desktop Skills/plugin management, scheduled automation, and remote task monitoring/approval.
- [ ] Final audit — Verify each phase against source and tests, run Desktop and repository verification gates, and update documentation.

## Current execution slice
Finish Phase 2 browser validation for the current per-task diff grouping, file navigation, and line comments. Then begin Phase 3 by adding a session-bound local terminal/process lifecycle and loopback browser preview; inspect existing source before adding any feature. Phases 4–5 remain active, and the goal is not complete until the final audit is verified.
