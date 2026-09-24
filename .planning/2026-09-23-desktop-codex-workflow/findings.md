# Findings — Desktop workflow parity

- MCP graph resources and templates are unavailable in this session; use repository source/tests as fallback evidence.
- Existing Desktop supports multiple session IDs and per-session serialization, but the default session factory constructs `new ChatSession({ sessionId })`; `ChatSession` defaults its working directory to `process.cwd()`. No Desktop worktree picker/manager exists in the current UI.
- Existing UI/backend already has session filters, prompt queueing, MCP integration, Plan/Review/Apply/Validate/Undo, checkpoints, run replay/trace, and Markdown export. Preserve these contracts.
- The shared worktree contains extensive unrelated modifications, including Desktop source and tests. Do not reset files or use broad restore/stash operations.
- Git official `git-worktree` docs provide stable `--porcelain` listing, `add -b` creation, and guarded `remove` behavior. In particular, ordinary removal refuses dirty working trees; never use `--force` for user task cleanup.
- Context7 MCP tooling is not exposed in the current tool list; use official Git documentation as the primary source when necessary.

- Phase 1 runtime validation passed in a temporary Git repository; browser evidence is in `output/playwright/task-workspaces.png`. The initial manual browser session surfaced existing persisted conversations because it used the default session directory; it was immediately closed and rerun with isolated `DEV_AGENT_SESSION_DIR` and `DEV_AGENT_MEMORY_FILE`, and no persisted conversation content was used in the final evidence.
- Full Desktop test suite reached 209/210; the remaining MCP initialization timeout is unrelated to workspace code and the exact prompt-composition test passes when MCP servers are disabled.
- Phase 2 gap confirmed: the current task diff endpoint returns one combined patch and a flat path/status list. It does not identify staged vs unstaged vs committed changes, nor offer file-level navigation or hunk selection.

- Hunk staging experiment: `git apply --cached` for synthetic untracked patches staged full-file content because untracked diffs have one hunk; selective hunk acceptance is therefore not implemented with this approach. We removed the endpoint and control rather than ship an unsafe pseudo-selective action.
- Phase 2 browser visual: task file list, staged/unstaged/untracked tabs and file-specific diff selection worked. The screenshot was not yet refreshed after line-comment UI addition.
- Phase 3 audit via source search confirmed no Desktop terminal/preview implementation or terminal dependency; only agent tool execution and unrelated validation previews exist.
