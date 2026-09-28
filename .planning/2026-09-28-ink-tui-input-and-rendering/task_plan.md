# Ink 6.8 built-in capability adoption: composer input, a11y, render performance, full-screen modes

## Goal
Enable the Ink 6.8 built-in capabilities the CLI does not use yet, in priority order — composer input experience (paste/IME/kitty keyboard), screen-reader support, shared-clock render performance, and alternate-screen full-screen modes — without new runtime dependencies and with each phase independently shippable.

## Current Phase
Phase 1

## Phases

### Phase 0: Recon (complete)
- [x] Inventory current Ink usage and unused capabilities (see findings.md)
- **Status:** complete

### Phase 1: Composer input experience
- [ ] `apps/cli/src/ink/app.tsx` composer: adopt `usePaste` so bracketed-pasted logs/code arrive as one bounded string (single insert + truncation notice) instead of per-keystroke processing
- [ ] Adopt `useCursor` for proper cursor handling and IME-safe composition (CJK input correctness)
- [ ] Enable kitty keyboard protocol handling (`key.eventType`) to distinguish Shift+Enter (newline) from Enter (submit) where the terminal supports it, with graceful fallback
- [ ] CLI tests: paste inserts bounded single block; newline/submit matrix; no regression for existing key routing in `useInput` (app.tsx:350)
- **Status:** pending

### Phase 2: Screen-reader support (closes deferred a11y debt)
- [ ] Gate enhanced announcements on `isScreenReaderEnabled()`; document `INK_SCREEN_READER=1`
- [ ] Add aria/role semantics to: `Static` transcript entries (app.tsx:574), tool cards, approval prompts, retry panel, plan-review panel
- [ ] Avoid spinner-only progress for screen-reader users: emit text state lines (ties into rotating-status)
- [ ] Update docs/CHANGELOG.md deferred "screen-reader announcements" entry; CLI tests for the gated announcements
- **Status:** pending

### Phase 3: Render performance
- [ ] Migrate ad-hoc timers (`rotating-status.tsx`, `thought-line.tsx`) to `useAnimation` shared clock (one frame loop, fewer renders while streaming)
- [ ] Evaluate `incrementalRendering` flag under token streaming; keep `maxFps: 15` (index.ts:5667) unless measurements say otherwise
- [ ] Optionally wire `onRender` metrics behind an env flag to catch render jank
- [ ] Tests: component tests for status components using the shared clock; before/after render-count assertions
- **Status:** pending

### Phase 4: Alternate-screen full-screen modes
- [ ] Run `session-picker` and `command-palette` inside `alternateScreen` so scrollback is preserved on exit; restore transcript cleanly
- [ ] Handle resize and early-exit paths; ensure errors never strand the terminal in alt screen
- [ ] CLI tests + manual acceptance on iTerm/Terminal.app
- **Status:** pending

### Phase 5: Deferred backlog (not scheduled)
- [ ] `suspendTerminal`-backed `:editor` command (compose long prompts in $EDITOR)
- [ ] `renderToString` + ink-testing-library snapshot tests for cards
- [ ] `useFocus`/`useFocusManager` refactor of the single global `useInput` key router
- [ ] `useBoxMetrics`/`measureElement` scrollable transcript viewport
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Ink 6.8 built-ins only, no new runtime deps | All target features ship in the pinned ink ^6.8.0 |
| Priority: input UX → a11y → perf → alt-screen | User pain first; a11y closes a recorded roadmap debt cheaply |
| Paste inserts one bounded block with truncation notice | Matches repo's bounded-input house rules |
| Backlog phases stay unscheduled | Value real but not blocking; revisit after Phase 4 |

## Boundaries
- No behavior change for non-paste typing or terminals without kitty protocol/alt-screen support; every feature degrades gracefully.
- CLI-only surface; apps/desktop untouched.
- Each phase ships with tests and a CHANGELOG note; do not disturb unrelated in-progress edits.

## Errors Encountered
| Error | Resolution |
|-------|------------|
