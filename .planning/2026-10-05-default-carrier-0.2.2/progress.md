# Progress — default carrier follows v0.2.2

## 2026-10-05

- After the v0.2.2 carrier release, the packaged default
  `DEFAULT_RUNTIME_RELEASE_VERSION` was still `0.2.1` and the runtime smoke's
  hardcoded carrier was `0.2.1`. Both still worked (0.2.1 remains published)
  but the no-flag install path no longer pointed at the newest carrier.
- RED first: `runtime-command.test.ts` now asserts the default is `0.2.2`
  (confirmed failing before the change), then the constant and the smoke
  constant moved to `0.2.2`.
- Docs: README examples and the built-in-default statement moved to 0.2.2;
  docs contract's `--runtime-release` assertion updated; contract 60/60.
- Verification: runtime-command tests 7/7; official `npm test` 842/842;
  `NODE_USE_ENV_PROXY=1 pnpm runtime:smoke -- --skip-build` passed using the
  0.2.2 carrier.
- Note: the shipped 0.2.2 npm package still carries the 0.2.1 default; this
  change rides the next package release. Explicit `--runtime-release` always
  wins, and v0.2.2 already works via the flag today.
