# Task plan — GitHub Release v0.2.1 verification

## Goal

Close the distribution loop after the authorized npm 0.2.1 publication by creating
and verifying the matching GitHub tag/release, four-platform Rust runtime assets,
checksum sidecars, manifest, and registry clean-install behavior.

## Boundaries

- The user authorized the `v0.2.1` tag/release flow in this session.
- Do not touch `.mimosa/`, `.zcode/`, parallel-window autofix files, or unrelated
  Ink/editor work.
- Keep npm/CLI version, GitHub carrier release, and Rust runtime contract as
  separate version fields: CLI/carrier `0.2.1`, runtime identity `0.2.0`.
- Do not persist prompts, raw command output, credentials, absolute temporary paths,
  or raw network errors in the ledger.

## Verification slices

- [x] Confirm current HEAD and absence of an existing `v0.2.1` tag.
- [x] Create and push annotated tag `v0.2.1`.
- [x] Verify release workflow `37215824488` succeeds.
- [x] Verify the formal non-draft GitHub Release and its 10 expected assets.
- [x] Download the four runtime archives and independently verify SHA-256 sidecars.
- [x] Verify the published runtime manifest identifies `v0.2.1` and four supported targets.
- [x] Run an isolated npm registry clean-install smoke for CLI 0.2.1 and managed
      runtime identity 0.2.0 carried by release 0.2.1.
- [x] Update current release documentation and documentation-contract assertions.
- [x] Run focused documentation/release tests, inspect the diff, commit only this
      documentation ledger slice, and push the branch.

## Evidence boundary

The workflow and asset checks prove release packaging and distribution integrity,
not general runtime security. The runtime health check is bounded and uses the
published binary; it is not a replacement for the real Rust integration suite.
