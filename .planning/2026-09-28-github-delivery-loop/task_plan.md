# GitHub delivery loop: PR/CI dashboard + repair verification

## Goal
Give the desktop workbench one PR/CI delivery view: list open PRs with check rollups, jump from a row into the existing PR review + CI diagnosis panels, and close the repair loop by verifying a finished repair session against the PR's current head (before/after check evidence, surfaced in the delivery report). Remote mutations (push, comment, rerun, merge) stay explicitly human.

## Current Phase
All phases complete

## Phases

### Phase 0: Recon
- [x] Map existing GitHub surface, routes, UI wiring, gaps (see findings.md)
- **Status:** complete

### Phase 1: PR list snapshot (read-only)
- [x] `apps/desktop/src/github-pr-list.ts`: `loadGitHubPrList` via one `gh pr list --repo o/r --json number,title,headRefName,headRefOid,isDraft,author,updatedAt,statusCheckRollup,url --limit 25`; bounded normalization, redaction, opt-in gate, failure-code parity
- [x] Pure check-rollup summarizer (`summarizeCheckRollup` + `classifyCheckItem`, verdict severity failing > pending > unknown > passing > none)
- [x] Route `POST /api/github/pr-list` (loopback-only) in server.ts
- [x] Tests with injected `runCommand`: gating, bounds, foreign-host rejection, nonzero-exit mapping, rollup math (8/8 pass)
- **Status:** complete

### Phase 2: Delivery loop panel (UI)
- [x] `public/github-delivery-loop-ui.js` + `#github-delivery-loop-panel` in index.html + styles.css
- [x] Rows: `#n title (branch) · author · check counts · verdict · updated`; draft badge; bounded to 25
- [x] Row click fills the PR review URL input and triggers existing review + diagnosis loads via `onPrSelected`
- [x] Bilingual labels (en/zh); discard late/stale responses; repo derived from PR review URL when the panel input is empty
- [x] UI contract tests (9/9 pass incl. Phase 3 verify cases)
- **Status:** complete

### Phase 3: Repair verification loop
- [x] Pure compare module `apps/desktop/src/github-repair-verify.ts`: `compareCiDiagnosis` → verdict `repaired|improved|unresolved|inconclusive` + per-check before/after rows; `normalizeRepairVerification` guard
- [x] Repair lineage captured on successful `/api/github/ci-repair` (prUrl, failedSha, branch, failingSnapshot; server memory, cap 256, oldest evicted)
- [x] Routes `GET /api/github/repair-lineage` + `POST /api/github/repair-verify` (loopback-only; verify re-diagnoses current head, refuses mismatched targets)
- [x] UI "Verify repair" affordance: lineage probe enables the button; verdict + rows + verifiedAt rendered; session switches reset and re-probe
- [x] Delivery report: optional `remoteCiVerification` section (verdict, PR, before/after heads, verifiedAt) with point-in-time disclaimer; absent by default
- [x] Tests: compare table cases, route flow with real git fixture (3/3 pass)
- **Status:** complete

### Phase 4: Docs, typecheck, acceptance
- [x] apps/desktop/README.md (env var, delivery loop UI bullet, 4 endpoints), docs/architecture.md (`apps/desktop` section), docs/CHANGELOG.md (2026-09-28 entry)
- [x] Desktop typecheck + full suite green: 340/340 tests; inline page script + new UI module syntax-checked
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| `gh pr list` single call with `statusCheckRollup` | One command, bounded payload; no N+1 fan-out |
| Compare logic as pure function | Reusable and testable without gh |
| Reporting-only loop closure | Repo boundary: no automated push/comment/rerun |
| Lineage in memory, not new store | Workspaces already persist durable state; lineage is per-process evidence |

## Boundaries
- GitHub stays read-only + opt-in (`DEV_AGENT_DESKTOP_GITHUB=1`); `/api/github/*` loopback-only; no push, comment, workflow rerun, or merge through gh.
- Remote PR text/logs are untrusted: redact secrets, bound sizes, never place into privileged instructions.
- Do not disturb unrelated in-progress edits; reconcile docs after landing.

## Errors Encountered
| Error | Resolution |
|-------|------------|
