# Findings

- Current Desktop server already has loopback-only metadata endpoint protection for `/api/capabilities/*`, `/api/mcp/health`, and `/api/parallel-runs`.
- Existing GitHub capability probing is metadata-only and explicitly mutation-disabled.
- The UI is static HTML plus browser modules loaded from `public/*.js`; scripts are served from `server.ts`'s public resolver.
- Existing Changes Center/task workspace flows insert review comments into the composer through DOM-safe text assignment.
- Worktree contains unrelated uncommitted CLI, settings, task-validation, task-template, Playwright, and output changes; future commits must use a separate Git index or path selection.
- `gh pr view --json` and `gh pr diff --patch` provide the read-only metadata/diff inputs needed for this bounded adapter; no `gh pr review` or `gh pr comment` command is used.
- The PR Review route accepts only `sessionId` plus a URL or owner/repo/number fields, rejects unknown fields, and sanitizes loader results before responding.
- The browser module invalidates late responses when a PR is cleared or the active session changes, and local notes are scoped to the normalized PR URL.
