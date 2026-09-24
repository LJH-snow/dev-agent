# Findings — next nine roadmap features

## Baseline

- Current published README roadmap is complete through item 81; `docs/next-roadmap-plans-v62-plus.md` only marks v65 Desktop execution-state UX as deferred and Windows restricted execution as NO-GO.
- The nearest unfinished implementation plan is `.planning/2026-09-23-desktop-codex-workflow/task_plan.md`.
- Existing source already includes `DesktopTaskWorkspaceManager`, `DesktopTaskTerminalManager`, task workspace diff UI, and a loopback-only preview iframe. Therefore the next work must close concrete UX/metadata gaps rather than duplicate those features.

## Existing safety boundaries to preserve

- Desktop API is loopback-only for task terminal routes and uses explicit session/worktree binding.
- Task terminal commands, input, event count, output bytes, run count, and lifetime are bounded.
- Worktree paths are verified Git worktrees; merge and cleanup are guarded against dirty/running state.
- Evidence and runtime trace surfaces are metadata-only.
- Public UI inserts diff/path/output text through `textContent`, not `innerHTML`.

## Open implementation gaps

- Review comments are currently kept in a page-local map and have no explicit serialization/byte contract.
- Terminal polling can receive a cursor-expired snapshot but the UI does not communicate the gap or reset its local buffer intentionally.
- The terminal panel can attach output to a prompt but has no explicit local clear/export state.
- Preview iframe loading has no explicit error/clear control.
- Workspace metadata is refreshed manually and is not automatically reloaded after terminal process completion.
- No Desktop API currently exposes GitHub, Skills, scheduler, or remote monitoring metadata; any addition must be opt-in/read-only and bounded.

## 2026-09-24 — next-nine implementation findings

- Features 1–6 fit the existing local Desktop workbench without adding a new
  authority: comments and terminal presentation state stay session/task-local;
  terminal reconnect rehydrates from the bounded server cursor; preview remains
  loopback-only; workspace refresh is metadata-only.
- Features 7–9 must remain projections rather than integrations. The current
  implementation follows that boundary: GitHub is disabled unless explicitly
  opted in and only reports CLI/auth metadata; skills/jobs omit instructions,
  paths, prompts, and output; monitoring reports safe run/approval metadata and
  exposes no approve/mutate endpoint.
- The current Desktop suite has **222/222** passing tests, including review
  comments, task terminal controls, preview validation, and capability routes.
  No remote mutation, credential return, unrestricted network, or new shell
  surface was added.
