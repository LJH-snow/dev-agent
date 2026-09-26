# CLI scroll-state and Back-to-bottom follow-up

## Goal
Match Codex-style scroll behavior: keep the latest task header out of the normal live-answer layout, show it only while the user is browsing upward, and make the Back to bottom mouse action work in the real CLI PTY after restart.

## Phases
- [x] Reproduce both issues against the current Ink layout and real PTY dimensions
- [x] Render the task header only while browsing and stop reserving its row during live output
- [x] Correct mouse hit testing/input lifecycle for the real CLI render output and add regression coverage
- [x] Run focused/full CLI validation and inspect the real terminal behavior
- [x] Commit and push only the scoped CLI fix

## Constraints
- Preserve unrelated Desktop and planning changes in the working tree.
- Keep wheel, PageUp/PageDown, Home/End, and composer behavior unchanged.
- Do not treat normal model streaming as a browsed state.
- Do not assume the raw stdout row count before applying `createInkRenderOutput` and `terminalRowsOffset`.
