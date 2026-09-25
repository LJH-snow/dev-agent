# CLI Back-to-bottom mouse action

## Goal
Make the visible `↓ Back to bottom · End latest` navigation bar actionable: parse terminal mouse clicks with coordinates, hit-test only the navigation row, and move the transcript viewport to the latest output without changing composer input behavior.

## Phases
- [x] Inspect current mouse/input/viewport behavior and establish focused baseline
- [x] Add coordinate-aware mouse click parsing with regression tests
- [x] Hit-test the bottom navigation row and call `viewportModel.end()`
- [x] Verify focused/full CLI tests and real PTY behavior
- [x] Review diff and commit only the scoped CLI changes

## Constraints
- Preserve unrelated working-tree changes.
- Keep wheel scrolling and End/PageUp behavior unchanged.
- Do not treat clicks outside the navigation row as Back to bottom.
- Do not insert mouse escape sequences into the composer.
