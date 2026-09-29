# Overnight CLI input polish — progress

## 2026-09-30

### Phase 0: Plan + baseline
- Plan written to `task_plan.md`; baseline state: HEAD `f12e6f2`, parallel WIP
  (`:autofix review/apply/discard`) left untouched in 4 files.

### Phase 1: Scrolling window (complete)
- `suggestionIndex` now spans the full matched list; arrows wrap at the list
  bounds (`index <= 0 → last`, `index >= last → 0`).
- New `paletteOffset` state in `app.tsx` follows the selection so the painted
  6-row window always contains it; reset to 0 when the palette closes.
- `CommandPalette` takes an `offset` prop and slices
  `suggestions.slice(offset, offset + COMMAND_PALETTE_VISIBLE)`.

### Phase 2: Click mapping + affordance (complete)
- Click rows are window-relative; the app maps `row + paletteOffset` onto the
  absolute list before select/accept decisions.
- Footer hint updated to `Tab select · ↑↓ move · click accept · esc close`.

### Phase 3: Regression tests (complete)
- `ink-visual-regression.test.ts`: new scrolled-window snapshot (8 commands,
  offset 2) + footer text update.
- `ink-app.test.ts`: keyboard reachability — wrap up from index 0 lands on the
  last command, wrap down returns, index 6 selectable past the window, Tab
  accepts and the next Enter submits `:c6`.
- `ink-navigation-screen.test.ts`: scrolled click maps window row 2 (offset 1)
  to the absolute `:c3`, and clicking the selected row submits it.
- Results: visual 6/6, ink-app + navigation 66/66, typecheck clean,
  `git diff --check` clean.

### Phase 4: Full CLI suite (complete)
- Clean rebuild (`tsc` ×2 + `build-package.mjs`) then every `tests-dist`
  file with `--test-concurrency=1`, unfiltered.
- Result: **793/793 passed, 0 failed, 0 cancelled** (duration ≈392s),
  including the previously excluded `auto-fix-cli`, `auto-fix-command`, and
  package/install tests.

### Phase 5: Mimosa deep scan (complete)
- Deep scan completed and sealed after the suite finished (no
  `scanner_enobufs` this time): `scan-2026-09-29T20-02-58.537Z-5658f45a7c00`,
  seal `sha256:fadab317…e28f4b`, 198 packages, 0 dependency advisories.
- Run status: **inconclusive** (static-only; partial call graph), 22 static
  findings. Manual triage:
  - **No findings in the CLI Ink input surface** (app/composer/palette/kitty
    filter) touched by this phase or the recent TUI work.
  - 5 desktop `server.ts` "XSS" advisories (1248/1322/1377/1551/1699) are
    `JSON.stringify` error bodies with `content-type: application/json` —
    not HTML, not executable; false positives.
  - Env-var → command-injection chains (`DEV_AGENT_RUST_BINARY`, doctor CLI
    update check, session resume, background jobs) point at documented,
    dedicatedly tested local features (`:check-rust`, `DEV_AGENT_RUST_BINARY`
    run tests); local-user threat model, flagged for awareness not action.
  - `local-executor` / `rust-executor` sinks are the sandbox boundary by
    design; desktop parallel-runs sort/SQL advisories share the same shape.
- Conclusion recorded honestly: scan completed and sealed, but the run is
  static-only and inconclusive — the findings above were triaged manually,
  not "the project is audited secure".

### Phase 6: Ship
- Commit only this phase's files (ink sources, tests, planning, CHANGELOG);
  parallel WIP stays uncommitted.
