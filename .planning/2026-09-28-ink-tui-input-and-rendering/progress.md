# Progress Log

## Session: 2026-09-28

### Current Status
- **Phase:** 2 - Screen-reader support (Phase 1 complete)
- **Started:** 2026-09-28

### Actions Taken
- Plan created in the earlier session; implementation started after scheduled-background-tasks landed
- Verified the installed ink 6.8.0 API surface from build/index.d.ts and recalibrated the plan: no `usePaste`/`useAnimation`/`useBoxMetrics`/`alternateScreen`/`suspendTerminal`; `useInput` already delivers pastes as one chunk; kitty protocol available via render option
- Phase 1 implemented in `apps/cli/src/ink/app.tsx` + `src/index.ts`:
  - bounded paste blocks (≥2 line breaks, cap 8000 chars, truncation notice); single trailing break still submits (script-driver parity)
  - ref-backed composer state (`composerRef` + `applyComposer`) fixing stale-closure lost updates under maxFps throttling
  - kitty protocol enabled (`auto` + disambiguateEscapeCodes); Shift+Enter inserts newline; non-press events filtered
  - IME cursor via `useCursor`+`measureElement`, gated behind `DEV_AGENT_IME_CURSOR=1`
- Plan file updated with recalibrated Phase 3/4 (ink 6.8 has no shared-clock or alt-screen APIs)

### Test Results
| Suite | Result |
|-------|--------|
| tests-dist/ink-composer-input.test.js | 6/6 pass |
| tests-dist/interactive.test.js (PTY/expect) | 19/19 pass (was 15 pass / 4 fail before the paste-boundary fix) |
| tests-dist/package-install.test.js | "CLI tarball installs and runs" passed 3× standalone (isolated file + direct smoke script `--skip-build`); failed 2× inside the full suite with npm EALLOWSCRIPTS (645ms immediate failure vs 13s standalone). Environmental flake in the full-suite context, unrelated to the TUI diff (verified: test also green at baseline with changes stashed; smoke script green standalone) |
| Full CLI suite (711 tests) | 710 pass / 1 fail = only the flaky packaging smoke above; all TUI, PTY, and unit suites green |

### Errors
| Error | Resolution |
|-------|------------|
| First paste heuristic (any multi-char chunk with a break = paste) broke 4 expect-based PTY tests that send `text\r` as one chunk | Boundary moved to ≥2 line breaks; single trailing break still submits; added script-driver-parity test |
| Full CLI suite appeared to hang 70+ min | Self-inflicted: `| tail`/`| head` pipes filled or closed early and blocked the test runner on stdout writes. Rerun with output redirected to a file — never pipe long suites through head/tail |
| Oversized-paste e2e initially submitted nothing (stale-closure overwrite under maxFps) | Ref-backed composer state; also bisected the size threshold to confirm it was timing, not size |
