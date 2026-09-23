# CLI Scheduler Approval Status

**Goal:** Keep the interactive task snapshot aligned with the AgentLoop's
approval lifecycle so `:tasks` and `:task <id>` show when active work is waiting
for user confirmation.

**Status:** in progress

## Scope

- Report the start and resolution of tool approval gates through an optional
  AgentLoop observer without changing approval decisions or runtime events.
- Report sandbox-expansion confirmation waits through the same observer.
- Bridge the observer to the currently scheduled CLI task and clear the bridge
  when that task settles.
- Keep task snapshots metadata-only; never add prompt, tool input, or workspace
  content to status details.

## Acceptance

- Approval status transitions `running -> waiting-for-confirmation -> running`
  while a policy decision is pending.
- Sandbox expansion uses the same transition around the confirmation callback.
- Calls without an approval policy do not report approval waits.
- The bridge is cleared after task completion, and scheduler snapshots remain
  free of prompt text and tool arguments.
- Agent Core and CLI focused tests, package builds, and applicable full gates
  pass; any environment-blocked verification is recorded explicitly.

## Verification

- [x] Agent Core build and focused approval-status tests.
- [x] CLI build, test compilation, focused scheduler bridge tests, and the
      existing interactive task-lifecycle integration test.
- [x] Attempt the full CLI suite and record its blockers/failures.
- [ ] Full CLI suite passes and repository TypeScript verification completes.
- [ ] Review the final diff and run `git diff --check`.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Agent Core skills test could not create a temporary directory under the real home | Initial full suite | Set `HOME=/tmp`; full Agent Core suite then passed. |
| CLI full suite reached the isolated package-install test, whose npm install made no progress without network access; earlier child-process tests also hit Node 26 native assertions | Initial full CLI suite | Stop the stalled test process; run focused coverage and isolate the broader environment issue. |
| Elevated CLI suite restored loopback access but reported approval/integration failures; a failed interactive PTY test left its stub provider open and held the runner | Second full CLI attempt | Stop the runner after collecting **244 passed, 17 failed, 63 cancelled**; do not treat the suite as green. |
