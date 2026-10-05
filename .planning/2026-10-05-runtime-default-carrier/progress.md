# Progress — runtime default carrier 0.2.1

## 2026-10-05

- Problem: `apps/cli/src/runtime-command.ts` still defaulted
  `--runtime-release` to `0.1.6` while the current formal GitHub Release is
  `v0.2.1` (runtime identity `0.2.0`). A user running `dev-agent runtime
  install` without flags installed assets from the outdated carrier, and the
  README examples had to spell out `--runtime-release 0.2.1` explicitly.
- RED first: `apps/cli/tests/runtime-command.test.ts` now asserts
  `DEFAULT_RUNTIME_RELEASE_VERSION === "0.2.1"`, empty/blank flag fallback is
  `0.2.1`, and an explicit flag still wins. Confirmed failing against the old
  constant (6/7, one fail), then passing after the one-line change.
- Explicit `--runtime-release` precedence and the runtime-identity vs carrier
  separation are unchanged; `--runtime-version` still defaults to the
  runtime-manager `DEFAULT_RUNTIME_VERSION` (`0.2.0`).
- Docs: `apps/cli/README.md` flag description now states 0.2.1 is the built-in
  default; `docs/CHANGELOG.md` gained a 2026-10-05 unreleased section covering
  this fix and the Security Center audit-history slice.
- Verification: focused `runtime-command.test.js` 7/7; docs contract 60/60;
  full CLI suite 853/853.
- Not claimed: this changes which release assets a fresh install fetches; it
  does not change the published artifacts or the Rust runtime contract.
