# Task plan — overnight round 2026-10-06

## Goal

Overnight autonomous development plan. All slices are executable without user
interaction; everything is verified per-slice (RED first where behavior
changes), committed and pushed per the standing overnight authorization
("完成之后，你可以把所有的改动先git add然后commit，然后push" — same pattern as
the 2026-09-28 overnight round the user approved).

## Explicit exclusions (require the user's separate authorization)

- npm publish of any version.
- Creating the `v0.2.3` GitHub carrier tag/release.
- Creating the `RUNTIME_MANIFEST_SIGNING_KEY` secret or any key ceremony step.
- Migrating npm publication into CI (provenance governance decision).

## Slices

- [x] **A. Session-list failure isolation (bug fix).** In
      `apps/desktop/public/security-center.js`, `loadSessions()` currently
      runs inside `refresh()`'s try — a failed `/api/sessions` fetch marks the
      whole panel as errored even when the security history itself loaded.
      Make `loadSessions()` non-fatal (own try/catch, returns a boolean, sets
      a scoped note via `securityCenter.sessionError`), keep selection stable,
      and pin the behavior with contract assertions.
      → Done, commit `07e5dad`; first real DOM-behavior tests (2/2 RED first);
      desktop suite 452/452.
- [x] **B. Doctor reports manifest signature verification.** The doctor's
      managed-runtime section gains the `manifestVerification`
      ("enabled"/"not-configured") state that `runtime status --json` already
      carries (RED test first in the doctor/health-check suite).
      → Done, commit `5c6182a`; JSON report + text facts line; 36/36.
- [x] **C. `:security clear` CLI command (two-step, explicit).** Parity with
      the Desktop clear-history route: `:security clear` reports the current
      record count and instructs the confirmation form; `:security clear
      confirm` performs `SecurityAuditHistoryStore.clear()` and reports the
      result. RED tests for the parser and the handler; metadata-only
      boundary unchanged.
      → Done, commit `279cc8d`; integration test exercises the full flow with
      an isolated `DEV_AGENT_SESSION_DIR`; parser suite green.
- [x] **D. Key-ceremony documentation.** `docs/runtime-manifest-signing.md`:
      how to generate the Ed25519 keypair, store the private PEM as the
      `RUNTIME_MANIFEST_SIGNING_KEY` secret, pin the public key for
      `DEV_AGENT_RUNTIME_MANIFEST_PUBLIC_KEY`, and what stays inert until
      then. Link from the CLI README signing section; documentation-contract
      assertions pin the new doc.
      → Done, commit `6e89464`; contract 61/61 including a no-private-key-body
      guard.
- [x] **E. Final validation and ledger.** Focused suites per slice; full CLI,
      desktop, agent-core, and runtime-manager suites; documentation
      contract; `git diff --check`; path-scoped status review; per-slice
      commits pushed; closing Mimosa deep scan recorded in this ledger.
      → Workspace suite: desktop 452/452, agent-core 239, runtime-manager 29,
      executor 61, model 15, evidence 159, CLI 844/844 on isolated rerun
      (two known PTY timing flakes under full-workspace load, none on rerun,
      no assertion loosened). Closing scan recorded in progress.md.

## Boundaries

- Metadata-only persistence everywhere; no new prompt/command/path/credential
  retention.
- All external content untrusted; bounded, fail-closed handling.
- No broad reset/restore/checkout/clean/stash; parallel-window files
  (`.mimosa/`, `.zcode/`, Desktop autofix) untouched.
- Static scans and audit history are never described as runtime security
  proofs.
- Failure notes record real causes; no plan-completion equals code-completion
  claims.
