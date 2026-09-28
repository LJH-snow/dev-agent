# Progress Log

## Session: 2026-09-28

### Current Status
- **Phase:** all phases complete — implemented, tested, documented
- **Started:** 2026-09-28

### Actions Taken
- Recon (background Explore agent) recorded in findings.md; plan written
- Phase 1: `apps/desktop/src/scheduled-tasks.ts` — `ScheduledTaskManager` (persisted registry, caps, catch-up-once, run history, `runNow`), pure `computeNextRunAt`/`validateScheduleInput`/`normalizeScheduleDefinition`
- Phase 2: built-in read-only `ci-watch` runner in server.ts (direct loader reuse, opt-in gate honored), unref'd 60s tick + close cleanup + boot catch-up, six schedule routes
- Phase 3: `public/scheduled-tasks-ui.js` + panel HTML + styles + en/zh i18n, wired into the page render block
- Phase 4: README/architecture/CHANGELOG updates; full suite green
- Same session also closed the two documentation debts (handoffs Task 4 + worker-scoped-mcp progress) and created the Ink planning dir `2026-09-28-ink-tui-input-and-rendering` (plan only)

### Test Results
| Suite | Result |
|-------|--------|
| tests-dist/scheduled-tasks.test.js (scheduler core, fake clock) | 11/11 pass |
| tests-dist/scheduled-tasks-routes.test.js (CRUD/gating/opt-in) | 3/3 pass |
| tests-dist/scheduled-tasks-ui.test.js (panel contract) | 5/5 pass |
| Full desktop suite (`npm test` in apps/desktop) | 359/359 pass, ~75s |

### Errors
| Error | Resolution |
|-------|------------|
| `readFileSyncSafe` used `require()` (ESM) | Import `readFileSync` directly from `node:fs` |
| Test tsconfig (`strict: false`) does not narrow parameter-flow discriminated unions | `failCode` reads the discriminant via explicit shape cast |
| `update()` left the previous cadence's field behind (`intervalMinutes: 15` after switching to daily) | Destructure out both cadence fields before the spread, re-add only the active kind's field |
| UI tests: destructuring `nowMs` snapshotted the getter (assertions saw a stale clock) | Access `h.nowMs` dynamically |
| UI test clicked row buttons synchronously; busy gate dropped later actions | Call the exported methods with awaits between |
| Third `create()` failed because a successful create clears the title input | Re-set the title in the test before switching cadence |

### Notes
- Work is uncommitted; the user asks explicitly before pushes in this repo.
- Deferred by design: agent-prompt schedules (needs approvals/cost design), other job kinds.
