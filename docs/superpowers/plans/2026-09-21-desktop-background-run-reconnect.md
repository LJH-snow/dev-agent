# Desktop background-run reconnect

## Objective

Keep a Desktop session running when the user switches away, then restore the
selected session's unfinished output and approval state without duplicating
messages or leaking events across sessions.

## Scope

- Add a bounded in-memory run registry to the Desktop server.
- Expose the latest run snapshot and replay events per session.
- Include run metadata in the session picker payload.
- Restore only live, not-yet-persisted fragments in the Desktop UI.
- Keep completed transcript rendering driven by persisted history.
- Add server and HTML contract tests for replay, stale-session isolation, and
  bilingual run-state labels.

## Constraints

- Keep the existing SSE event names and `/api/chat` contract compatible.
- Do not abort a run merely because the selected session changes.
- Bound retained events and bytes.
- Never use a run snapshot as a source for secrets, raw filesystem paths, or
  unbounded tool output.
- Do not introduce Electron, Tauri, React, or a second Desktop client.

## Verification

- [x] A running session exposes a stable run id, monotonic sequence, live
  snapshot, and replay cursor.
- [x] A second session cannot read the first session's run events.
- [x] Returning to a session restores unfinished assistant/tool/approval state
  and keeps receiving cursor-based updates until the run finishes.
- [x] The session picker shows running/waiting/complete/failed state in English
  and Chinese.
- [x] Desktop build, test typecheck, and the complete Desktop suite pass:
  **150/150**.
- [x] Rendered browser smoke confirms language switching, multiline composer
  sizing, session switching, and background recovery of a second streamed
  fragment.
- [x] Approval test fixtures close their HTTP connections and MCP-backed
  sessions, so the Desktop suite exits cleanly.
- [x] Workspace `pnpm verify:typescript` passed after the final verification
  run was serialized; Desktop remains green with the complete **150/150**
  suite and the CLI/Ink test process exits cleanly.
