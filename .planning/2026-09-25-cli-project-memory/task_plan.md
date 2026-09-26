# CLI project memory

## Goal

Provide explicit, bounded, project-scoped memory that does not silently capture
conversation or tool output.

## Tasks

- [x] Define a versioned record format with source, confidence, timestamps, and opaque ids.
- [x] Add bounded parser and store tests.
- [x] Add confirmed `:memory add` and `:memory forget` commands.
- [x] Add read-only list/search commands and slash aliases.
- [x] Wire readline and Ink paths with cancellation-safe confirmation.
- [x] Add CLI hints, help text, and documentation.
- [x] Add entry-point integration coverage with a temporary memory file.
- [ ] Commit only project-memory files and focused docs/tests.
