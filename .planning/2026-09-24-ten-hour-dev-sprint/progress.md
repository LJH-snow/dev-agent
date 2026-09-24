# Progress — dev-agent 10-hour sprint

## 2026-09-24 — baseline and plan

- Created the persistent ten-hour sprint plan under
  `.planning/2026-09-24-ten-hour-dev-sprint/`.
- Re-read the existing Desktop workflow plan, Gemini architecture alignment,
  current source, tests, and repository status.
- Confirmed the branch is based on GitHub commit `9a1e08f`; `.playwright-cli/`,
  `output/`, and the duplicate local planning directory are untracked local
  artifacts and remain excluded from delivery.
- Confirmed the current release-gate evidence from the previous completed
  slice, while treating it as a baseline rather than proof of this sprint's
  new requirements.
- Selected the first implementation slice: protect Desktop mutations with a
  server-scoped capability token, then harden terminal lifecycle/canonical cwd
  behavior.


## 2026-09-24 — terminal UX and capability boundary tranche

- Added bounded CLI mouse-wheel scrolling (`scrollBy` moves three wrapped rows; PageUp/PageDown remain page-sized) with a regression test. CLI suite is now **630/630**.
- Added session-local Desktop terminal command recall (64 entries, 4096 chars, deduplicated, draft restoration) without browser storage.
- Added Desktop manual-output-scroll preservation and explicit Follow latest control. Desktop suite is now **223/223** for the current UI changes.
- The production `startDesktopEntry()` path now opts into a server-scoped capability token. The token is injected only into served HTML and a central browser fetch seam sends it for same-origin mutation requests.
- Terminal/workspace mutation routes reject missing or incorrect tokens with a stable 403; direct `createDesktopServer()` hosts remain opt-in by default for compatibility, and a deterministic-token regression covers missing/wrong/valid requests and placeholder replacement.
- Current focused evidence: capability-token test and task-workspace tests pass. Full Desktop/release verification is still pending.


## 2026-09-24 13:22 — verification and delivery preparation

- Corrected the task-workspace test helper to send the new capability header for
  the session-rename mutation; the full Desktop suite now passes **224/224**.
- Desktop build and typecheck pass. The repository TypeScript release gate also
  passed, including the serialized workspace suites, CLI package-install smoke,
  preview contracts, documentation contracts, and native Desktop contracts.
- CLI remains **630/630**. `git diff --check` passes.
- The remaining work in this turn is a final staged-diff review followed by a
  commit and push. Browser/PTY manual acceptance and terminal canonical-cwd /
  lifecycle hardening remain explicitly deferred to later sprint slices.
- `.playwright-cli/`, `output/`, and the duplicate local planning directory are
  intentionally excluded from the commit.
