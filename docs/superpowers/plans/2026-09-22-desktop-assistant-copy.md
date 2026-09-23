# Desktop Assistant Response Copy

- **Status:** complete
- **Date:** 2026-09-22
- **Primary surface:** `apps/desktop` local web workbench

## Objective

Give each assistant response segment a small bilingual copy action without
changing transcript ordering, session isolation, or the existing manual-scroll
behavior.

## Scope

- Prefer the asynchronous browser clipboard API.
- Fall back to a temporary textarea when clipboard permission is unavailable.
- Keep the copy action attached to the exact assistant segment that created it.
- Refresh copy, copied, and failure labels when the language toggle changes.
- Ensure completed turns do not expose queued-turn actions.

## Verification

- Clipboard helper and Desktop HTML contract tests.
- Full Desktop test suite.
- Browser smoke with a provider-stubbed SSE response, clipboard readback,
  bilingual label refresh, hidden completed-turn actions, and zero console
  errors.
- `git diff --check` and the workspace TypeScript gate.
