# CLI GitHub workflow

## Goal

Add a small, guarded interactive workflow for branch inspection/creation, commits,
pushes, and GitHub pull requests without exposing shell injection or credentials.

## Tasks

- [x] Define bounded command grammar and argument-safe execution boundary.
- [x] Add unit tests for parsing, confirmations, clean-tree guards, secret-path guards, and PR auth.
- [x] Implement `github-workflow-command.ts` with no shell command strings or force flags.
- [x] Wire `:branch`, `:commit`, `:push`, and `:pr` into readline and Ink interactive paths.
- [x] Add command hints and CLI documentation.
- [x] Add end-to-end interactive coverage through the CLI entry point.
- [ ] Run the complete CLI suite and record unrelated baseline failures separately.
- [ ] Commit only the workflow files and their focused tests/docs.
