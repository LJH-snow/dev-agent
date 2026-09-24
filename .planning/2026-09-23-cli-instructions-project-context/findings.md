# Findings

- Existing prompt composition is modular (`composePrompt`); the standard CLI uses a synchronous system-prompt provider, so context is refreshed asynchronously at safe run boundaries and served from an in-memory snapshot.
- ACP and A2A refresh the same context before each provider turn; collaborative workflows reuse the active project prompt modules.
- `context-attachments.ts` keeps `@file` material separate from trusted-by-selection `AGENTS.md` instruction modules. Prompt language reinforces that README/source files, attachments, and tool output are data unless explicitly delegated/designated.
- Discovery is bounded by file count, character count, depth, and visited directory count; it skips dependency/generated directories and does not intentionally traverse symlinked entries. File fingerprints support fresh/stale/new/missing status.
- Project detection uses the nearest Git root or supported manifest markers and only emits a small metadata fingerprint, not manifest command bodies.
- Focused tests cover precedence/scope, freshness transitions, package metadata sanitization, symlink handling, standard interactive prompt wiring, and ACP/A2A provider prompts.
- The full CLI typecheck/build reports one existing unrelated error: `traceTimings` is referenced but undefined at `apps/cli/src/index.ts:4650`. It belongs to separate speed/trace work and remains untouched.
- Context7 and codebase-memory MCP tools are unavailable in this environment. No third-party API documentation was required; local source inspection was used.
- The worktree contains broad unrelated modifications. They were preserved.
