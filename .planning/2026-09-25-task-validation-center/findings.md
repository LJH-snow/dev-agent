# Findings

## Baseline

- Current branch is `codex/desktop-cli-workbench` on 2026-09-25.
- Desktop already has task-scoped Git worktrees, bounded terminal runs, Changes Center diff review, Run Inspector metadata, validation/evidence APIs, and session-scoped capability tokens.
- Existing validation in `apps/desktop/src/server.ts` is tied to applied change-set evidence (`/validation/rerun`); it is not yet a task-worktree validation surface.
- The task terminal manager already owns bounded child-process lifecycle and emits lifecycle metadata, but validation needs independent check/run state so terminal history remains a presentation surface.

## Safety boundary

- The new surface should be task/session bound and use the existing `DesktopTaskWorkspaceManager` worktree resolution.
- Browser input should select from a server-provided allowlisted validation plan; it should not submit arbitrary commands or cwd values.
- Validation results should expose status, check id/name, duration, exit code, and bounded redacted summary; raw output stays behind bounded terminal-like retrieval or is omitted from the first MVP.

## Open design decision

- The first implementation will use a small server-owned validation catalog supplied through `DesktopServerOptions` with a safe default derived from existing validation configuration only when explicitly provided. This avoids guessing project scripts and keeps the browser from authoring commands.

## Implementation design

- Add `prepareTaskValidation` and `runTaskValidation` optional methods to `DesktopChatSession`; real `ChatSession` will reuse its existing executor, validation policy, planner, and runner against task worktree paths.
- Add `DesktopTaskValidationManager` to own one bounded run per task session, cancellation, retained last snapshot, and metadata-only projection. The manager never accepts commands or cwd from the browser.
- Add loopback/capability-gated `/api/task-validation` GET/POST/DELETE routes. POST derives changed paths from `DesktopTaskWorkspaceManager.diff`, rejects truncated file lists, and starts the session-bound run.
- Add a task validation panel beside Changes Center with Run, Cancel, Refresh, and bounded “insert failure summary” actions. Polling is only active while a run is running.

## Failed-check rerun design

- The browser can request only the allowlisted `mode: "failed"`; it cannot submit check IDs, commands, cwd values, or scripts.
- The manager takes failed/blocked check IDs from its retained metadata snapshot, prepares a fresh server-owned validation plan, intersects the IDs with that fresh plan, and executes only the intersection.
- If no failed or blocked checks remain, the API returns `409 task-validation-no-failed-checks`; stale failed IDs that disappear from the new plan produce a safe skipped run rather than arbitrary execution.
- The snapshot exposes `mode: "all" | "failed"` as bounded metadata, and the UI disables the rerun control after all checks pass.
