# Scheduled background tasks: local scheduler + read-only watchers

## Goal
Give the desktop workbench a bounded local scheduler: persisted task definitions on `interval` or `daily HH:MM` cadences, a first read-only `ci-watch` job that reuses the delivery-loop loaders to summarize open-PR CI state into a run history, right-rail UI to manage schedules and inspect runs — with mutations human-gated and no automated GitHub or agent-prompt actions.

## Current Phase
All phases complete

## Phases

### Phase 0: Recon
- [x] Map parallel-runs, workspaces, task center persistence, CLI jobs, timer precedents, gating constraints (see findings.md)
- **Status:** complete

### Phase 1: Scheduler core (pure + persisted registry)
- [x] `apps/desktop/src/scheduled-tasks.ts`: definition validation + `computeNextRunAt` for `interval` (15..10080 min) and `daily HH:MM` (local wall clock); injected `now()`
- [x] `ScheduledTaskManager`: persisted JSON registry (`~/.dev-agent/desktop-schedules/<repoKey>.json`, atomic tmp+rename, ≤1MB), caps 64 definitions, create/update/enable/disable/remove; catch-up-once emerges from advancing `nextRunAt` from the fired-at moment
- [x] Per-definition run history: ≤20 records, ≤8KB summaries, persisted alongside; `runNow(id)` for manual out-of-band runs with overlap guard
- [x] Unit tests with fake clock: 11/11 pass
- **Status:** complete

### Phase 2: ci-watch job + server wiring
- [x] Read-only `ci-watch` runner: direct `loadGitHubPrList` → `loadGitHubCiDiagnosis` (≤3 failing PRs); bounded digest (openPrs, failingCount, per-PR verdict/failedChecks); opt-in-gated, `opt-in-required` recorded as a failed run when GitHub is disabled
- [x] server.ts wiring: single 60s tick `setInterval(...).unref()` + cleared on server close + boot catch-up tick; `GET /api/schedules`, `GET /api/schedules/:id/runs` loopback-only; `POST /api/schedules`, `POST /api/schedules/:id`, `POST /api/schedules/:id/run`, `DELETE /api/schedules/:id` capability-token gated (automatic via /api/ mutation rule)
- [x] Route tests: CRUD + manual run with injected runner, capability/loopback gating, default-runner opt-in recording, persistence round-trip — 3/3 pass
- **Status:** complete

### Phase 3: Schedules panel (UI)
- [x] `public/scheduled-tasks-ui.js` + `#scheduled-tasks-panel` in index.html + styles.css: definition rows with next/last-run status, create form (title, repo, interval/daily switch), per-row run-now/enable/history/remove, bounded history list
- [x] Bilingual labels (en/zh); late-response discard; capability token injected by the page-wide fetch wrapper
- [x] UI contract tests — 5/5 pass
- **Status:** complete

### Phase 4: Docs, typecheck, acceptance
- [x] apps/desktop/README.md (how-it-works bullet + 6 endpoint entries), docs/architecture.md, docs/CHANGELOG.md (2026-09-28 entry)
- [x] Desktop typecheck clean; full suite 359/359 pass (~75s); inline page script + new UI module syntax-checked
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| `interval` ≥15min + `daily HH:MM` only | Bounded validation surface; no cron DSL |
| v1 = read-only watchers only; agent-prompt schedules deferred | Agent runs need an approvals/cost consent design of their own |
| Session-free jobs; history in the schedules panel | Task center rows are session-scoped; don't distort either model |
| Catch-up on boot: at most one overdue run | Bounded, no silent cadence drop |
| Registry persistence mirrors task-workspaces JSON pattern | Proven atomic cross-process house pattern |
| Injected clock + manual tick in tests | Deterministic; single real unref'd interval in wiring only |

## Boundaries
- No automated GitHub mutations (push/comment/rerun) and no automated agent-prompt runs in v1; watchers only read.
- GitHub loaders stay opt-in (`DEV_AGENT_DESKTOP_GITHUB=1`); schedule routes loopback-only; create/delete need the capability token.
- All persisted/serialized content bounded, redacted, atomic; timers never keep the process alive (`.unref()`).
- Do not disturb unrelated in-progress edits; reconcile docs after landing.

## Errors Encountered
| Error | Resolution |
|-------|------------|
