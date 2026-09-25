# Progress

## 2026-09-25

- Added `apps/cli/src/github-workflow-command.ts`.
- Added focused parser/execution tests in
  `apps/cli/tests/github-workflow-command.test.ts`.
- Added readline and Ink command routing, hints, and README documentation.
- Added an entry-point integration test that exercises `:branch` in a temporary Git workspace.
- Typecheck, CLI build, test compilation, and focused workflow/UI tests pass.
- Full test compilation currently also includes unrelated pre-existing working-
  tree test edits; those were minimally made type-correct so targeted tests can run.
