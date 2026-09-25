# CLI Back-to-bottom hover

## Goal
Make the Back-to-bottom label highlight only while the pointer is over it, restore its normal appearance on leave, and preserve click-to-latest / scroll / composer behavior.

## Steps
- [x] Recover the existing patch and review the screenshot and mouse/Ink pipeline.
- [x] Add regressions that check actual colored output, leave/re-enter, text bounds, and idle pointer movement.
- [x] Finish the bounded hover implementation without repainting on every pointer cell.
- [x] Run focused checks and real PTY verification; record evidence and remaining suite limitations.

## Constraints
- Preserve all other tasks' files and staged changes, including Desktop and auto-fix work.
- Commit only the four scoped CLI files plus this task plan; preserve unrelated files and changes.
- No live model calls are needed to validate terminal hover.
