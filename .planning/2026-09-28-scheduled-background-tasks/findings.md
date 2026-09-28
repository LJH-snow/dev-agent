# Findings — Scheduled Background Tasks

Recon done 2026-09-28 via Explore agent; claims spot-checked against the working tree (post `ab62214`).

## Requirements
- Local scheduler so the desktop workbench can run bounded, mostly read-only jobs on a cadence (e.g., morning CI watch over open PRs) and keep a run history the user can inspect.
- Mutations stay human-gated; v1 ships read-only job kinds only.

## Research Findings

### No recurring timers exist yet
- Zero `setInterval` in `apps/desktop/src`. Only fire-once `setTimeout` + `.unref()` housekeeping (task-terminal.ts:218-220, task-validation.ts:385-388, server.ts approval deny timeout :3249-3261). A scheduler is the first recurring timer → must follow the `.unref()` pattern so it never keeps the process alive.
- No cron DSL anywhere. `packages/agent-core/src/scheduler.ts` `AgentTaskScheduler` (:65) is in-process, bounded-concurrency, explicitly *not* time-triggered.

### Concurrency and caps to respect
- `server.ts:350` `inFlight` Set: strictly one run per session (409). Sessions registry cap 256 (:338), repair lineage 256 (:349), workspaces 256 (task-workspaces.ts:12), parallel-run cards 256 (parallel-runs.ts:7-12).
- v1 read-only jobs avoid sessions/chat entirely → no `inFlight` interaction.

### Persistence precedents
- `task-workspaces.ts` state file `~/.dev-agent/desktop-workspaces/<repoKey>.json` (:217-218): ≤1MB, atomic tmp+rename.
- `task-presentation.ts` `TaskPresentationStore` sidecars in `<sessionsDir>/.desktop-tasks/` (:51-54): per-session JSON ≤8KB, atomic, cross-process safe — but fields are only `{title,pinned,archived,updatedAt}`; no scheduling metadata. Task center rows are session-scoped, so scheduled runs (session-less) should keep their own history rather than forcing session semantics.

### Delivery-loop endpoints reusable internally
- `loadGitHubPrList` / `loadGitHubCiDiagnosis` accept injected `runCommand` + `enabled` → callable directly from a job executor (no HTTP hop), still opt-in-gated.
- `POST /api/github/ci-repair` is the only confirm-gated mutation; pr-list/ci-diagnosis are read-only (server.ts:681-723, :571-604).

### Route gating patterns
- Loopback-only: `isLoopbackTerminalRequest` check block (server.ts:445-474). Mutations additionally require `x-dev-agent-capability` (:476-481). GitHub loaders require `DEV_AGENT_DESKTOP_GITHUB=1`.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Two schedule kinds only: `interval` (≥15 min) and `daily HH:MM` local | Bounded surface; no cron DSL to validate; matches product tone |
| v1 job kinds are read-only watchers (`ci-watch` first); agent-prompt schedules explicitly deferred | Agent runs cost money, need approvals/consent design; read-only watchers deliver the值守 value now |
| Jobs are session-free; run history lives in the schedules panel, not task center | Task center rows are session-scoped via TaskPresentationStore; forcing session semantics onto runs would distort both |
| Catch-up policy: at most ONE overdue run fires on boot, then schedule resumes | Prevents thundering catch-up after downtime without silently dropping cadence |
| Persisted registry mirrors task-workspaces JSON pattern (atomic tmp+rename, ≤1MB, cap 64 definitions, ≤20 runs/def ≤8KB) | House pattern, already proven cross-process |
| Injected clock (`now()`) + manual `tick()` in tests; no real timers in unit tests | Deterministic; the single real `setInterval` lives in server wiring only, `.unref()`ed |
| Jobs call loaders directly (injected `runCommand`), never via HTTP | Avoids loopback self-call complexity; same trust boundary |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| none yet | — |

## Resources
- Prior art: `.planning/2026-09-28-github-delivery-loop/` (route/UI/test patterns for GitHub-adjacent features)
- Test patterns: `apps/desktop/tests/github-pr-list.test.ts` (injected runner), `github-ci-repair.test.ts` (real git fixture), `task-workspaces.test.ts` (state file behavior)
