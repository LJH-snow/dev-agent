# Progress

## 2026-09-25

- Started after MCP health checks were committed and pushed to `0f13190`.
- Confirmed the current branch also contains the CLI viewport commit `8567d4a`; the active marker belongs to that parallel task and was not changed.
- Confirmed the existing `DesktopRunRegistry`, `/api/sessions`, run replay route, and session activation UI are reusable building blocks.

## 2026-09-25 — implementation and verification

- Added bounded `ParallelRunsSnapshot` normalization with session/run limits, safe stage derivation, duration caps, and metadata-only tool/approval projection.
- Added loopback-only `GET /api/parallel-runs` with response-size protection and session-bound run registry data.
- Added bilingual Desktop panel with 2.5-second refresh, stale-request cancellation, safe text rendering, and click-to-focus session actions.
- Focused suite passed 4/4 and TypeScript compilation passed.
- Desktop full suite previously reached 253/254: the only failure was the existing `scroll-follow.test.ts` contract against concurrent uncommitted auto-follow changes in `apps/desktop/public/index.html`; no parallel-run test failed.
- Isolated the parallel-only snapshots for `server.ts`, `index.html`, and `styles.css` so unrelated Task Validation, CLI viewport, settings, and output changes remain unstaged.
- Verified the focused suite again: 4/4 passed.
- Committed the parallel-run feature with a separate Git index and pushed it to `origin/codex/desktop-cli-workbench`.

- Final verification after the concurrent Desktop edits settled: Desktop build/typecheck passed; focused parallel-run tests passed 4/4; complete Desktop suite passed 255/255. The earlier 253/254 result was caused by the unrelated auto-follow contract and is now resolved by the updated scroll-follow assertion.
