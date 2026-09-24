# Progress — Changes Center 1.0

## 2026-09-24 — tranche started

- Confirmed the existing Desktop already has bounded task-workspace diff APIs, file/group filters, safe unified diff rendering, and review comments.
- The next visible increment is therefore a client-side Changes Center upgrade: summary metrics, bounded file search/status badges, and a Unified/Split view toggle.
- The existing server mutation and worktree boundaries will remain unchanged.


## 2026-09-24 — implementation closure

- Implemented the Changes Center presentation slice without adding server
  mutation routes: summary metrics are derived from the bounded diff in memory,
  file search is capped and path-only, and status badges use text nodes.
- Added safe split rendering that keeps unified diff anchors available for
  review comments. Unified remains the default view.
- Browser acceptance against a temporary Git fixture confirmed the summary,
  split view, and README-only file filter.
- Desktop verification: **236/236** tests, build, and `git diff --check`.
