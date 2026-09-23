# Desktop Plan/Review/Apply/Validate/Undo Implementation Plan

- **Status:** complete
- **Date:** 2026-09-22
- **Primary surface:** `apps/desktop`
- **Related capabilities:** Agent Core plan mode, reviewed change sets,
  approval, trusted validation, guarded rollback, run replay

## Objective

Complete the Desktop coding-agent workflow:

> Plan → review the exact diff → approve or reject → apply → validate → undo

Plan mode must be read-only. Applying a plan must use the reviewed change-set
identity already prepared by the session and must not ask the model to recreate
the mutation.

## Existing behavior to preserve

- Normal Desktop prompts remain FIFO and turn-owned.
- Existing `review-writes` approval cards continue to work.
- Existing validation, retry, stop, run recovery, session switching, and
  guarded rollback behavior remain compatible.
- No raw secrets, absolute workspace paths, or unbounded provider output are
  exposed in the UI.

## Implementation tasks

### 1. Shared Desktop plan contract

- Extend `ChatSession.run` with `mode: "normal" | "plan"`.
- Project Agent Core `onPlanReview` into a bounded Desktop `plan-review` event.
- Add a session-level exact plan application method that calls
  `AgentLoop.applyPlannedChangeSet` without another model turn.
- Add server-side pending-plan ownership by session and change-set ID.
- Add apply and reject endpoints with the same active-run and cancellation
  protections as normal runs.

### 2. Desktop composer and queue

- Add an Execute/Plan mode control to the composer.
- Preserve the selected mode in queued prompts and persisted queue snapshots.
- Keep queued prompts waiting while a plan is being reviewed or applied.
- Do not allow a second plan application for the same reviewed change set.

### 3. Plan and diff review UI

- Render the plan response and a separate localized plan-review card.
- Show affected files, added/removed line counts, and exact textual diffs.
- Add per-file collapse/expand controls with accessible state.
- Add explicit `Allow execution` and `Reject plan` actions.
- Keep normal approval cards and plan-review cards visually and behaviorally
  distinct.

### 4. Apply, validation, retry, and stop

- Apply the stored reviewed change set after user approval.
- Stream tool progress, validation results, completion, and errors into the
  owning turn.
- Preserve Stop and retry behavior for plan application failures.
- Resume the queue only after successful completion; pause it after failure or
  abort.

### 5. Guarded undo and evidence

- Keep Undo available only for an applied change set whose postimage still
  matches.
- Surface conflict, missing, success, and failure states in the plan card.
- Refresh evidence metadata after apply, validation, or undo.
- Keep the existing durable validation and change-set records authoritative.

### 6. Verification and documentation

- Add unit tests before implementation for queue mode persistence, plan event
  projection, exact plan application, server apply/reject routes, and UI
  contracts.
- Run the focused Desktop suite, Desktop TypeScript build, full workspace
  TypeScript gate, and `git diff --check`.
- Verify the rendered Desktop flow at wide and narrow viewports, including
  plan mode, diff folding, rejection, approval, apply, validation, conflict
  undo, queueing, stop, and retry.
- Update `task_plan.md` and `progress.md` with exact verification counts.

## Acceptance criteria

- A user can select Plan mode and submit a request without files changing.
- The response shows a concrete plan and, when previewable, an exact diff
  review card.
- Each file in the review can be expanded or collapsed.
- Approving applies only the stored reviewed change set.
- Rejecting removes the pending plan without changing files.
- Apply emits progress and trusted validation results in the same turn.
- A failed or aborted apply pauses the queue and offers retry where valid.
- Undo refuses external file changes and reports the conflict.
- A successful apply can be undone safely and the evidence view becomes stale
  until refreshed.
- Existing Desktop tests and queue/turn isolation contracts remain green.

## Completion record

The workflow was implemented behind the existing turn and queue ownership
model. It supports plan-mode review, exact stored change-set application,
trusted validation, guarded undo, failure/abort queue pausing, and retry
without a second model turn.

Verification completed on 2026-09-23:

- Focused plan/queue/replay/activity tests: **19/19**.
- Full Desktop suite: **191/191**.
- Rich CLI behavior evaluations: **8/8**.
- Full `pnpm verify:typescript` gate passed with Agent Core **188/188**,
  Tools **159/159**, CLI **561/561**, Desktop **191/191**, package-install
  smoke, and release/preview/documentation/native-bundle contracts.
- `git diff --check`: clean.
