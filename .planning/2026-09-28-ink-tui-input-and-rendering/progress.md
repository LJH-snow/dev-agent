# Progress Log

## Session: 2026-09-29 (Phase 4 project implementation and verification)

- Repaired the concurrent managed-scrolling/conversation-status workstream in the
  live tree: `ink-app` and `ink-navigation-screen` focused coverage is now 53/53,
  and the runtime summary gate keeps pre-seeded diagnostics hidden while showing
  timing metadata after real terminal runs.
- Added `src/ink/alternate-screen.ts` with an opt-in
  `DEV_AGENT_TUI_ALT_SCREEN=1` wrapper around Ink. It is enabled only for TTY
  stdout, enters with `CSI ?1049h`, exits after Ink's final unmount with
  `CSI ?1049l`, is idempotent, and has a best-effort synchronous `process.exit`
  restoration hook. Hard termination such as `SIGKILL` remains unrecoverable.
- Added `tests/ink-alternate-screen.test.ts` (5/5) and manually verified PTY
  sequence ordering (`enter < composer < exit`, one enter/exit each) plus the
  default-off path (zero sequences).
- Ink upstream already includes the native `alternateScreen` option in commit
  `5a60eb9`. This checkout still uses Ink 6.8.0, so the local wrapper remains
  until a compatible dependency upgrade is selected; a duplicate upstream PR is
  unnecessary.
- An initial combined CLI run ended at 734/737 with three tests cancelled at the
  120s per-test limit (`session-delete`, `--no-stream`, and preview exclusivity);
  all three suites passed independently. The cause of those timeouts was not
  established, and three diagnostic agents failed before returning findings due
  to an account concurrency limit.
- Final combined rerun passed: `pnpm --dir apps/cli exec sh -c 'node
  build-package.mjs && node --test --test-concurrency=1 --test-timeout=300000
  tests-dist/*.test.js'` — **737/737 passed, 0 failed, 0 cancelled**, 242054ms,
  shell exit 0. Log: `/tmp/cli-phase4-final-full.log`. This supersedes the earlier
  timed-out run. `git diff --check` is clean.

## Session: 2026-09-29 (Phase 3 re-verification)

- Re-verified Phase 3 against the live working tree, which a second concurrent
  session has since extended with an unrelated "managed scrolling and
  conversation status" workstream (app.tsx layout rewrite, runtime-store
  conversation/diagnostics, footer context tokens; files modified 22:08–01:18).
  Phase 3 files were not disturbed.
- Typecheck + builds clean (exit 0): `tsc -p apps/cli/tsconfig.json --noEmit`,
  then source build, `tsconfig.test.json --noEmit` and test build (tests import
  dist declarations, so source is built first).
- Targeted Phase 3 suites re-run: 31/31 pass, shell exit 0
  (`node --test --test-concurrency=1 --test-timeout=30000` over
  ink-animation-clock, ink-render-metrics, ink-screen-reader, rotating-status,
  thinking-indicator, thought-line, command-palette, tool-timeline).
  Log: `/tmp/cli-phase3-verify.log`.
- `incrementalRendering` confirmed absent (standard renderer + `maxFps: 15`
  retained; `onRender: renderMetrics.onRender` wired at src/index.ts:5691).
- `git diff --check` clean; CHANGELOG/README entries for Phase 2/3 present.
- Full suite re-run (`pnpm --dir apps/cli exec sh -c 'node build-package.mjs &&
  node --test --test-concurrency=1 --test-timeout=120000 tests-dist/*.test.js'`,
  log `/tmp/cli-phase3-verify-full.log`): **722/732 pass, 10 fail — all 10 in
  the concurrent workstream's files** (tests written first at 22:08–22:09,
  source still lagging at 01:18): `Context: unknown` casing vs implemented
  `context unknown`, missing PATH COMPLETION / TOOL TIMELINE panel headers,
  status/footer visibility under the new bounded viewport, and one `:trace`
  diagnostics timeout. None touch the shared animation clock, render metrics,
  or screen-reader scope. Left untouched per plan boundaries ("do not disturb
  unrelated in-progress edits"); fixing them requires the other session's
  intent for its own rewrite.

## Session: 2026-09-28

### Current Status
- **Phase:** 3 complete (render performance); Phase 4 project implementation complete, native API merged upstream; compatible Ink upgrade deferred
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
| tests-dist/package-install.test.js | "CLI tarball installs and runs" passed 3× standalone (isolated file + direct smoke script `--skip-build`); failed 2× inside the full suite with npm EALLOWSCRIPTS (645ms immediate failure vs 13s standalone). Earlier runs only; calling this an environmental flake was not justified. npm lifecycle environment injection is the likely explanation (see Phase 3 verification below) |
| Full CLI suite (711 tests) | 710 pass / 1 fail = only the packaging smoke failure above (not proven flaky); all TUI, PTY, and unit suites green |
| Full CLI suite after Phase 2 (716 tests, +5 screen-reader) | 715 pass / 1 fail = same packaging smoke failure (fails at 643ms in-suite, passes standalone 4× including via the exact `--skip-build` path). npm 11.17 EALLOWSCRIPTS policy + user `~/.npmrc` `allow-scripts=@anthropic-ai/claude-code`; later verification confirmed npm lifecycle injects `npm_config_allow_scripts`, which survives HOME isolation. Do not classify this as a random flake |

### Phase 3 implementation and verification (completed)
- Preserved existing Phase 2/3 edits and unrelated `.mimosa/`; no commit/push.
- Fixed clock subscription ownership for duplicate callbacks and unsubscribe-during-dispatch. Hook tick counts are local, inline callbacks stay current, and reset keys restart card/status/palette sequences without restarting other subscribers. Palette reset keys now serialize actual suggestions rather than joining objects.
- Replaced unsafe stderr writes in `onRender` with constant-space count/max collection and at most one summary after normal unmount. Confirmed installed Ink 6.8 restores console interception during unmount, after its final render. Collection uses the exact `1000 / 15` ms threshold and preserves first-paint input release. Tests exercise real Ink callback/teardown wiring plus re-entry, bounded output, invalid samples, disabled collection, and sink failure.
- Source and test typechecks passed (exit 0): `pnpm exec tsc -p apps/cli/tsconfig.json --noEmit` and `pnpm exec tsc -p apps/cli/tsconfig.test.json --noEmit`. Source was built before checking tests because tests import dist declarations; an initial test check against stale dist failed, then passed after rebuilding.
- Builds passed: `pnpm exec tsc -p apps/cli/tsconfig.json && pnpm exec tsc -p apps/cli/tsconfig.test.json`.
- Targeted command (from repository root): `node --test --test-concurrency=1 --test-timeout=30000 apps/cli/tests-dist/ink-animation-clock.test.js apps/cli/tests-dist/ink-render-metrics.test.js apps/cli/tests-dist/ink-screen-reader.test.js apps/cli/tests-dist/rotating-status.test.js apps/cli/tests-dist/thinking-indicator.test.js apps/cli/tests-dist/thought-line.test.js apps/cli/tests-dist/command-palette.test.js apps/cli/tests-dist/tool-timeline.test.js`. **31/31 passed**, no skips/cancellations; complete log `/tmp/cli-phase3-targeted.log`, recorded shell exit 0.
- Full underlying CLI test script, after the builds above: `pnpm --dir /Users/Admin/Desktop/dev-agent/apps/cli exec sh -c 'node build-package.mjs && node --test --test-concurrency=1 --test-timeout=120000 tests-dist/*.test.js'`. **728/728 passed**, 0 failed/skipped/cancelled, 301977ms; complete log `/tmp/cli-phase3-full.log`, tool exit 0 and `VERIFIED_SHELL_EXIT_CODE=0`. Packaging smoke passed in 44824ms. No output truncation pipes were used.
- Environment distinction: `npm --prefix /Users/Admin/Desktop/dev-agent/apps/cli run env --silent` confirmed `npm_config_allow_scripts=@anthropic-ai/claude-code`; the pnpm-exec Node probe returned no such variable. Earlier `npm test` EALLOWSCRIPTS failures are not proven flaky; lifecycle injection survives the smoke's HOME isolation. This green run is the underlying script via pnpm exec, **not** a green `npm test` claim. User/global npm configuration was not changed.
- `git diff --check` passed. `incrementalRendering` remains disabled. No new manual real-terminal verification, screen-reader-device validation, or measured latency/FPS improvement is claimed. Abrupt termination can lose the optional unmount summary.

### Errors
| Error | Resolution |
|-------|------------|
| First paste heuristic (any multi-char chunk with a break = paste) broke 4 expect-based PTY tests that send `text\r` as one chunk | Boundary moved to ≥2 line breaks; single trailing break still submits; added script-driver-parity test |
| Full CLI suite appeared to hang 70+ min | Earlier cause was not established; the pipe-blockage explanation was speculative. `/tmp/cli-full-suite-4.log` was interrupted and is not a valid green run. Use complete redirected logs, bounded test timeouts, and recorded shell exit codes |
| Oversized-paste e2e initially submitted nothing (stale-closure overwrite under maxFps) | Ref-backed composer state; also bisected the size threshold to confirm it was timing, not size |
