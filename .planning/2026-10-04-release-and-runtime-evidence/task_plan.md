# Task plan — release 0.2.1 and runtime evidence

## Goal

1. Publish `@agent_cli/cli@0.2.1` following the documented release governance
   (`docs/release-cli-npm.md`): version bump, `docs/release-state.json`
   candidate update, `pnpm release:preflight`, gated
   `pnpm release:publish -- --publish`, registry verification, state sync.
   User explicitly approved this release on 2026-10-04.
2. Add runtime-level evidence for the security round: run the real Rust
   sandbox integration suite (`pnpm --filter @dev-agent/executor
   test:integration`) against the locally built runtime, then harden managed
   runtime cache directory ownership/mode validation (the deferred residual
   from the 2026-10-04 hardening ledger).

## Boundaries

- No GitHub Release / Git tag creation (project convention: separate
  authorization; not part of this round).
- Only stage files belonging to this round; never touch `.mimosa/`, `.zcode/`,
  parallel-window autofix files.
- RED test first for the runtime-manager hardening.
- Do not describe the static rescan or these tests as "the project is secure".
