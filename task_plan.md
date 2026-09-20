# dev-agent project focus task plan

## Goal

Shift the next work slice away from CLI polish and back to the shared project
surface. Use Desktop status as the first bounded project-level phase.

## Phases

### Phase 1: Desktop managed runtime status (complete)

- Extend the Desktop status snapshot with a safe `managedRuntime` summary.
- Read managed runtime state without exposing binary paths or raw errors.
- Show managed runtime state in the Desktop status panel.
- Cover snapshot, API, and UI contract tests.

### Phase 2: Verification and docs (complete)

- Run focused Desktop tests.
- Run the TypeScript release gate.
- Update Desktop docs, CHANGELOG, and the roadmap decision record.

## Result

The shared project surface now includes an offline, metadata-only managed
runtime summary in Desktop status. The implementation is verified by focused
Desktop/runtime-manager tests and the full TypeScript release gate. No release
tag, npm publish, or push was performed.

## Phase 3: Eight-hour input-boundary hardening (complete)

The next eight-hour slice follows the 2026-09-20 audit and closes the five
reproducible `FIX` findings without disturbing the completed Signal Loom TTY,
Web Desktop, or native macOS shell work.

- [x] Write the executable plan at
      `docs/superpowers/plans/2026-09-20-eight-hour-hardening.md`.
- [x] Preserve and baseline the existing in-flight MCP error-response change.
- [x] Bound CLI session listing with an explicit 256-entry JSON contract.
- [x] Bound doctor command-version and Rust-probe subprocess output.
- [x] Bound FilesystemTool write and generated postimage bytes.
- [x] Synchronize audit/docs and run the full verification gates.

Verification completed on 2026-09-20:

- `pnpm build` passed.
- `pnpm verify` passed, including CLI 383/383, Desktop 138/138,
  documentation contracts 57/57, and real Rust integration 11/11.
- Swift package tests passed 8/8; native app launch verification and
  `Info.plist` lint passed.
- The five reproducible audit findings are closed. Four `NEEDS-EVIDENCE`
  decisions remain open.

### Phase 4: Input-boundary closure (verification in progress)

The 2026-09-20 follow-up plan at
`docs/superpowers/plans/2026-09-20-input-boundary-closure.md` closes the four
remaining input-boundary decisions with fixed, non-configurable contracts.

- [x] Cap cumulative provider stream output at 16 MiB of UTF-8 bytes.
- [x] Bound code-search/index discovery at 100,000 files and 256 MiB of
      eligible source bytes.
- [x] Preserve the previous index when discovery or serialized write-back
      exceeds its limit.
- [x] Make rollback directory inspection asynchronous and early-exit.
- [x] Deny CLI approval input over 4 KiB before the first newline.
- [ ] Run the final workspace, Rust, and native macOS gates.
- [ ] Push the feature branch after the final review.
