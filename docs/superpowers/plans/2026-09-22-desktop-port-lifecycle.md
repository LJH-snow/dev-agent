# Desktop Port Lifecycle Hardening

- **Status:** complete
- **Date:** 2026-09-22
- **Owner:** Signal Loom / Dev Agent
- **Primary surface:** `apps/desktop` local web entrypoint

## Problem

The Desktop entrypoint attempted to bind the configured port and surfaced a raw
`EADDRINUSE` failure when another process already owned it. That left an
external launcher free to choose a different port, which made the browser URL
drift from `4317` to `4318` or later without an explicit user decision.

## Scope

- Keep the requested port fixed; never auto-increment it.
- Reuse an existing healthy dev-agent workbench on that exact port.
- Refuse unrelated port owners with an explicit remediation message.
- Keep native macOS launch behavior unchanged; its existing launcher already
  cleans up its own marked server before starting.

## Implementation closure

- Added `apps/desktop/src/launcher.ts` with endpoint validation, bounded health
  probing, healthy-instance reuse, and fixed-port conflict errors.
- Updated `apps/desktop/src/index.ts` to use the launcher and report whether it
  reused an existing instance.
- Suppressed the generic server-level log for the expected `EADDRINUSE` path.
- Documented the fixed-port behavior in `apps/desktop/README.md`.
- Added two process-level tests covering healthy reuse and unrelated-port
  refusal.

## Verification

- Port lifecycle tests: **2/2**.
- Desktop suite: **152/152**.
- Rich TUI evaluations: **8/8**.
- CLI suite: **538/538**.
- `pnpm verify:typescript`: all selected gates passed.
- `git diff --check`: passed.
