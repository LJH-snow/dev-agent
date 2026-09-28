# Ink 6.8 built-in capability adoption: composer input, a11y, render performance, full-screen modes

## Goal
Enable the Ink 6.8 built-in capabilities the CLI does not use yet, in priority order — composer input experience (paste/IME/kitty keyboard), screen-reader support, shared-clock render performance, and alternate-screen full-screen modes — without new runtime dependencies and with each phase independently shippable.

## Current Phase
Phase 2

## Phases

### Phase 0: Recon (complete)
- [x] Inventory current Ink usage and unused capabilities (see findings.md)
- **Status:** complete

### Phase 1: Composer input experience (complete; recalibrated to real ink 6.8 APIs)
- [x] Paste blocks: `usePaste` does not exist in ink 6.8 and `useInput` already delivers pastes as one multi-char chunk. Composer now treats chunks with ≥2 line breaks as a bounded paste block (cap `MAX_PASTE_CHARS=8000` + truncation notice); a single trailing break still submits so expect-style drivers and one-line pastes keep the old behavior (this boundary broke 4 PTY tests until fixed — see progress.md)
- [x] Stale-closure fix: under `maxFps: 15`, handler closures could apply edits against a stale draft and drop pasted content; composer state is now ref-backed (`composerRef` + `applyComposer`) with all branches (arrows/backspace/history/tab/submit) reading the ref
- [x] Kitty keyboard protocol: render option `kittyKeyboard: { mode: "auto", flags: ["disambiguateEscapeCodes"] }` (auto probes, falls back silently); Shift+Enter (`CSI 13;2u` → `key.return && key.shift`) inserts a newline; non-press events filtered so keys register once
- [x] IME cursor: `useCursor` + `measureElement` position the terminal cursor at the caret, gated behind `DEV_AGENT_IME_CURSOR=1` (off by default; absolute-row contract verified manually)
- [x] CLI tests: tests/ink-composer-input.test.ts 6/6 (paste block, script-driver parity, two-line block, truncation, shift+enter, release filter); interactive PTY suite 19/19 after the boundary fix
- **Status:** complete

### Phase 2: Screen-reader support (closes deferred a11y debt)
- [ ] Gate enhanced announcements on `isScreenReaderEnabled()`; document `INK_SCREEN_READER=1`
- [ ] Add aria/role semantics to: `Static` transcript entries (app.tsx:574), tool cards, approval prompts, retry panel, plan-review panel
- [ ] Avoid spinner-only progress for screen-reader users: emit text state lines (ties into rotating-status)
- [ ] Update docs/CHANGELOG.md deferred "screen-reader announcements" entry; CLI tests for the gated announcements
- **Status:** pending

### Phase 3: Render performance (recalibrated: no `useAnimation` in ink 6.8; `incrementalRendering` already rejected in index.ts for PTY cursor bugs)
- [ ] Audit `rotating-status.tsx`/`thought-line.tsx` timers; if all share one interval already, document and close
- [ ] Wire `onRender` (RenderMetrics) behind an env flag to catch render jank during streaming
- [ ] Re-evaluate `incrementalRendering` only if upstream fixes the cursor-row diff bug
- **Status:** pending

### Phase 4: Alternate-screen full-screen modes (blocked: no `alternateScreen` API in ink 6.8)
- [ ] Blocked on upstream; revisit when ink ships an alternate-screen API, or evaluate a bounded custom implementation
- **Status:** blocked

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
