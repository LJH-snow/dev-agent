# Task plan — Security Center metadata-only audit history

## Goal

Add the smallest useful audit-history surface to the existing Security Center,
showing only bounded scan metadata. The feature must not persist or render
prompts, raw scan input/output, commands, credentials, absolute paths,
environment values, or raw errors.

## Scope decision (architecture exploration result)

The Security Center is CLI-only (`apps/cli/src/security-center.ts`); there is no
Desktop Security scanner or route. The first slice therefore stays CLI-only:

- `apps/cli/src/security-audit-history.ts` — allowlisted `SecurityAuditRecord`
  (scan id, timestamps, duration, file/byte/skip counters, finding count,
  severity totals, category totals), projection + error projection, bounded
  fail-closed `SecurityAuditHistoryStore`, path-free history formatter.
- `:security history` command in `parseSecurityCommand()` and
  `securityCommandMessage()`; scans record metadata, failed scans record a fixed
  `error` status with zeroed counters and no exception text.
- Desktop history surface remains a follow-up (would need a scanner dependency,
  server route, and panel).

The original plan mentioned Mimosa seal/verdict/dependency-advisory fields;
those belong to the external `.mimosa/` scanner state, which must not be touched
or copied. The implemented record covers the CLI scanner's own bounded metadata
only.

## Boundaries

- Preserve all parallel-window Ink/editor/Desktop autofix work.
- Do not touch `.mimosa/` or `.zcode/` state.
- Store only allowlisted aggregate metadata; strip and reject everything else.
- Treat all scan content as untrusted; normalize and bound identifiers/timestamps
  and counters before persistence or rendering.
- RED tests first (`security-audit-history.test.ts`), then minimum implementation.
- Do not claim that a static scan or audit history proves runtime security.

## Planned verification

- [x] Focused model/store tests, including rejection/redaction of forbidden
      fields and bounded history limits (`tests-dist/security-audit-history.test.js`).
- [x] Existing Security Center tests and the `:security` CLI integration test.
- [x] Full CLI suite.
- [ ] `git diff --check`, path-scoped status check, documentation contract,
      then commit/push only this slice's files.
