# Input Boundary Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four remaining input-boundary decisions from the 2026-09-20 audit without silently truncating valid project data or changing normal user-facing behavior.

**Architecture:** Add one shared cumulative stream budget to all four model providers, keep the existing Agent `maxOutputChars` budget separate, and cancel a provider reader before a response can grow past the fixed 16 MiB UTF-8 limit. Bound code indexing at discovery and persistence with fixed project-safe limits and stable metadata-only failures, replace rollback directory materialization with early-exit iteration, and deny an oversized unterminated CLI approval line before it can grow without bound.

**Tech Stack:** TypeScript 5.9, Node.js 20+, pnpm, Node test runner, existing `@dev-agent/model`, `@dev-agent/tools`, `@agent_cli/cli`, and the current Rust/macOS release gates.

**Spec:** `.superpowers/sdd/2026-09-18-next-development-plan/task-2-audit.md`

## Global Constraints

- Preserve the public provider, code-search, rollback, and approval behavior for inputs below the new limits.
- Use UTF-8 byte counts for stream, source, index, and approval limits; do not use JavaScript string length for boundary decisions.
- Provider cumulative output is capped at `16 MiB` per streamed response, including text, reasoning, and accumulated tool-call fragments.
- Code indexing is capped at `100,000` eligible files and `256 MiB` total eligible source bytes per scan; a limit failure must not persist a partial index.
- Persisted code-search/index JSON remains bounded by the existing `16 MiB` read contract; oversized write-back is skipped without replacing the previous valid index.
- CLI approval input is capped at `4 KiB` before the first newline; overflow resolves as a denial and does not execute the requested tool.
- Rollback must stop directory inspection at the first unexpected entry and preserve the existing postimage conflict error shape.
- Every behavior change starts with a RED regression test, then the smallest GREEN implementation.
- Do not add user-configurable limit flags in this slice.
- Do not publish npm, create a tag, create a GitHub Release, or merge to the default branch; pushing the feature branch is allowed after verification.

---

### Task 1: Bound cumulative provider stream output

**Files:**
- Create: `packages/model/src/stream-budget.ts`
- Modify: `packages/model/src/openai.ts`
- Modify: `packages/model/src/anthropic.ts`
- Modify: `packages/model/src/gemini.ts`
- Modify: `packages/model/src/ollama.ts`
- Test: `packages/model/tests/streaming.test.ts`
- Test: `packages/model/tests/stream-budget.test.ts`

**Interfaces:**
- `MAX_STREAM_OUTPUT_BYTES` is `16 * 1024 * 1024`.
- `StreamOutputLimitError` exposes `code: "stream_output_limit"`, `limitBytes`, and `observedBytes`.
- `StreamOutputBudget.addText(value: string)` counts `Buffer.byteLength(value, "utf8")`.
- `StreamOutputBudget.addJson(value: unknown)` counts the UTF-8 bytes of `JSON.stringify(value)`.
- A provider cancels its reader before rethrowing `StreamOutputLimitError`.

- [x] **Step 1: Write the failing tests**

Add a helper test proving UTF-8 byte accounting and a provider stream test
proving that a response over the fixed limit cancels its reader and rejects
with `stream_output_limit`. Keep each individual wire line below the existing
`1 MiB` line limit so the cumulative guard is the failure being tested.

- [x] **Step 2: Run the model tests and confirm RED**

```sh
pnpm --filter @dev-agent/model run test
```

Expected: the new cumulative-limit tests fail because the current providers
keep appending content/tool fragments until the stream ends.

- [x] **Step 3: Implement the shared stream budget**

Create `StreamOutputBudget` in `stream-budget.ts`. Count text, reasoning,
tool-call ids/names/argument fragments, and provider function-call payloads
before appending them or invoking token callbacks. Throw
`StreamOutputLimitError` when the next append would exceed `16 MiB`.

- [x] **Step 4: Integrate cancellation into all providers**

Use one budget instance per `streamChat` call in OpenAI, Anthropic, Gemini,
and Ollama. Catch `StreamOutputLimitError`, call `reader.cancel()`, then
rethrow. Leave normal completion, malformed-line skipping, usage reporting,
and tool-call parsing unchanged.

- [x] **Step 5: Run focused and package regressions**

```sh
pnpm --filter @dev-agent/model run test
pnpm --filter @dev-agent/agent-core run test
```

- [x] **Step 6: Commit the task**

```sh
git add packages/model/src packages/model/tests
git commit -m "fix: cap cumulative provider streams"
```

---

### Task 2: Bound code-search discovery and index write-back

**Files:**
- Modify: `packages/tools/src/code-search.ts`
- Modify: `apps/cli/src/index-command.ts`
- Test: `packages/tools/tests/code-search-persisted.test.ts`
- Test: `packages/tools/tests/code-search-cache.test.ts`
- Test: `apps/cli/tests/index-command.test.ts`

**Interfaces:**
- Default scan limits are `100,000` eligible files and `256 MiB` total eligible
  source bytes.
- `CodeSearchScanLimitError` and the CLI index limit error expose a stable code,
  dimension, limit, and observed value without absolute paths or raw filesystem
  errors.
- Code-search returns no partial result when discovery exceeds a limit.
- CLI `refreshIndexDirectory` returns a failed promise for a scan-limit error
  before replacing the previous index; existing cancellation results remain
  unchanged.
- Code-search persistence serializes the candidate index first and skips the
  write if its UTF-8 bytes exceed `16 MiB`, leaving the previous valid file
  untouched.

- [x] **Step 1: Write the failing tests**

Add small-fixture tests using test-only constructor limits of two files and
ten source bytes to prove code-search rejects a scan before returning partial
symbols. Add a CLI index test using a small injected limit that proves the
previous `index.json` remains byte-for-byte unchanged. Add a persistence test
that builds a candidate JSON payload over `16 MiB` and proves write-back is
skipped.

- [x] **Step 2: Run the focused tests and confirm RED**

```sh
pnpm --filter @dev-agent/tools run test
pnpm --filter @agent_cli/cli run test
```

Expected: the new limit tests fail because directory discovery and index
serialization currently have no total budget.

- [x] **Step 3: Add bounded discovery**

Replace unbounded directory materialization in the code-search and CLI index
walkers with async directory iteration. Count only supported, non-ignored,
regular files after `stat`. Before adding a file, check both the file-count and
source-byte budget. Throw the stable limit error before reading or mutating the
cache when the next file would cross a boundary.

- [x] **Step 4: Guard persistence**

Serialize the complete candidate index into a UTF-8 buffer before writing.
When it exceeds `16 MiB`, skip the write and keep the previous index file.
Preserve best-effort search behavior for code-search and existing atomic-write
cleanup for the CLI index command.

- [x] **Step 5: Run focused and compatibility tests**

```sh
pnpm --filter @dev-agent/tools run test
pnpm --filter @agent_cli/cli run test
```

- [x] **Step 6: Commit the task**

```sh
git add packages/tools/src/code-search.ts packages/tools/tests apps/cli/src/index-command.ts apps/cli/tests/index-command.test.ts
git commit -m "fix: bound code index discovery"
```

---

### Task 3: Make rollback directory inspection early-exit

**Files:**
- Modify: `packages/tools/src/filesystem.ts`
- Test: `packages/tools/tests/filesystem-changeset.test.ts`

**Interfaces:**
- `preflightRollback` preserves the existing postimage conflict message for
  unexpected entries.
- Directory enumeration uses `opendir()` and stops after the first entry that
  is not in the created-directory or rollback-file allowlist.
- The check does not materialize the complete directory listing.
- The internal `findUnexpectedRollbackEntry` helper accepts an injected
  `AsyncIterable<Dirent>` for deterministic early-exit testing.

- [x] **Step 1: Write the failing regression test**

Add a unit test for `findUnexpectedRollbackEntry` with an async generator that
throws if entries after the first unexpected entry are consumed. Assert the
helper returns the first unexpected path. Add a rollback fixture with a
created directory containing an unexpected file and assert rollback is
rejected, the unexpected file remains, and the error still contains
`cannot rollback non-empty directory`.

- [x] **Step 2: Run the filesystem changeset test and confirm RED**

```sh
pnpm --filter @dev-agent/tools run test
```

Expected: the new helper test fails because the current implementation has no
injectable early-exit iterator.

- [x] **Step 3: Replace `readdir()` with early-exit iteration**

Add a small helper around `opendir()` that checks entries one at a time,
returns on the first unexpected path, and closes the directory handle in all
paths. Do not change change-set schemas or rollback ordering.

- [x] **Step 4: Run regression tests**

```sh
pnpm --filter @dev-agent/tools run test
```

- [x] **Step 5: Commit the task**

```sh
git add packages/tools/src/filesystem.ts packages/tools/tests/filesystem-changeset.test.ts
git commit -m "fix: bound rollback directory inspection"
```

---

### Task 4: Bound CLI approval input

**Files:**
- Modify: `apps/cli/src/index.ts`
- Test: `apps/cli/tests/approval.test.ts`
- Test: `apps/cli/tests/non-interactive.test.ts`

**Interfaces:**
- `MAX_APPROVAL_INPUT_BYTES` is `4 * 1024`.
- `readLineFromStdin` resolves an empty string when the pre-newline buffer
  exceeds the limit, so existing approval parsing treats it as deny.
- The function removes listeners and pauses stdin before resolving overflow.
- Normal `y`, `n`, newline, EOF, and piped approval behavior remains unchanged.

- [x] **Step 1: Write the failing test**

Pipe an approval response containing `4 KiB + 1` bytes without a newline and
assert the CLI exits with the existing denial result and never runs the
dangerous tool. Add a UTF-8 case so the limit is measured in bytes.

- [x] **Step 2: Run the approval tests and confirm RED**

```sh
pnpm --filter @agent_cli/cli run test
```

Expected: the oversized input currently reaches EOF or remains buffered rather
than resolving as an immediate denial.

- [x] **Step 3: Implement the byte-boundary guard**

Count each incoming chunk with `Buffer.byteLength`. On overflow, call the
same cleanup path used by newline/EOF and resolve `""`. Do not echo the
untrusted input or add raw input to the error output.

- [x] **Step 4: Run CLI regressions**

```sh
pnpm --filter @agent_cli/cli run test
```

- [x] **Step 5: Commit the task**

```sh
git add apps/cli/src/index.ts apps/cli/tests/approval.test.ts apps/cli/tests/non-interactive.test.ts
git commit -m "fix: bound CLI approval input"
```

---

### Task 5: Documentation, final review, and delivery

**Files:**
- Modify: `.superpowers/sdd/2026-09-20-input-boundary-closure/progress.md`
- Modify: `docs/superpowers/plans/2026-09-20-input-boundary-closure.md`
- Modify: `task_plan.md`
- Modify: `progress.md`
- Modify: `.superpowers/sdd/2026-09-18-next-development-plan/task-2-audit.md`
- Modify: `apps/cli/README.md`

- [x] **Step 1: Record task results in the ledger**

For each completed task, record the commit range, focused test command, exact
test count, reviewer verdict, and any parked minor finding. Record any ruling
in the form `Ruling: <decision> - <reason> - <cost if wrong>`.

- [x] **Step 2: Update public documentation**

Document the provider cumulative stream cap, code-index discovery/write-back
limits, rollback early-exit guarantee, and approval-input denial behavior.
Keep the audit's four original boundary rows updated with exact evidence.

- [ ] **Step 3: Run all gates**

```sh
pnpm build
pnpm verify
swift test --package-path apps/macos/SignalLoomDesktop --scratch-path .codex/native-test
./script/build_and_run.sh --verify
plutil -lint "dist/Signal Loom Desktop.app/Contents/Info.plist"
git diff --check
```

- [ ] **Step 4: Push the feature branch**

```sh
git push origin codex/desktop-cli-workbench
```

The final report must name the pushed commit, exact gate counts, and any
remaining evidence or product decisions. Do not call the project release-ready
without separate release authorization.
