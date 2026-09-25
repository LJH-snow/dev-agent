# Findings

- The reference screenshot shows a blue background and dark text on the Back-to-bottom button, not a permanently blue full-width navigation panel.
- An existing uncommitted patch adds SGR/X10 motion parsing and mode 1003+1006. It still highlights the entire label plus counters and rerenders the app on each changed pointer coordinate.
- Existing 52 focused tests pass but the hover assertion only checks that button text exists. Default test output is uncolored, so this does not prove visual state.
- Codebase graph and Context7 tools are not exposed in this session (resource/template inventories checked); fallback: scoped local code reads and the primary xterm mouse protocol documentation.
- Current CLI build passed. The earlier full CLI suite encountered auto-fix integration failure (heap exhaustion) and collaboration apply failure before it was interrupted; do not claim a green full suite.
- Old PTY session 52331 no longer exists. Use deterministic local fixtures for new verification.
- ANSI-enabled probe confirmed the exact state transition: outside false, over the button true (`ESC[106m`), away false. This is visual evidence for the requested hover-only blue background.
