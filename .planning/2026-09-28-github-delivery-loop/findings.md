# Findings — GitHub Delivery Loop

Recon done 2026-09-28. All claims checked against current working tree (post `6e607a7`).

## Requirements
- Single PR/CI delivery view in the desktop workbench: list open PRs with check rollups, jump from a row into existing PR review + CI diagnosis panels.
- Close the repair loop: after a repair session lands and the user pushes, re-check remote CI and show before/after check evidence in the panel and delivery report.
- Remote mutations (push, comment, rerun, merge) stay explicitly human — feature is reporting only.

## Research Findings

### Existing GitHub surface (apps/desktop)
- `src/github-pr-review.ts` (529 ln) — `loadGitHubPrReview` (:280) runs `gh pr view <n> --json` + `gh pr diff <n>`. Target parsing `normalizeGitHubPrTarget` (:155) accepts URL / `owner/repo#n` / `{owner,repo,number}`; rejects non-github.com hosts. Bounded snapshot ≤768 KiB. Opt-in gate `process.env.DEV_AGENT_DESKTOP_GITHUB === "1"` (:286).
- `src/github-ci-diagnosis.ts` (148 ln) — `loadGitHubCiDiagnosis` (:83): `gh pr view` (headRefOid) → `gh pr checks --json` → `gh run list --commit <sha>` → `gh run view --log-failed` for ≤3 failed runs. Re-checks head SHA after collection; `stale` verdict if PR moved (:132-143). Secret/token/Bearer log redaction + ≤24 KiB caps (:11-21).
- `src/capabilities.ts` — `probeGitHubCapability` (:103) `{enabled, cliAvailable, authenticated, mutationAllowed: false, ci}`; `ghAuthStatus` (:456) shells `gh auth status`. Auth via local gh CLI only; no tokens read.
- `src/delivery-report.ts` (114 ln) — `buildDeliveryReport` (:53) readiness `ready|attention|blocked|running`; `renderDeliveryReportMarkdown` (:96) explicitly disclaims remote CI ("does not attest to remote CI or deployment", :109).
- `src/task-workspaces.ts` (694 ln) — `DesktopTaskWorkspaceManager.create(expectedBaseCommit?)` (:279): branch `dev-agent/<sessionId>`, worktree under `~/.dev-agent/worktrees/<repoHash>/<sessionId>`, cap 256, persisted `~/.dev-agent/desktop-workspaces/<hash>.json`. `diff` (:332) grouped ≤192 KiB; `merge` (:456, `--no-ff`); `cleanup` (:488).

### Routes (src/server.ts, 3624 ln)
- POST `/api/github/ci-repair` (:477) — double-verifies remote failed at expectedSha + local HEAD match, creates workspace + session; 201 `{sessionId, branch, headSha, localValidation:"not-run", remoteCi:"failed-at-confirmed-head", requiresReview}`.
- POST `/api/github/ci-diagnosis` (:537), POST `/api/github/pr-review` (:572), GET `/api/capabilities/github` (:645).
- Workspaces: GET/POST `/api/workspaces` (:1234/:1241), GET `/api/workspaces/:id/diff` (:1272), POST `.../merge` (:1304), DELETE `.../:id` (:1330).
- Auth: `/api/github/*` loopback-only (:436-450); mutations need `x-dev-agent-capability` token (:452-457).

### UI wiring (public/)
- `#github-pr-review-panel` (index.html:624) and `#github-ci-diagnosis-panel` (:665) are separate panels sharing the PR URL input. Task worktree panel `#task-workspace-panel` (:477) has diff viewer + merge/cleanup.
- `github-ci-diagnosis-ui.js` `startRepair` (:117-151): re-diagnose → confirm → POST ci-repair → activate new session → pre-fill plan-mode prompt with redacted CI context; user must submit.
- Task center (`task-center.js`) groups sessions with statuses `idle|running|waiting|done|failed|aborted`.
- **No combined PR+CI view.** Panels adjacent only.

### Gaps this feature closes
1. No PR listing — `gh pr list` appears nowhere in the repo; only single-PR fetch.
2. No loop closure — after repair + (human) push, nothing re-checks remote CI; CI status is pull-only via manual "Diagnose"; delivery report always disclaims remote CI.
3. No lineage — the ci-repair response is not persisted anywhere linking taskSessionId → failedSha → PR.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| `gh pr list --json` single call incl. `statusCheckRollup`, no per-PR fan-out | Keeps snapshot bounded and one-command cheap |
| Verification before/after comparison as a pure function | Testable without gh; route only wires IO |
| Loop closure is reporting only (no push/comment/rerun) | Matches repo boundary; `mutationAllowed:false` stays |
| Repair lineage in server memory keyed by sessionId (workspace manager already persists workspaces) | Avoids new store; lineage is per-process evidence, workspaces carry the durable state |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| none yet | — |

## Resources
- Prior plan: `.planning/2026-09-26-delivery-ci-workflow/` (all phases complete; repair execution already exists — do not re-implement, only wrap).
- Test patterns to mirror: `apps/desktop/tests/github-ci-diagnosis.test.ts` (injected `runCommand`), `github-ci-diagnosis-ui.test.ts`, `task-workspaces-ui.test.ts` (bilingual contract), `github-ci-repair.test.ts` (fail-closed gating).
