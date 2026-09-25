# Changes Center review workflow

## Goal
Turn existing diff comments into a bounded, session-isolated review workflow: track comment state, select comments, navigate from a comment back to its file/group/line, and insert only the intended comments into the task prompt without weakening existing sanitization or storage limits.

## Phases
- [x] Baseline source/test inventory and contracts
- [x] Add normalized comment state and bounded persistence
- [x] Add selection controls, summary, and selected insertion
- [x] Add bidirectional comment-to-diff navigation and keyboard behavior
- [ ] Add focused regressions and run full Desktop verification
- [ ] Commit and push the verified feature

## Constraints
- Preserve unrelated user changes and temporary `.playwright-cli/` and `output/` directories.
- Do not add a backend mutation or broaden shell/network/filesystem capabilities.
- Keep diff/path/comment rendering text-safe and all inputs bounded/fail-closed.
