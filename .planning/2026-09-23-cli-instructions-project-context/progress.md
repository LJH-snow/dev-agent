# Progress

## 2026-09-23
- Implemented bounded project-root detection and layered user/root/nested `AGENTS.md` loading with scope and precedence labels, symlink avoidance, freshness tracking, and a refreshable in-memory snapshot.
- Added a concise, sanitized project fingerprint and stack-specific defaults; ordinary repository content and `@` attachments remain reference material, not instructions.
- Wired project context into standard CLI, ACP, A2A, and collaborative prompt flows. Added `:project [refresh]` and `:instructions [refresh]` to interactive renderers/help/completion and documented behavior.
- Corrected a symlink test fixture so its outside directory is genuinely outside the detected project root. Improved nested-scope wording to avoid an awkward extra slash.
- Added ACP/A2A integration assertions confirming each protocol includes project instructions and metadata in the actual model system prompt.
- Verification: strict standalone TypeScript check passed; all 7 focused context/interactive/ACP/A2A tests passed; `git diff --check` passed.
- Full CLI typecheck/build is not clean due to the existing out-of-scope `traceTimings` reference at `apps/cli/src/index.ts:4650`. The compiler emitted the updated runtime files, enabling the focused integration tests. No changes were made to the speed feature.
