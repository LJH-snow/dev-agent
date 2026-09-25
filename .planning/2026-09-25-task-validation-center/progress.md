# Progress

## 2026-09-25

- Started the Desktop Task Validation Center slice.
- Preserved the existing uncommitted planning/output artifacts; no production source changes yet.

## 2026-09-25 — validation and acceptance

- Fixed UTF-8 truncation so the ellipsis is included inside the 8 KiB failure-feedback/failure-summary budget.
- Added a state/run-id transition callback from the Validation Center to refresh the task workspace list only when validation state changes; this keeps Merge/Cleanup disabled during an active validation without refreshing on every poll.
- Added a real `ChatSession` integration test covering `task:<sessionId>` identity, worktree-derived command cwd, successful `git diff --check`, and path escape blocking.
- Added a server-owned `failed` validation mode that reruns only the previously failed or blocked check IDs from the new trusted plan; arbitrary browser commands, cwd values, and check IDs are still rejected.
- Added bilingual `Rerun failed checks` UI state, disabled it when no failed/blocked checks remain, and exposed the selected mode as bounded metadata.
- Fixed UTF-8 truncation so the ellipsis is included inside the 8 KiB failure-feedback/failure-summary budget.
- Focused task-validation/UI tests passed 7/7.
- Cross-surface regression passed 25/25 across capability-token, task-terminal, task-workspaces, task-validation, and UI tests.
- Browser acceptance on temporary Git repositories passed: created isolated task, introduced controlled changes, observed pending/running checks, completed a passing validation, cancelled a slow check to a blocked state, confirmed bounded failure feedback insertion, and verified failed-check-only rerun from failed to passed. Captured:
  - `output/playwright/task-validation-center-passed.png`
  - `output/playwright/task-validation-center-blocked.png`
  - `output/playwright/task-validation-rerun-failed.png`
- Desktop `typecheck` and `build` passed.
- Full Desktop regression passed 255/255; the suite includes the parallel-runs slice now present in the worktree.

- Final verification after integrating the parallel-runs slice: Desktop build/typecheck passed and the complete Desktop suite passed 255/255, including all Task Validation Center, Run Inspector, task-worktree, and stale-session guards.
