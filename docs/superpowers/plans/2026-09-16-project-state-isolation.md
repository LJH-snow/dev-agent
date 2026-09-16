# Project-Scoped CLI State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `--project-state` mode so an installed CLI can keep configuration and session memory inside the selected project's `.dev-agent` directory without changing legacy user-level defaults.

**Architecture:** Keep the existing precedence for explicit paths and environment variables. When `--project-state` is present and no explicit config/session location is supplied, resolve config to `<final-cwd>/.dev-agent/config.json` and sessions to `<final-cwd>/.dev-agent/sessions`; `DEV_AGENT_MEMORY_FILE` continues to override the session directory. Thread the boolean through the CLI's state-reading and state-writing operations instead of using process-global mutable state.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing CLI argument parser and file-backed session memory.

**Spec:** This document is the bounded follow-up to the deferred project/config isolation decision recorded in `docs/superpowers/plans/2026-09-15-overnight-development-goals.md`.

## Global Constraints

- Existing defaults remain unchanged: config uses `~/.dev-agent/config.json`, sessions use `~/.dev-agent/sessions`, and explicit `--config`, `DEV_AGENT_CONFIG_FILE`, `DEV_AGENT_SESSION_DIR`, and `DEV_AGENT_MEMORY_FILE` keep their current precedence.
- `--project-state` is opt-in and must not silently rename, migrate, or overwrite an existing user-level `default` session.
- Relative explicit config/session/memory paths remain relative to the final `--cwd`.
- `--project-state` applies to the final validated working directory, including when that directory is selected with `--cwd` or `DEV_AGENT_WORKING_DIRECTORY`.
- Provider-free commands must continue to work without API keys, and `--json` must remain a single parseable JSON document.
- Do not add a Windows backend, automatic state migration, new dependencies, or an implicit project-state default.
- All implementation changes follow TDD: write a failing test, observe the expected failure, implement the smallest change, and rerun the focused and fixed gates.

---

## Task 1: Define project-state resolution contracts

**Files:**
- Modify: `apps/cli/tests/config.test.ts`
- Modify: `apps/cli/tests/cli-args.test.ts`
- Modify: `apps/cli/tests/external-working-directory.test.ts`
- Modify: `tests/documentation-contract.test.mjs`

**Interfaces:**
- `resolveConfigPath(flagValue, env, homeDirectory, baseDirectory, projectState)` returns the project config path only when `projectState` is true and no explicit config path wins.
- The CLI accepts `--project-state` as a flag with no value and rejects no valid neighboring flag combinations.
- An external project config is selected from the final working directory when `--project-state` is explicit.

- [x] **Step 1: Write the failing tests**
  - Assert that `resolveConfigPath(undefined, {}, "/tmp/home", "/tmp/project", true)` returns `/tmp/project/.dev-agent/config.json`.
  - Assert that `--project-state` is accepted by `--tools` and that `--project-state --once` reads the provider configured in `<cwd>/.dev-agent/config.json`.
  - Assert that `--config` still wins over `--project-state` and that `DEV_AGENT_CONFIG_FILE` still wins over the project default.
  - Assert that the documentation describes the new opt-in mode and preserves the legacy default.

- [x] **Step 2: Run the focused tests to verify RED**

```bash
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json
node --test apps/cli/tests-dist/config.test.js apps/cli/tests-dist/cli-args.test.js apps/cli/tests-dist/external-working-directory.test.js
node --test tests/documentation-contract.test.mjs
```

Expected: the new tests fail because `resolveConfigPath` has no project-state branch and `--project-state` is currently an unknown option.

- [x] **Step 3: Implement the smallest config and argument changes**
  - Add `--project-state: "none"` to the CLI flag table.
  - Add an optional `projectState = false` parameter to `resolveConfigPath` and `loadConfig`.
  - Resolve `<baseDirectory>/.dev-agent/config.json` only after the explicit flag and environment config path checks.
  - Parse `const projectState = args.includes("--project-state")` and pass it to config loading.

- [x] **Step 4: Run the focused tests to verify GREEN**

```bash
pnpm --filter @agent_cli/cli test
node --test tests/documentation-contract.test.mjs
```

Expected: CLI tests and documentation contracts pass.

---

## Task 2: Thread project-state session paths through every CLI operation

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/tests/session-dir.test.ts`
- Modify: `apps/cli/tests/external-working-directory.test.ts`

**Interfaces:**
- `sessionDir(baseDirectory, projectState)` returns `<baseDirectory>/.dev-agent/sessions` only when project state is enabled and no `DEV_AGENT_SESSION_DIR` is set.
- `memoryFilePath(sessionId, baseDirectory, projectState)` preserves `DEV_AGENT_MEMORY_FILE` precedence and otherwise uses the selected session directory.
- `createMemory`, `listSessions`, doctor, delete, rename, compact, metadata, preview, export, cleanup, and MCP server use the same project-state selection.

- [x] **Step 1: Write the failing tests**
  - Create two temporary projects with the same session id and different `.dev-agent/sessions/<id>.json` metadata; run `--project-state --metadata` against each and assert that each reads its own entry count.
  - Run `--project-state --session-list` and assert that it lists only the selected project's sessions.
  - Assert that `DEV_AGENT_SESSION_DIR` overrides project state and that `DEV_AGENT_MEMORY_FILE` still overrides both.
  - Assert that the user-level session file is not created or modified by project-state metadata/list operations.

- [x] **Step 2: Run the focused tests to verify RED**

```bash
pnpm --filter @agent_cli/cli test
```

Expected: the new session tests fail because the current implementation always uses the user-level session directory unless an environment override is supplied.

- [x] **Step 3: Implement the smallest path-threading change**
  - Add the boolean parameter to the private session helpers.
  - Pass it from `main` through all state operations and from `runMcpServer` into `createMemory`.
  - Do not alter the behavior of invocations that omit `--project-state`.

- [x] **Step 4: Run the focused tests to verify GREEN**

```bash
pnpm --filter @agent_cli/cli test
```

Expected: the CLI suite passes with project-state isolation and legacy compatibility.

---

## Task 3: Document the opt-in behavior and update the source-of-truth records

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `docs/release-cli-npm.md`
- Modify: `README.md`
- Modify: `docs/next-roadmap-plans-v62-plus.md`
- Modify: `docs/superpowers/plans/2026-09-15-overnight-development-goals.md`
- Modify: `tests/documentation-contract.test.mjs`

**Interfaces:**
- Documentation provides a copyable `--project-state` example using an external project.
- Documentation states the precedence exactly and warns that the mode is opt-in with no migration.
- The roadmap records this as the selected follow-up while keeping Windows restricted execution deferred.

- [x] **Step 1: Write the failing documentation contract**
  - Require the CLI README and npm release guide to contain `--project-state`, `.dev-agent/config.json`, `.dev-agent/sessions`, and the unchanged legacy defaults.
  - Require the roadmap and overnight plan to link or describe the bounded follow-up.

- [x] **Step 2: Run the documentation contract to verify RED**

```bash
node --test tests/documentation-contract.test.mjs
```

Expected: the new assertions fail because the option is not documented yet.

- [x] **Step 3: Update the documentation**
  - Add the option to the CLI option list and the config/session precedence section.
  - Add one external-project example and one compatibility note.
  - Record that the change does not authorize a GitHub release or npm republish.

- [x] **Step 4: Run the documentation tests to verify GREEN**

```bash
node --test tests/documentation-contract.test.mjs tests/release-workflow.test.mjs
```

Expected: all documentation and release workflow contracts pass.

---

## Task 4: Run the complete fixed verification gate

**Files:**
- Verify only: repository implementation and tests

- [x] **Step 1: Run the full gate**

```bash
pnpm verify
```

- [x] **Step 2: Check the diff and status**

```bash
git diff --check
git status --short --branch
```

Expected: all selected gates pass; no tag, push, GitHub Release, or npm publication is performed.

- [x] **Step 3: Record the verification evidence**
  - Update the overnight plan with exact test counts and the remaining deferred Windows decision.
  - Do not commit the shared dirty worktree without a separate explicit request.

## Execution evidence (2026-09-16)

- RED: the focused CLI run failed 5 new project-state tests because the flag and project-path branches did not yet exist; the documentation contract also failed on the missing option.
- GREEN: `pnpm --filter @agent_cli/cli test` — 200/200.
- Documentation: `node --test tests/documentation-contract.test.mjs` — 10/10; release workflow contracts — 7/7.
- Full gate: `pnpm verify` passed, including preview 8/8, release gate 16/16, CI workflow 2/2, documentation 10/10, Rust library 48/48, Rust binary 5/5, and real Rust integration 11/11.
- `git diff --check` passed. No tag, push, GitHub Release, or npm publication was performed.
- Published `@agent_cli/cli@0.1.2` was not modified or republished; `--project-state` remains a workspace-only candidate pending separate release authorization.
- Windows restricted execution remains deferred and was not changed by this work.


## Release follow-up (2026-09-16)

- After explicit maintainer authorization, the public CLI package was bumped from `0.1.2` to
  `0.1.3`; current npm identity verification returned `libai168`.
- The full gate was rerun, the package tarball was checked in a clean install, and
  `@agent_cli/cli@0.1.3` was published with `latest` pointing to `0.1.3`.
- Registry verification confirmed `dev-agent --version` is `0.1.3`, `--tools` works, and
  the published package includes the opt-in `--project-state` behavior. No Git tag, push, or
  GitHub Release was created.
