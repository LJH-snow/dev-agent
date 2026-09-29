# Ink 7.1.1 capability adoption: composer input, a11y, render performance, full-screen modes

## Goal
Enable the Ink 7.1.1 built-in capabilities the CLI does not use yet, in priority order — composer input experience (paste/IME/kitty keyboard), screen-reader support, shared-clock render performance, and alternate-screen full-screen modes — without new runtime dependencies and with each phase independently shippable.

## Current Phase
Phase 4 (complete; Ink 7.1.1 native APIs adopted and verified)

## Phases

### Phase 0: Recon (complete)
- [x] Inventory current Ink usage and unused capabilities (see findings.md)
- **Status:** complete

### Phase 1: Composer input experience (complete; Ink 7.1.1 native paste API adopted)
- [x] Paste blocks: Ink 7.1.1 `usePaste` now handles bracketed paste as one bounded block (cap `MAX_PASTE_CHARS=8000` + truncation notice). The composer retains a `useInput` fallback heuristic for terminals/test drivers that do not emit bracketed-paste markers; a single trailing break still submits so expect-style drivers and one-line pastes keep the old behavior.
- [x] Stale-closure fix: under `maxFps: 15`, handler closures could apply edits against a stale draft and drop pasted content; composer state is now ref-backed (`composerRef` + `applyComposer`) with all branches (arrows/backspace/history/tab/submit) reading the ref
- [x] Kitty keyboard protocol: render option `kittyKeyboard: { mode: "auto", flags: ["disambiguateEscapeCodes"] }` (auto probes, falls back silently); Shift+Enter (`CSI 13;2u` → `key.return && key.shift`) inserts a newline; non-press events filtered so keys register once
- [x] IME cursor: `useCursor` + `measureElement` position the terminal cursor at the caret, gated behind `DEV_AGENT_IME_CURSOR=1` (off by default; absolute-row contract verified manually)
- [x] CLI tests: tests/ink-composer-input.test.ts 6/6 (paste block, script-driver parity, two-line block, truncation, shift+enter, release filter); interactive PTY suite 19/19 after the boundary fix
- **Status:** complete

### Phase 2: Screen-reader support (complete; recalibrated scope)
- [x] Gate on ink's `isScreenReaderEnabled()` (render option or `INK_SCREEN_READER=true`); documented in apps/cli/README.md
- [x] Animation freeze for screen readers (they re-read the frame on every commit, so 180-360ms timers produce announcement storms): RotatingStatus renders its current status label, ThinkingIndicator's decorative glyph is omitted, ThoughtLine/CommandPalette/ApprovalCard timers stop
- [x] aria-state annotations: pending approval cards announce `(busy)`, running tool-timeline cards announce `(busy)`; composer already had textbox semantics
- [x] tests/ink-screen-reader.test.ts 5/5 (deterministic status line, non-SR contrast, glyph omission, `(busy)` prefixes)
- [x] CHANGELOG entry added. NOTE: the previously recorded "screen-reader announcements deferred" lines (docs/CHANGELOG.md v50/v51) refer to the Desktop HTML surface and stay deferred — they need a browser harness and are separate from this CLI work
- **Status:** complete

### Phase 3: Render performance (complete)
- [x] Audit found five independent timers (rotating-status 360ms, thinking/thought/palette/approval 180ms). New `src/ink/animation-clock.ts` gives one shared 180ms ticker that starts on first subscriber, stops on last, and is `unref()`ed; all five components migrated (`useAnimationTicks` with a ref-held callback so inline closures are safe). Status line advances every second tick to keep its 360ms cadence
- [x] Render metrics lifecycle in `src/ink/render-metrics.ts`, enabled by `DEV_AGENT_TUI_RENDER_METRICS=1`: constant-space count/max above the exact 1000/15ms budget. `onRender` releases initial input once and collects without I/O; normal unmount emits at most one stderr summary after Ink restores console interception. Direct stderr writes from `onRender` were unsafe and have been removed.
- [x] `incrementalRendering` remains disabled; retained the existing cursor-row rationale without claiming a new manual real-terminal check or measured performance improvement.
- [x] Repaired duplicate callback ownership, unsubscribe-during-dispatch, local hook ticks, and reset keys for card/status/palette changes (palette previously joined objects as `[object Object]`).
- [x] Targeted verification: 31/31 across clock (6), metrics lifecycle including mounted Ink (6), screen reader (5), and component regressions (14); 30s test timeout. Full-suite outcome and exact commands recorded in progress.md.
- **Status:** complete

### Phase 4: Alternate-screen full-screen modes (complete; native Ink 7.1.1 API adopted)
- [x] Added a bounded, opt-in project wrapper in `src/ink/alternate-screen.ts` using `CSI ?1049h`/`CSI ?1049l`; it enters before Ink's first frame, exits after final unmount, is TTY-gated, and has an `exit`-hook fallback.
- [x] Added unit coverage for environment opt-in, idempotent enter/exit, disabled sessions, writer failures, and process-exit restoration; added PTY smoke coverage for sequence ordering and default-off behavior.
- [x] Upgraded the CLI to Ink 7.1.1 and wired its native `alternateScreen: true` render option behind the existing `DEV_AGENT_TUI_ALT_SCREEN=1` gate; Ink now owns entry/exit and primary-buffer restoration.
- [x] Updated the `:editor` path to use Ink 7.1.1 `suspendTerminal`, and `usePaste` handles bracketed paste without the old custom event-emitter access.
- **Status:** complete; the local alternate-screen module remains only as a bounded compatibility/test helper.

### Phase 5: Deferred backlog (not scheduled)
- [x] `suspendTerminal`-backed `:editor` command (compose long prompts in $EDITOR) — implemented 2026-09-29 as `src/ink/editor-suspend.ts` + the `:editor` command; production suspension now delegates to Ink 7.1.1 while the helper remains independently testable. Plan: `.planning/2026-09-29-editor-command/`
- [ ] `renderToString` + ink-testing-library snapshot tests for cards
- [ ] `useFocus`/`useFocusManager` refactor of the single global `useInput` key router
- [ ] `useBoxMetrics`/`measureElement` scrollable transcript viewport
- **Status:** first backlog item done; the rest remain pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| No new runtime dependencies | Use Ink 7.1.1 capabilities where available and small local helpers only where the project needs bounded compatibility behavior; Node >=22 matches Ink 7.1.1 |
| Priority: input UX → a11y → perf → alt-screen | User pain first; a11y closes a recorded roadmap debt cheaply |
| Paste inserts one bounded block with truncation notice | Matches repo's bounded-input house rules |
| Backlog phases stay unscheduled | Value real but not blocking; revisit after Phase 4 |
| Alternate-screen stays opt-in and TTY-gated | Preserve normal scrollback and pipe/non-interactive output; production uses Ink 7.1.1 native lifecycle ownership, with the local wrapper retained only for compatibility tests |

## Boundaries
- No behavior change for non-paste typing or terminals without kitty protocol/alt-screen support; every feature degrades gracefully.
- CLI-only surface; apps/desktop untouched.
- Each phase ships with tests and a CHANGELOG note; do not disturb unrelated in-progress edits.

## Errors Encountered
| Error | Resolution |
|-------|------------|
