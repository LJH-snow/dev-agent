# Progress — Desktop workflow parity

## 2026-09-23
- Revalidated the current worktree and Desktop implementation before edits.
- Confirmed MCP graph resources/templates and Context7 MCP are unavailable in the current session; codebase search is used only as fallback.
- Read current official Git worktree documentation. No production edits yet; Phase 1 design and implementation remain in progress.

- Phase 1 worktree lifecycle implementation is present in the current tree: per-task linked worktrees/branches, persistent session-to-path binding, bounded status/diff, guarded merge/cleanup, and bilingual inspector actions.
- Re-ran the Desktop suite: 209/210 tests passed; the sole failure was `prompt-composition.test.ts` timing out while initializing an MCP server. Re-ran that test alone with MCP explicitly disabled (`DEV_AGENT_MCP_SERVERS=[]`): passed. The task-workspace API/UI tests all passed in the suite.
- Verified the browser flow using an isolated temporary Git repository and isolated session storage: create task → assigned task session → external change → refresh shows one changed file → Review diff shows README.md and the patch. Browser console: 0 errors / 0 warnings. Captured `/Users/Admin/Desktop/dev-agent/output/playwright/task-workspaces.png`.
- Shut down the browser/server fixture after visual validation; no production repository files were used as test data.
- Current date: 2026-09-23. Next: Phase 2 staged/unstaged-aware unified diff review.

- Phase 2 implementation now returns bounded committed/staged/unstaged/untracked sections and literal per-file diffs; browser UI provides group tabs, file selection, line-anchored comments, and insertion of selected task comments into the prompt. Staging arbitrary diff hunks was intentionally removed after edge-case evidence showed synthetic untracked-file patches can represent one full-file hunk and malformed/truncated application risks corrupting the index.
- Focused TypeScript build and task-workspace tests pass (8/8) with MCP servers disabled. `git diff --check` remains clean for scoped paths. Browser review validation in progress; earlier browser uncovered and fixed the accidental PointerEvent-as-file-name event binding.
- Phase 3 source audit: Desktop currently has no integrated terminal, PTY, preview-server, or iframe preview route/component. Existing agent shell tool is not exposed as a user-facing persistent terminal.
