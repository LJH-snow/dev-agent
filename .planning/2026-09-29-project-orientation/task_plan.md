# Project orientation

## Goal

Read the repository structure, runtime boundaries, current working-tree changes,
and verification contracts so future work starts from the actual project state.

## Phases

- [x] Restore existing planning context and inspect repository metadata.
- [x] Trace the runtime architecture from CLI/Desktop edges through Agent Core,
      tools, executors, models, MCP, and protocol adapters.
- [x] Verify current Ink/editor changes and the test/release gates.
- [x] Record a concise handoff summary without changing product code.
- [x] Reproduce and isolate the duplicate early-input and editor-exit regressions.
- [x] Confirm the minimal fixes in the Ink input/editor boundary and focused tests.
- [x] Run focused and proportional CLI validation, then record the handoff.

## Constraints

- Preserve all existing modified and untracked files.
- Treat documentation and planning logs as context, then verify important claims
  against source and tests.
- No product-code edits are part of this orientation pass.

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Initial planning skill path used the alias as a literal directory | 1 | Retried with the resolved skill root |
| First shell orchestration string had a JavaScript syntax error | 1 | Retried with a template literal |
| Codebase graph MCP tools were not exposed in this session | 1 | Used the repository's documented filesystem/search fallback |
| The first targeted Ink test stayed alive after its assertion failed | 1 | Re-ran it under an explicit 12-second shell timeout and captured the assertion plus the pending provider cleanup |
| The editor targeted test waited for EOF after Ctrl-C | 1 | Re-ran it under an explicit 28-second shell timeout and captured the 20-second `waitForExit` failure and terminal transcript |
| The planning skill symlink was not present at the catalog alias path | 1 | Followed `skills/xdt-agents` to `/Users/Admin/.agents/skills` and read the skill there |
