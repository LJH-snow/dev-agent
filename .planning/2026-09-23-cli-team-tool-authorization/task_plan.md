# CLI Per-Task Collaboration Tool Authorization

## Goal

Add explicit, per-task user authorization to CLI `:team` execution. Planner
output may describe work but can never grant tools. Every confirmed scope must
be fixed before Agent Core creates a task workspace and must govern both model
schemas and runtime tool lookup.

## Phases

1. **Trace boundaries** — identify planning, confirmation, execution, retry,
   cancellation, and workspace-creation boundaries. **Complete.**
2. **Implement authorization** — collect an exact tool-name scope for each
   normalized task, constrain choices by the user-owned collaboration ceiling,
   and fail closed on invalid or cancelled confirmation. **In progress.**
3. **Verify behavior** — cover parser, confirmation, retry, cancellation,
   planner spoofing, workspace ordering, and schema/runtime enforcement; run
   focused and repository gates.
4. **Document** — describe the interactive flow and keep configuration docs
   clear that the global ceiling is not a grant.

## Invariants

- No task workspace is created until all task scopes are confirmed.
- Empty input/Escape/Ctrl-C cancels; the literal `none` explicitly confirms an
  empty tool scope.
- Only exact names currently available under the configured user ceiling can
  be selected. Planner-provided capability fields are ignored.
- Each retry requires a fresh confirmation.
- Confirmed allowlists govern both advertised schemas and runtime lookup.
- Preserve the unrelated dirty working tree and the existing active `.planning`
  pointer.
