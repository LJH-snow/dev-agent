# Progress

## 2026-09-25

- Started a follow-up plan for live-answer layout and real-PTY Back to bottom behavior.
- Confirmed the screenshot is a visual reference only; it shows the task title highlighted during a live/normal state and a visible Back to bottom prompt.
- Confirmed the branch already contains the previous clickable Back to bottom implementation in `ac58f68`.

- Changed the sticky task header and its reserved row to activate only when `viewport.followOutput` is false; live model output no longer gets a permanent highlighted row.
- Added a live-frame regression assertion that the submitted prompt appears only once while a run is active.
- Verified the real CLI after rebuilding: PageUp produced the navigation row, and an SGR primary click at the rendered navigation row returned to the latest output and removed the navigation prompt.
- Updated the repository `pnpm cli` script to build the CLI before starting it, preventing a restart from continuing to execute stale ignored `dist` output.
- CLI typecheck/build and the Ink app/mouse suites passed: 51/51.
