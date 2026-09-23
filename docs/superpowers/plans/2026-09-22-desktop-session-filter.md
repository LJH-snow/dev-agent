# Desktop Session Discovery Filters

## Goal

Make a growing Desktop session list easier to scan without changing the
session API or transcript loading behavior.

## Scope

- Add a client-side session-id search field.
- Add a run-status filter for all, idle, running, waiting, done, failed, and
  aborted sessions.
- Keep the currently selected session available while a filter is active.
- Show a localized empty result message only when a non-empty filter has no
  matching summaries.
- Keep the controls keyboard accessible and responsive in the mobile rail.

## Out Of Scope

- No server-side filtering or new API fields.
- No transcript search.
- No persistence of filter values across tabs or reloads.
- No change to session switching, run recovery, or queue behavior.

## Verification

- Unit-test filtering order, case-insensitive ids, normalized statuses, and
  blank selectors.
- Verify the rendered HTML contract.
- Run the complete Desktop test suite.
- Use a real browser smoke against an ephemeral local port to exercise search,
  status filtering, language switching, and empty results.
