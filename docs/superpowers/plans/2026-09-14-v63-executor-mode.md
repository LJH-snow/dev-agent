# v63 Executor Mode Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active executor mode explicit in CLI doctor and Desktop health metadata without changing command execution semantics.

**Architecture:** Add a small, optional mode descriptor to the executor abstraction. `LocalExecutor` reports `local`; `RustExecutor` reports the platform-specific restricted backend (`sandboxed-macos`, `sandboxed-linux`, or `unsupported`). CLI doctor includes the selected mode as structured metadata while retaining its existing health checks; Desktop exposes the same metadata through `/health` and the session-facing server contract. Unknown injected executors remain `unknown` rather than being mislabeled.

**Tech Stack:** TypeScript, Node.js test runner, pnpm workspace, existing CLI/Desktop HTTP tests.

**Spec:** `docs/next-roadmap-plans-v62-plus.md` (v63: Executor 模式与沙箱状态显式化)

## Global Constraints

- Do not change `Executor.run`, `SandboxExecutor.runSandboxed`, protobuf messages, Rust runtime behavior, or process/network/filesystem policy.
- Do not turn mode metadata into an authorization or fallback decision.
- Do not expose binary paths, environment variables, command output, or sensitive runtime errors in metadata.
- Preserve explicit `LocalExecutor` behavior when no Rust binary is configured; never call it a restricted fallback.
- Preserve `Unsupported` behavior on platforms without an active Rust backend; do not add Windows support or a Windows release target.
- Keep injected test executors compatible by making mode metadata optional and resolving missing mode to `unknown`.
- Run RED tests before production changes and run the fixed TypeScript, Rust, integration, documentation, and diff checks before completion.

---

### Task 1: Define the bounded executor-mode contract

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/executor/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/executor/src/local-executor.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/executor/src/rust-executor.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/executor/tests/executor.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/executor/tests/rust-executor.test.ts`

**Interfaces:**
- Produces `ExecutorMode`, `resolveExecutorMode`, and optional `Executor.mode` metadata.
- Keeps all existing executor method signatures unchanged.

- [x] **Step 1: Write failing tests**
  - Assert `LocalExecutor.mode === "local"`.
  - Assert `RustExecutor.mode` resolves to the host backend without starting a child process.
  - Assert `resolveExecutorMode` returns `unknown` for an injected executor without metadata and `unsupported` for an unsupported platform configuration.

- [x] **Step 2: Run the focused executor tests and verify RED**

  Run: `pnpm --filter @dev-agent/executor test`

  Expected: FAIL only because the mode type/property/helper does not exist yet.

- [x] **Step 3: Implement the minimal metadata surface**
  - Add the mode union and platform resolver in `packages/executor/src/index.ts`.
  - Add `readonly mode` to the concrete local and Rust executors.
  - Keep `Executor.mode` optional so existing test doubles and consumers remain source-compatible.

- [x] **Step 4: Run the focused executor tests and verify GREEN**

  Run: `pnpm --filter @dev-agent/executor test`

  Expected: all executor tests pass with the new mode assertions.

- [x] **Step 5: Commit the bounded executor metadata change**

  Run: `git add packages/executor/src packages/executor/tests && git commit -m "feat: expose executor mode metadata"`

---

### Task 2: Make CLI doctor report the selected mode

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/doctor.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/doctor.test.ts`

**Interfaces:**
- Consumes `resolveExecutorMode` from `@dev-agent/executor`.
- Produces `DoctorReport.executorMode` as metadata; existing checks and exit-code rules remain unchanged.

- [x] **Step 1: Write failing doctor contract tests**
  - No Rust path reports `executorMode: "local"` and keeps the existing warning.
  - A configured Rust path on macOS/Linux reports the corresponding sandboxed mode even when the path health check fails; the health check remains the source of availability truth.
  - JSON output includes the field without paths or command output beyond the existing check detail.

- [x] **Step 2: Run doctor tests and verify RED**

  Run: `pnpm --filter @dev-agent/cli test`

  Expected: FAIL because `DoctorReport.executorMode` is absent.

- [x] **Step 3: Implement the minimal report field**
  - Derive mode from the same Rust path selection already passed to `runDoctor`.
  - Add a concise human-readable `executor mode` line without changing check names or summary counts.
  - Keep the current Rust runtime warning/error detail intact.

- [x] **Step 4: Run doctor tests and verify GREEN**

  Run: `pnpm --filter @dev-agent/cli test`

  Expected: all CLI tests pass, including existing JSON and exit-code assertions.

- [x] **Step 5: Commit the CLI metadata change**

  Run: `git add apps/cli/src/doctor.ts apps/cli/tests/doctor.test.ts && git commit -m "feat: show executor mode in doctor"`

---

### Task 3: Expose mode through Desktop health metadata

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/server.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/chat-session.test.ts` (or the existing ChatSession test file)

**Interfaces:**
- Consumes the executor mode descriptor from `@dev-agent/executor`.
- Produces `DesktopChatSession.executorMode?: ExecutorMode` and a `/health` JSON field.

- [x] **Step 1: Write failing Desktop contract tests**
  - A real `ChatSession` exposes `local` when no Rust binary is configured.
  - The `/health` endpoint returns `{ status: "ok", executorMode: ... }`.
  - Injected fake sessions without mode metadata still return a valid health response with `executorMode: "unknown"` rather than leaking implementation details.

- [x] **Step 2: Run the focused Desktop tests and verify RED**

  Run: `pnpm --filter @dev-agent/desktop test`

  Expected: FAIL because the session/server mode contract is absent.

- [x] **Step 3: Implement the minimal health metadata path**
  - Add an optional mode property to the server-facing session interface.
  - Add a read-only mode accessor to `ChatSession`.
  - Include only the resolved mode in `/health`; do not change `/api/chat`, evidence, session memory, or UI rendering.

- [x] **Step 4: Run the focused Desktop tests and verify GREEN**

  Run: `pnpm --filter @dev-agent/desktop test`

  Expected: all Desktop tests pass and existing health behavior remains `status: "ok"`.

- [x] **Step 5: Commit the Desktop metadata change**

  Run: `git add apps/desktop/src apps/desktop/tests && git commit -m "feat: expose executor mode in desktop health"`

---

### Task 4: Document and verify v63

**Files:**
- Create: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v63.md`
- Create: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v63-progress.md`
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/CHANGELOG.md`
- Modify: `/Users/Admin/Desktop/dev-agent/tests/documentation-contract.test.mjs`

**Interfaces:**
- Documents the metadata-only boundary and the explicit `unknown`/`unsupported` states.
- Does not change runtime public behavior beyond the bounded metadata fields.

- [x] **Step 1: Write documentation-contract expectations**
  - Add v63 plan/progress links to the existing documentation contract before creating the files.

- [x] **Step 2: Run the documentation contract and verify RED**

  Run: `node --test tests/documentation-contract.test.mjs`

  Expected: FAIL because the v63 documents and links do not exist yet.

- [x] **Step 3: Create the plan/progress docs and update navigation**
  - Record the trigger, mode vocabulary, no-fallback boundary, RED/GREEN evidence, and deferred UI scope.
  - Link the documents from the README and docs index.
  - Add a dated changelog entry with exact local gate counts.

- [x] **Step 4: Run all fixed verification gates**

  Run:
  - `pnpm verify:typescript`
  - `pnpm verify:rust`
  - `pnpm verify:integration`
  - `node scripts/check.mjs`
  - `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml"); YAML.load_file(".github/workflows/release.yml")'`
  - `git diff --check`

  Expected: zero failures, no skipped real integration tests, and documentation contract green.

- [x] **Step 5: Inspect the final diff and commit the documentation**

  Run: `git status --short --branch && git diff --stat && git commit -m "docs: record v63 executor mode"`

- [x] **Step 6: Push and verify hosted CI**
  - Push the final v63 commit to `main`.
  - Confirm Rust, TypeScript, macOS integration, and Linux integration jobs succeed.
  - Do not create a release tag or GitHub Release.

## Final acceptance evidence

- Executor mode metadata is present for LocalExecutor and RustExecutor without changing `run` semantics.
- CLI doctor JSON and human output identify the selected mode; health warnings/failures remain separate.
- Desktop `/health` exposes mode only and does not leak paths, commands, environment, or raw runtime output.
- Unsupported platform behavior remains explicit and fail-closed.
- All local fixed gates and hosted CI pass; no Windows backend or release target is added.
