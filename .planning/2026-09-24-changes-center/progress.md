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

## 2026-09-25 — split-view polish and final verification

- Refined split rendering so adjacent deletions/additions pair into true
  left/right rows instead of duplicating change lines on both sides.
- Classified Git patch metadata (`# ... changes`, `index`, file-mode lines,
  rename/binary metadata) as full-width non-code rows.
- Made the split grid responsive while retaining horizontal overflow for long
  source lines; added helper assertions for metadata classification and row
  pairing.
- Targeted verification passed: **11/11** task-workspace integration and UI
  tests, Desktop typecheck, Desktop build, `node --check`, and `git diff --check`.
- Browser acceptance on an isolated temporary Git repository confirmed the
  three-file summary (`3 file(s) · +6 · −1`), status badges, path-only search,
  no-match message, Unified/Split state changes, and paired split rows.
