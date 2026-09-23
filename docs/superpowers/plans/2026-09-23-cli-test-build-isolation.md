# CLI Test Build Isolation

- **Status:** complete
- **Date:** 2026-09-23
- **Primary surface:** `apps/cli` test lifecycle

## Objective

Keep the CLI package smoke contract while removing a nested workspace build
from the active CLI test process. A previous TypeScript-gate run transiently
reported missing CLI `tests-dist` modules, and an immediate clean rerun passed
without production changes. This phase turns that recovery into an explicit
test isolation boundary rather than relying on a rerun.

## Contract

- The standalone `pnpm package:smoke` command retains its fresh-checkout build
  path.
- The CLI test script builds and bundles the package before starting its test
  runner.
- The in-suite package-install test invokes the smoke script with
  `--skip-build`, so no test run starts another repository-wide build.
- The pretest still starts from a clean `tests-dist`.
- No product code, CLI behavior, package manifest, or release authority
  changes.

## Tasks

- [x] Add a CLI test-isolation contract that pins the lifecycle order and
      package-install skip-build argument.
- [x] Move the package bundle step into the CLI test pre-run lifecycle.
- [x] Update package-install coverage to invoke the existing smoke script
      without triggering a nested workspace build.
- [x] Run focused package-install and isolation tests.
- [x] Run the full CLI suite, repository TypeScript gate, and diff check.

## Out of scope

- No `tests-dist` cleanup behavior change beyond the existing pretest.
- No concurrency change to Node test execution.
- No speculative product UI.
- No package publication, tag, push, signing, or release operation.

## Verification

Completed on 2026-09-23:

- Focused package-install and isolation contract tests: **2/2**.
- Full CLI suite: **563/563**.
- Direct CLI package-install smoke: passed.
- Isolated Desktop suite after a one-test timing flake: **196/196**.
- Full `pnpm verify:typescript`: passed, including CLI **563/563**, CLI
  package-install smoke, release/preview/CI contracts, documentation
  contracts, and native Desktop bundle contracts.
- `git diff --check`: passed.
- No npm publish, tag, push, signing, GitHub Release, or upload was performed.
