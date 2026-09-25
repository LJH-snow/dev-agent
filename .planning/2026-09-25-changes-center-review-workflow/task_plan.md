# Changes Center review workflow

## Goal
Turn existing diff comments into a bounded, session-isolated review workflow: track comment state, select comments, navigate from a comment back to its file/group/line, and insert only the intended comments into the task prompt without weakening existing sanitization or storage limits.

## Phases
- [x] Baseline source/test inventory and contracts
- [x] Add normalized comment state and bounded persistence
- [x] Add selection controls, summary, and selected insertion
- [x] Add bidirectional comment-to-diff navigation and keyboard behavior
- [x] Add focused regressions and run available source/JS verification
- [x] Commit and push the verified feature

## Constraints
- Preserve unrelated user changes and temporary `.playwright-cli/` and `output/` directories.
- Do not add a backend mutation or broaden shell/network/filesystem capabilities.
- Keep diff/path/comment rendering text-safe and all inputs bounded/fail-closed.

## Verification note

The focused Changes Center suite passes 6/6, `node --check` passes, and
`git diff --check` passes. The full Desktop suite was attempted but is
currently blocked before test execution by a separate in-progress Task
Validation Center edit in `apps/desktop/src/chat-session.ts` that calls
`.push` on a readonly `ChangeSetFileReview[]`.
