# Desktop Task Validation Center

## Goal
Add a task-scoped validation center to the Desktop workbench so a task can run an explicit, bounded validation plan in its assigned Git worktree, display metadata-only check results, rerun failed checks, and feed a bounded failure summary back into the task prompt without weakening existing approval, sandbox, session, or merge boundaries.

## Phases
- [x] Inventory existing validation, task-worktree, terminal, and UI contracts
- [x] Define and test task-scoped validation manager/API with bounded lifecycle and cancellation
- [x] Add Validation Center UI and safe failure-to-prompt action
- [x] Integrate validation status with task workspace and Run Inspector/Changes Center
- [x] Run focused tests, build, browser acceptance, and repository verification
- [ ] Commit and push the verified feature

## Verification status

- Focused task-validation/UI tests: 7/7 passed.
- Cross-surface regression (capability token, task terminal, task workspaces, task validation): 25/25 passed.
- Browser acceptance completed on temporary Git fixtures: passed validation, live pending checks, cancellation to blocked, bounded failure-summary insertion, and failed-check-only rerun.
- `node --check apps/desktop/public/task-validation-ui.js` and `git diff --check`: passed.
- Desktop `build` and `typecheck`: passed.
- Full Desktop suite: 255/255 passed.

## Constraints
- Preserve unrelated user changes and temporary `.playwright-cli/` and `output/` directories.
- Validation must bind to the selected Desktop session and assigned task worktree; no arbitrary cwd or remote mutation.
- Only explicit allowlisted validation commands/plans may execute; do not infer or execute arbitrary package scripts from browser input.
- Bound commands, output/events, checks, runs, lifetime, and request payloads; expose metadata summaries by default.
- Cancellation must stop the underlying process; stale sessions/tasks fail closed.
- Keep rendered paths, commands, output, and errors bounded and text-safe.
