# Desktop Conversation Checkpoints and Guarded Rewind Implementation Plan

- **Status:** complete
- **Date:** 2026-09-23
- **Primary surface:** `apps/desktop`
- **Related capability:** Agent Core FileMemory checkpoint store

## Objective

Bring the existing CLI-only conversation checkpoint workflow to Desktop:

> Create a history checkpoint -> list checkpoints -> rewind conversation history

Rewind removes later conversation entries in the owning session. It does not
roll back workspace files, applied change-set evidence, or a persisted change
set's validation guard.

## Existing behavior to preserve

- One active run per session; mutating requests must reject `409` while active.
- Existing history, run replay, queue ownership, approvals, plans, validation,
  and rollback contracts remain unchanged.
- Checkpoint records remain metadata-only and bounded by FileMemory.
- Rewind validates the session id and exact history anchor before truncating.
- No raw session content is added to status or checkpoint output.
- Cross-process restore remains read-only for undo; this feature only affects
  conversation history.

## Implementation tasks

### 1. Session checkpoint contract

- Add `createCheckpoint`, `listCheckpoints`, and `rewindToCheckpoint` methods
  to `ChatSession`, backed by `FileMemoryCheckpointStore`.
- Keep error messages bounded and do not expose filesystem paths.

### 2. Desktop HTTP routes

- `GET /api/sessions/<id>/checkpoints` lists bounded checkpoint metadata.
- `POST /api/sessions/<id>/checkpoint` creates a checkpoint.
- `POST /api/sessions/<id>/checkpoint/rewind` rewrites only conversation history.
- Add `409` active-run checks, session existence checks, bounded response
  bodies, and stable structured errors.

### 3. Desktop UI

- Add a localized `Checkpoints` action beside the existing session actions.
- Show id, entry count, and created time in a compact panel.
- Require an explicit confirmation before rewind and reload the active
  transcript on success.
- Surface stale-session, active-run, conflict, unavailable, and failure states.

### 4. Verification and documentation

- Add focused server and UI tests before implementation.
- Run the focused checkpoint suite, the full Desktop suite, and the full
  workspace TypeScript gate.
- Run `git diff --check`.
- Update `task_plan.md`, `progress.md`, `findings.md`, Desktop README, and
  architecture documentation with evidence.

## Acceptance criteria

- A user can create a checkpoint after one or more Desktop turns.
- The panel lists checkpoints without exposing absolute paths.
- Rewinding an earlier checkpoint removes only later conversation entries.
- Rewinding the latest checkpoint is a bounded, idempotent no-op.
- Rewinding fails closed for unknown, stale, cross-session, or malformed ids.
- Workspace files and change-set evidence are never changed by a rewind.
- Existing Desktop queue and turn ownership tests remain green.

## Completion record

Completed on 2026-09-23. Desktop ChatSession now creates, lists, and rewinds
bounded FileMemory conversation checkpoints. The HTTP routes reject concurrent
session work with the stable active-session error and keep checkpoint metadata
session-owned; unknown checkpoint, stale-anchor, and cross-session rewind
conditions fail closed. The localized checkpoint panel requires explicit
confirmation and reloads the transcript only after a successful rewind.

Verification evidence:

- Focused checkpoint coverage: **4/4**.
- Focused plan-workflow regression after the active-message restore: **5/5**.
- Full Desktop suite: **195/195**.
- Repository `pnpm verify:typescript` passed, including Desktop **195/195**,
  CLI **561/561**, CLI package-install smoke, preview/release/CI contracts,
  documentation contracts, and native Desktop bundle contracts.
- `git diff --check`: passed.
