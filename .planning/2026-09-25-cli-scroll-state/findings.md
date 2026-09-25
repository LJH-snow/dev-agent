# Findings

- `taskTitle` is currently rendered whenever a user transcript entry exists, so the highlighted title row is visible while the model is answering.
- `visibleTranscriptRows` also always subtracts one row when a title exists; that row should be reserved only while the viewport is actually scrolled away from live output.
- The real CLI wraps stdout with `createInkRenderOutput`, which reports `actual rows + 1` to Ink, and passes `terminalRowsOffset=1`; the effective `terminalRows` inside `InkCliApp` is therefore the actual PTY row count. Hit testing must use this effective value.
- The current click parser/effect works in synthetic Ink tests, but real-PTY verification is needed to determine whether the remaining no-op is stale dist, wrong coordinates, or input delivery/lifecycle.
