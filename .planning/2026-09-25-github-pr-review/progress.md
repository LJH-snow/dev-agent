# Progress

## 2026-09-25 — implementation and verification

- Implemented `apps/desktop/src/github-pr-review.ts` with strict target normalization, bounded projection, opt-in `gh` adapter, and stable failure classification.
- Added loopback-only `POST /api/github/pr-review` in `apps/desktop/src/server.ts`; malformed custom-loader results now fail closed as `502 malformed-response`.
- Added bilingual Desktop PR Review panel with changed files, reviews, comments, unified diff, private local notes, clear/session isolation, and prompt insertion actions.
- Added `DEV_AGENT_DESKTOP_GITHUB=1` documentation to the Desktop README.
- Added focused tests for normalization, bounds, opt-in, read-only command arguments, route sanitization, malformed loader output, safe rendering, bounded draft storage, and late-response invalidation.
- Focused PR Review verification: 17/17 tests passed after the late-response
  invalidation and bounded prompt/diff clipping regressions were covered.
- Browser fixture verification: PR loaded, bounded review data rendered, local notes persisted, and “Review with agent” inserted context and switched to Plan mode.

- Fresh current-worktree Desktop verification passed: 319/319 tests, including
  the PR Review suite, and both Desktop TypeScript projects compiled.

## Next

- Build the selective feature-only commit with an independent Git index, push
  `codex/desktop-cli-workbench`, then audit the committed snapshot.
