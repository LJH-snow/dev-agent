# Desktop Runtime Trace Panel

- **Status:** complete
- **Date:** 2026-09-23
- **Primary surface:** `apps/desktop`

## Objective

Expose the existing bounded session trace endpoint in the Desktop Inspector.
The panel displays metadata-only model/tool spans so a local run can be timed
and inspected without showing prompt text, tool output, raw errors, paths, or
provider credentials.

## Contract

- `Trace` opens a compact panel in the Runtime Inspector and calls the existing
  `GET /api/sessions/<id>/trace`.
- The response validates `schemaVersion`, `metadataOnly`, `runs`, and
  `droppedRuns`; malformed payloads fail closed.
- Only run status, timestamps, duration, turn count, token counts, span kind,
  tool name, span status, and bounded dropped counters are rendered.
- Run IDs are visible but truncated; they contain no request content.
- Session switching aborts the previous request and stale responses are
  ignored.
- Unknown and legacy sessions use stable failure states; no absolute paths,
  tool inputs, outputs, or raw errors are displayed.

## Tasks

- [x] Add the localized `Trace` action, panel, refresh control, and styles.
- [x] Parse and render bounded trace runs/spans with stable status labels.
- [x] Add stale-session guards and reset the panel on new sessions.
- [x] Add focused UI contract coverage.
- [x] Run the full Desktop suite, TypeScript verification, and diff check.
- [x] Update Desktop README and architecture documentation.

## Completed

Completed on 2026-09-23. The Desktop Runtime Inspector now exposes the
metadata-only trace endpoint through a localized `Trace` panel. It renders
bounded run/span timing and status data, validates the payload fail-closed,
aborts stale requests, and resets for new, renamed, and deleted sessions.
No prompts, tool inputs, tool output, paths, credentials, or raw errors are
rendered.

Verification evidence:

- Focused trace UI contract: **1/1**.
- Full Desktop suite: **196/196**.
- CLI package-install smoke: passed.
- Full CLI suite: **561/561**.
- `pnpm verify:typescript`: passed all selected gates, including release,
  preview, CI, documentation, and native Desktop bundle contracts.
- `git diff --check`: passed.

## Out of scope

- No new telemetry transport or external trace vendor.
- No prompt/output/tool input serialization.
- No server contract change beyond the existing trace endpoint.
