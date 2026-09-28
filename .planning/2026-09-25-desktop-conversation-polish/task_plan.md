# Desktop conversation polish

Scope: continue the approved Codex-inspired local desktop direction with bounded improvements to existing conversation flows; no backend or provider changes.

- [x] Inspect current flow and reproduce cross-session draft leakage and missing jump control.
- [x] Add executable failing tests for draft isolation/lifecycle, IME submission and reading navigation.
- [x] Implement safe per-tab drafts, composition-aware send and accessible latest-output control.
- [x] Verify real browser desktop/narrow layouts, interactions and deterministic streaming; run desktop suite/typecheck.
- [x] Review only this task's diff; preserve others' staged/unstaged changes and report evidence.

Constraints: no new dependencies; no subagent delegation; do not touch the shared Git index or commit others' work. Screenshots/fixture scripts live outside repo.
