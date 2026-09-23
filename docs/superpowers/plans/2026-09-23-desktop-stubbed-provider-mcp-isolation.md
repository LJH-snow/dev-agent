# Desktop Stubbed-Provider MCP Isolation

- **Status:** complete
- **Date:** 2026-09-23
- **Primary surface:** `apps/desktop` test isolation

## Objective

Keep provider-stubbed Desktop validation tests independent of the host's
configured MCP servers. The same failure class previously affected CLI and
Desktop approval tests: a local MCP configuration could make an unrelated
assertion appear to fail behind a 30-second `initialize` timeout.

## Contract

- The Desktop validation test helper owns `DEV_AGENT_MCP_SERVERS`.
- Stubbed-provider tests default to an empty MCP configuration.
- An explicit test-provided MCP value can still override the default.
- No production Desktop behavior, MCP semantics, validation behavior, or SSE
  contract changes.

## Tasks

- [x] Add an isolated Desktop validation contract for helper-owned MCP config.
- [x] Default stubbed-provider validation tests to `DEV_AGENT_MCP_SERVERS=[]`.
- [x] Preserve the helper's ability to accept an explicit MCP override.
- [x] Run focused validation tests, the full Desktop suite, the TypeScript
      gate, and diff checks.

## Out of scope

- No production MCP loading change.
- No new Desktop feature.
- No timeout policy or retry behavior change.
- No npm publish, tag, push, signing, GitHub Release, or upload.

## Verification

Completed on 2026-09-23:

- Focused Desktop validation suite: **12/12**, including the new isolation
  contract.
- Full Desktop suite: **197/197**.
- Full CLI suite: **563/563**.
- CLI package-install smoke: passed.
- Full `pnpm verify:typescript`: passed all selected release, preview, CI,
  documentation, and native Desktop bundle contracts.
- `git diff --check`: passed.
- No npm publish, tag, push, signing, GitHub Release, or upload was performed.
