# Overnight CLI input polish: reachable command palette + verification pass

## Goal

While the user is away: make every command palette entry reachable (the
current palette shows only the first 6 of ~18 default commands and arrows wrap
inside that window), keep click mapping correct for the scrolled window, then
run the full verification pass that was previously skipped (complete CLI suite
including auto-fix and package tests) and the Mimosa deep security scan that
kept failing with `scanner_enobufs`.

## Constraints

- Do not touch the parallel workspace's uncommitted files:
  `apps/cli/src/index.ts`, `apps/cli/src/auto-fix-command.ts`,
  `apps/cli/tests/auto-fix-cli.test.ts`, `apps/cli/tests/auto-fix-command.test.ts`.
- Keep all existing bounded-input and fail-closed house rules.
- No new runtime dependencies.
- Full-suite failures that trace to the parallel WIP are reported, not fixed.

## Phases

### Phase 0: Plan + baseline (this file, quick state check)

### Phase 1: Command palette scrolling window
- Arrow Up/Down move across ALL prefix-matched suggestions, wrapping at the
  full list; the 6-row visible window follows the selection (scrolling
  offset), so every command becomes keyboard-reachable.
- `suggestionIndex` is clamped to the full list, not the visible window.
- Offset lives in `app.tsx` (single owner next to `suggestionIndex`);
  `CommandPalette` receives `offset` and slices the visible window.

### Phase 2: Scrolled-window click mapping + affordances
- Click rows map through `paletteOffset + row`; first click selects,
  clicking the selected row accepts (unchanged contract).
- Footer hint mentions click support; visual-regression expectations updated.

### Phase 3: Regression tests
- Keyboard reachability with >6 suggestions (scroll + wrap).
- Click on a scrolled window row selects/accepts the right absolute command.
- Existing Enter/Tab/Escape and screen click tests keep passing.

### Phase 4: Full CLI test suite (unfiltered)
- Include `auto-fix-cli`, `auto-fix-command`, and the package/install tests
  that previous targeted runs excluded; clean rebuild of `tests-dist` first.

### Phase 5: Mimosa deep security scan
- Run the full-project deep scan in the background; record the verdict (or
  the concrete blocker) in progress.md.

### Phase 6: Ship
- Commit only this phase's files (ink sources, tests, planning, CHANGELOG),
  push, and leave the parallel WIP untouched.
