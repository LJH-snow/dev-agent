# Findings

- Session transcript memory is already persisted by `FileMemory`; project memory
  needs a separate store so explicit facts are not mixed with conversation turns.
- The default store is per-project in the user state directory, keyed by a hash
  of the resolved workspace. `--project-state` opts into a workspace-local
  `.dev-agent/project-memory.json` file; an environment override supports tests.
- Records are bounded to 256 entries and 2 MiB on disk. Credentials are redacted
  before storage and display. Raw tool output and full prompts are never imported.
- Read operations do not ask for confirmation. Add and forget operations do.
