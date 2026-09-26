# CLI Back-to-bottom geometry fix

## Goal
Match the requested Codex-style behavior: center the Back-to-bottom navigation label, make the hover/click hitbox match the visible row, and return the transcript to the true latest output when clicked.

## Steps
- [x] Compare the supplied screenshots with the current Ink layout and trace row/column geometry.
- [x] Add failing hit-test expectations for the centered visible row and centered columns.
- [x] Move the visual label to the center and align hover/click coordinates with the real guarded PTY layout.
- [x] Verify hover on the visible row, no hover one row below, and click-to-end in a guarded real-CLI layout.
- [x] Commit and push only the scoped CLI source, test, and this plan files.

## Constraints
- Preserve unrelated Desktop, GitHub workflow, auto-fix, and planning changes.
- Do not change mouse wheel behavior or composer input handling.
- Keep normal live model streaming free of the navigation hover state.
