# Task plan — Desktop Security Center

## Goal

Extend the CLI Security Center slice to the Desktop workbench: a bounded,
read-only workspace scanner behind gated HTTP routes, a metadata-only audit
history, and a panel UI — without persisting or rendering prompts, raw scan
input/output, commands, credentials, absolute paths, environment values, or
raw errors.

## Slices

- [x] Slice A (commit `96f3037`): extract the scanner (`security-scan.ts`) and
      metadata-only audit history (`security-audit-history.ts`) into
      `@dev-agent/agent-core`; CLI keeps its `:security` parser plus
      re-export facades. Tests moved with the code. agent-core 238/238,
      CLI 842/842.
- [x] Slice B (commit `786e1f9`): Desktop `GET /api/security-center`
      (loopback-gated metadata-only snapshot) and `POST /api/security-scan`
      (loopback + capability token; default workspace or task-worktree
      session; unknown session fails closed with 404). Desktop suite 448/448.
- [x] Slice C: `public/security-center.js` panel (textContent-only rendering,
      stale-response guards, bounded findings display) wired into index.html
      with en/zh i18n and styles.css classes; panel-contract test added.
      Desktop suite 449/449.

## Boundaries honored

- Scan POST requires the desktop capability token (automatic for /api/ POST
  mutations); both routes join the trusted-loopback metadata gate family.
- History records stay allowlisted aggregate metadata; the immediate scan
  response may include finding locations/summaries (same as the CLI UX), but
  nothing from it is persisted.
- No shell, network, credential, or mutation capability added by the routes or
  the panel; the scanner never executes anything.
- Desktop autofix files and parallel-window work untouched; `.mimosa/` and
  `.zcode/` untouched.

## Verification

- [x] agent-core full suite 238/238; CLI full suite 842/842.
- [x] Desktop full suite 449/449 (includes route gating, token enforcement,
      metadata-only regex assertions, persistence, and the panel contract).
- [x] docs/architecture.md and docs/CHANGELOG.md updated; documentation
      contract re-run.
- [ ] Final `git diff --check`, path-scoped status, commit, push.

## Not claimed

- The scan remains a bounded static pass; audit history is not a runtime
  security proof. Per-session worktree scan selection, MCP metadata input on
  Desktop scans, and a clear-history action are deliberate follow-ups.
