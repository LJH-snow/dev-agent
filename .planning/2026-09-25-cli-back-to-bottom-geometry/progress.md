# Progress

## 2026-09-25
- Reproduced the requested geometry from the two supplied screenshots.
- Red test confirmed the old implementation rejected a click at the visible row `(x=40, y=16)`.
- Implemented centered rendering, centered hit testing, and the guarded-layout row correction.
- Fresh targeted typecheck/build and Ink app + mouse tests passed: 52/52.
- A guarded PTY-style probe confirmed: y16 hover=true, y17 hover=false, centered label, and click returns to the latest output.
- Added the resize dependency so the centered hitbox tracks horizontal terminal changes too.
- Final targeted verification passed again: source typecheck, test compilation, 52/52 focused tests, and diff whitespace check.
