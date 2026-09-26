# Multi-Agent Parallel Run View

## Goal
Expose a bounded, metadata-only view of concurrent Desktop agent runs so the workbench can show which sessions are running, waiting, completed, failed, or aborted without leaking prompts, tool inputs, outputs, paths, or raw errors.

## Phases
- [x] Inventory existing run registry, session summaries, and UI refresh lifecycle
- [x] Add bounded parallel-run projection and loopback endpoint
- [x] Add bilingual parallel-run panel with session focus actions
- [x] Add focused API/UI tests and run verification
- [x] Commit and push the verified feature

## Constraints
- Preserve unrelated Task Validation Center, CLI, `.playwright-cli/`, and `output/` changes.
- Reuse existing run registry; do not expose prompts, tool inputs, output text, paths, or raw errors.
- Bound session/run counts, labels, durations, and response bytes.
- Fail closed for malformed injected summaries and stale requests.
