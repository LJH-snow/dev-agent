# Findings

- User image: the button was highlighted while the pointer was below the painted label, near the status area.
- Real Ink terminal rendering uses a guarded output and inline trailing newline. The footer ends two physical rows above the bottom and the eight-row bottom shell places navigation at (physical rows − 9). The old hit test assumed (physical rows − 8).
- In a headless ANSI terminal emulator the label actually painted at rows 15/31/41 for physical terminal heights 24/40/50. Old hit test accepted 16/32/42, so it lit up below the label and ignored clicks directly on the label. The first screen tests failed in six cases on the original implementation and passed after correcting the row.
- Mouse motion and `useInput` share Ink's internal event emitter; duplicating listeners would not fix the observed discrepancy.
- Previous tests used `debug: true` and examined concatenated output, not the terminal's displayed cells. New tests render normal Ink frames through the one-row output guard into `@xterm/headless`, find the painted label, inspect its blue background, and inject SGR motion/click reports at the actual screen coordinates.
- Only the existing hit row calculation and its tests were adjusted; no mouse parser or composer behavior was changed.
