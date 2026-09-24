# Findings — Changes Center 1.0

## Baseline

- `GET /api/workspaces/:sessionId/diff` already supports an optional literal `path` selector and returns bounded files, sections, and unified diff text.
- `apps/desktop/public/task-workspace-ui.js` already renders file selection, diff groups, line-level review comments, merge, and cleanup controls using `textContent`.
- The safest first slice is UI-only: do not add a browser staging/write route and do not alter worktree ownership.

## Design decisions

- Keep the existing unified renderer as the default for compatibility.
- Split view is a presentation mode over the already bounded patch; it must preserve the same line anchors for review comments.
- Summary counts are derived from the bounded payload in memory and are not persisted or sent back to the server.
- File search is local to the currently loaded diff and caps the rendered list to the server-provided file bound.


## 2026-09-24 — acceptance findings

- The existing server diff response already supplies enough bounded metadata for
  the first Changes Center slice; no endpoint or schema expansion was needed.
- Client-side search intentionally filters only the file list. The selected
  patch remains the server-provided bounded payload, so searching cannot alter
  diff contents or review-comment anchors.
- Split view renders the same parsed rows into two text-only cells. Hunk, file,
  header, and meta rows remain full-width; add/delete rows retain `+line` and
  `−line` anchors.
- Isolated browser evidence used a temporary repository with staged README and
  new-file changes. The UI showed `2 个文件 · +2 · −1`, then rendered split view
  and filtered the file list to `README.md`; no remote operation was performed.
