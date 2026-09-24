# Next nine roadmap features — Desktop workflow continuation

## Objective

Continue the nearest incomplete roadmap slice after the completed core roadmap: finish nine bounded Desktop workflow capabilities from the existing Codex-style workbench direction, without weakening approval, sandbox, session, evidence, input, or release contracts.

## Selection basis

The published roadmap through item 81 is complete. The nearest unfinished implementation plan is `.planning/2026-09-23-desktop-codex-workflow/task_plan.md`; its existing tree already contains task worktrees, diff review, and a bounded task terminal. The nine features below complete the next actionable product surface while preserving the current local-only model.

## Nine features

1. **Review-comment durability and bounded insertion** — keep per-task review comments isolated across session changes, cap count/bytes, and insert a deterministic prompt block.
2. **Diff review keyboard/file navigation** — make group tabs and file rows keyboard-addressable and expose selected-file state without HTML injection.
3. **Terminal reconnect/gap handling** — detect expired output cursors and rehydrate a bounded snapshot instead of silently losing output.
4. **Terminal output export/clear** — add bounded, redacted copy/export and clear only the local presentation buffer.
5. **Preview health and lifecycle affordance** — validate loopback preview URLs, show loading/error/loaded states, and provide explicit stop/clear semantics without broadening network access.
6. **Task workspace status refresh** — refresh workspace metadata after terminal completion and keep stale task state visible as metadata only.
7. **GitHub capability boundary** — add a metadata-only, explicit opt-in capability probe with no token or command output exposure.
8. **Automation/skills metadata surface** — expose bounded local metadata for available skills and scheduled jobs without executing or mutating them.
9. **Remote approval/monitoring boundary** — add a read-only local status snapshot contract for pending runs/approvals, explicitly rejecting mutation from this surface.

## Phases

- [ ] Phase 0 — establish plan, baseline, and source inventory.
- [ ] Phase 1 — implement features 1–4 (review and terminal).
- [ ] Phase 2 — implement features 5–6 (preview and workspace refresh).
- [ ] Phase 3 — implement features 7–9 as fail-closed metadata-only contracts.
- [ ] Phase 4 — focused tests, browser/PTY evidence, full verification, and docs.

## Constraints

- Preserve all existing dirty/untracked work; never reset, clean, checkout, or broad-format.
- No new unrestricted shell, network, credential, MCP, or filesystem capability.
- New GitHub/skills/automation/remote surfaces are metadata-only and fail closed; no secret values, raw command output, or remote mutation.
- Keep all inputs, outputs, comments, paths, URLs, and snapshots bounded and sanitized.
- Use RED-to-GREEN tests for each behavior change and update the progress ledger after each phase.

## Closure update — 2026-09-24

The nine-feature slice is implemented in the current worktree and verified
without widening the existing local-only safety model.

- [x] Phase 0 — plan, baseline, and source inventory.
- [x] Phase 1 — bounded review comments, diff navigation, terminal reconnect,
      and terminal clear/export.
- [x] Phase 2 — loopback preview lifecycle and post-terminal workspace refresh.
- [x] Phase 3 — metadata-only GitHub, skills/jobs, and monitoring surfaces.
- [x] Phase 4 — focused tests, workspace tests, release gate, docs, and diff
      checks.

Closure evidence on 2026-09-24: Desktop **222/222**; full TypeScript release
 gate passed with CLI **629/629**, documentation **60/60**, native Desktop
 contracts **2/2**, and CLI package smoke. No remote mutation or package
 release was performed.
