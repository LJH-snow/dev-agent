# Progress — Real PTY Sticky CLI Verification and Fix

## 2026-09-25 — investigation started

- Confirmed the sticky CLI commit is already present at `37e25a7` and pushed.
- Confirmed unrelated Desktop/MCP/Validation changes remain in the worktree and
  must not be disturbed.
- Created a real-PTY verification plan because render-to-string tests alone did
  not match the user's observed terminal behavior.

## 2026-09-25 — root cause fixed and real PTY recheck

- Changed the transcript viewport to always apply a fixed height and vertical
  clipping whenever transcript rows exceed the available viewport.
- Preserved each selected entry's global row offset with a bounded negative
  margin so an oversized Markdown entry shows the correct slice instead of
  restarting from its first line.
- Added a regression test with a 40-line response. It proves PageUp shows a
  middle slice, hides the response tail, keeps the task title above the slice,
  and keeps navigation/status/composer ordering at the bottom.
- Rebuilt and ran the full CLI suite: **634/634** passing.
- Re-ran the real PTY after the fix through the Codex terminal panel:
  - at live bottom, only the latest response tail remains above the controls;
  - PageUp showed rows 8–15 with the task prompt still above them;
  - a simulated SGR mouse-wheel event moved the view to rows 5–12;
  - `Back to bottom`, status, composer, and footer stayed fixed.
