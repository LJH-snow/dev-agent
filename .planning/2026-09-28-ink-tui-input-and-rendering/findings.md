# Findings — Ink TUI Input and Rendering

## Ink 7.1.1 upgrade result (2026-09-29)

- `apps/cli` now depends on `ink ^7.1.1`; the lockfile resolves Ink 7.1.1 with
  React 19.3.0 and Node.js 26 satisfies the package's `>=22` engine.
- Ink 7.1.1 exposes the native capabilities that the earlier Ink 6.8 audit
  marked unavailable: `usePaste`, `alternateScreen`, and `suspendTerminal`.
- Production now uses `render(..., {alternateScreen})`, `usePaste`, and
  `useApp().suspendTerminal`; the private Ink 6 event-emitter path is gone.
- The older Ink 6.8 API findings below are historical evidence from the prior
  dependency state and are superseded for current implementation decisions.

Recon done 2026-09-28 from the Ink repository (github.com/vadimdemedes/ink, README + docs) and a usage inventory of `apps/cli/src`.

## Historical pre-Ink 7 requirements (2026-09-28)

The audit below was performed before the dependency upgrade. Its dependency
constraints and API inventory are historical evidence, not the current
implementation contract.

- Adopt Ink capabilities that improve the CLI composer, accessibility, streaming render cost, and full-screen interactions.
- Everything targeted ships inside the pinned `ink ^6.8.0` (apps/cli/package.json) — no version bump, no new runtime deps.

## Research Findings

### Current Ink usage in dev-agent CLI at audit time (pre-Ink 7)
- Deps: `ink ^6.8.0` + `react ^19.3.0` (apps/cli/package.json).
- Imports across `apps/cli/src`: `Text` ×15, `Box` ×13, `useStdout` ×1, `useStdin` ×1, `useInput` ×1, `render` ×1, `Static` ×1.
- `Static` scrollback transcript: `apps/cli/src/ink/app.tsx:574`.
- Single global key router: `useInput` at `apps/cli/src/ink/app.tsx:350`.
- `maxFps: 15` already set: `apps/cli/src/index.ts:5667`.
- Hand-rolled components: session-picker, command-palette, thought-line, diff-preview, mcp-panel, markdown, plan-review-panel, retry-panel, rotating-status (apps/cli/src/ink/*.tsx).
- Feature greps: `usePaste` 0 hits, `useCursor` 0, `useAnimation` 0, `useBoxMetrics`/`measureElement` 0, `renderToString` 0, `alternateScreen` 0, kitty protocol 0, `useFocus` 0, `isScreenReaderEnabled` 0, `suspendTerminal` 0, `incrementalRendering` 0.

### Ground truth: installed ink 6.8.0 API surface (verified from build/index.d.ts)
- Present: `useCursor` ({x,y} absolute from output top; for IME), `renderToString`, `useIsScreenReaderEnabled`, `useFocus`/`useFocusManager`, `measureElement`, `kittyFlags`/`kittyModifiers`/`KittyKeyboardOptions`, render options `kittyKeyboard: {mode: auto|enabled|disabled, flags}` (auto probes and falls back), `incrementalRendering`, `maxFps`, `concurrent`, `onRender` (RenderMetrics).
- NOT present (plan recalibrated): `usePaste`, `useAnimation`, `useBoxMetrics`, `alternateScreen`, `suspendTerminal`.
- Paste handling needs no new hook: `useInput` already delivers a paste as ONE multi-character `input` chunk (documented behavior). The composer must treat multi-char chunks containing line breaks as paste blocks — previously any embedded break submitted and dropped the rest.
- Kitty mapping: Shift+Enter arrives as `CSI 13;2u` → parsed `name: "return"` + `shift` modifier; `key.eventType` carries press/repeat/release, and Ink delivers release events too, so the composer MUST filter non-press events or every key registers twice.
- Existing constraint: index.ts deliberately avoids `incrementalRendering` (its diff misplaces cursor rows on real PTYs — see render comment at maxFps), so Phase 3's incremental-rendering idea is a no-go; and maxFps: 15 throttling means input handlers must not read render state from closures (stale-closure lost updates under big pastes — fixed with a ref-backed composer during Phase 1).

### Ink 6.8 capabilities available for adoption (superseded by ground truth above)
- **Input**: `usePaste` (bracketed paste as one string), `useCursor` (cursor + IME composition), kitty keyboard protocol via `useInput`'s `key.eventType` (disambiguated keys, Shift+Enter vs Enter), `getKittyKeyboardProtocol`.
- **A11y**: `isScreenReaderEnabled()`, `INK_SCREEN_READER=1`, `aria-*` props on Box/Text, screen-reader-compatible spinner guidance.
- **Perf**: `useAnimation` (shared animation clock), `incrementalRendering`, `maxFps` (in use), `onRender` metrics.
- **Layout/motion**: `useBoxMetrics` + `measureElement`, `overflow="hidden"`, `contentOffsetY`, coordinate hit-testing (ScrollView pattern), `useTransition`/`useAnimation` for motion.
- **Modes**: `alternateScreen`, `suspendTerminal` (hand off to $EDITOR/pager and redraw), `exit(value)`/`waitUntilExit`, `concurrent` mode (Suspense), `renderToString` (SSR-ish string rendering for tests/export).
- **Ecosystem** (separate packages, optional): ink-markdown, ink-syntax-highlight, ink-spinner, ink-text-input, ink-multi-select, ink-virtual-list, ink-progress-bar, ink-table, ink-link, ink-confirm-input, ink-testing-library.

### Priorities agreed with the user
1. Composer input (paste/IME/kitty) — direct user pain, CJK users.
2. Screen-reader support — closes the assistive-tech debt recorded as deferred in docs/CHANGELOG.md.
3. Render performance (`useAnimation`, `incrementalRendering`).
4. `alternateScreen` full-screen modes.
5. Backlog: `:editor` via `suspendTerminal`, renderToString tests, `useFocus` refactor, scrollable viewport.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Built-ins only; ecosystem packages evaluated later case-by-case | Avoid dependency growth; most value is already in-tree |
| Graceful degradation required per feature | Terminals without kitty/alt-screen/paste support must behave exactly as today |
| CLI-only scope | Desktop has its own input stack; no cross-surface churn |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| none yet | — |

## Resources
- Usage inventory command outputs recorded in the 2026-09-28 session (see progress.md).
- Ink docs: https://github.com/vadimdemedes/ink#documentation
