# Session History Command Implementation Plan

> **For agentic workers:** Track each implementation step with the checkbox list
> below. Keep the command read-only and bounded.

**Goal:** Add a safe, read-only interactive command for inspecting the newest
persisted entries in the current CLI session without changing model context,
workspace files, or session state.

**Architecture:** Parse `:history [count]` and `/history [count]` in one shared
CLI helper. Read entries through the current `AgentMemory`, format only the
newest bounded entries, and sanitize terminal controls plus credential-shaped
values before sending the result to either the ANSI renderer or the Ink notice
stream.

**Constraints:**

- Default to 10 entries and cap requests at 50.
- Bound the displayed content of every entry.
- Treat malformed counts as usage errors, not model prompts.
- Keep the command available in both ANSI and Ink interactive modes.
- Do not expose tool-call arguments, paths, environment values, or credentials.
- Do not mutate memory, context budgets, checkpoints, evidence, or workspace files.

## Tasks

- [x] Add focused parser and formatter tests before wiring the command.
- [x] Implement bounded history parsing and safe formatting.
- [x] Register the command in the shared Ink command palette and help output.
- [x] Wire the command into ANSI and Ink interactive command handling.
- [x] Add a real interactive persistence regression.
- [x] Document the command and its safety boundary.
- [x] Run the complete CLI, evaluation, TypeScript-gate, and diff checks.

## Completion record

Verification completed on 2026-09-21:

- CLI full suite: **449/449**.
- Agent Core full suite: **176/176**.
- Tools full suite: **158/158**.
- Desktop full suite: **144/144**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed, including workspace build/typecheck,
  package install smoke, release-boundary contracts, preview contracts, and
  documentation contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.
