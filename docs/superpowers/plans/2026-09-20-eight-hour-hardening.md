# Eight-Hour Input Boundary Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the next eight-hour development window to close the five reproducible input-boundary gaps identified by the 2026-09-20 audit, while preserving the completed Signal Loom CLI, Web Desktop, and native macOS shell contracts.

**Architecture:** Keep each boundary local to the package that owns it. Apply fixed byte or count limits before parsing, materializing, writing, or framing; return the existing metadata-only error style; and add a regression test before each production change. The MCP error-path change already present in the worktree is treated as an in-flight task and must be validated before touching adjacent code.

**Tech Stack:** TypeScript 5.9, Node.js 20+, pnpm 12.3.4, Node test runner, existing MCP JSON-RPC framing, `fs/promises` directory streams, CLI doctor subprocesses, and the existing package/release gates.

**Spec:** `.superpowers/sdd/2026-09-18-next-development-plan/task-2-audit.md`

## Global Constraints

- Preserve the current CLI, Desktop, Signal Loom rich TTY, and native `Signal Loom Desktop.app` behavior.
- Do not use `git reset`, `git checkout`, destructive cleanup, package publishing, npm release, tag creation, push, or GitHub Release actions.
- Keep the existing limits: `1 MiB` config files, `16 MiB` project/file/memory content, and `8 MiB` MCP/Rust transport frames unless a task explicitly defines a narrower derived limit.
- Do not expose absolute paths, source bytes, command arguments, credentials, or raw subprocess/error messages in public output.
- Every production behavior change follows RED test, focused failure, minimal GREEN implementation, focused pass, then broader regression.
- Public JSON changes require matching tests and documentation in the same task. The CLI session-list cap uses an explicit `{ sessions, truncated, total }` JSON envelope instead of silently dropping rows.
- Native macOS work is already implemented; this window validates it only through existing checks and does not introduce Electron, Tauri, Node bundling, signing, or notarization.

## Eight-Hour Schedule

| Window | Deliverable | Evidence |
| --- | --- | --- |
| 00:00-00:30 | Restore context, record ownership, and run the MCP focused baseline | Worktree diff, plan ledger, focused test result |
| 00:30-01:30 | Finish and validate bounded MCP error responses | MCP tests plus CLI MCP regression |
| 01:30-03:00 | Bound CLI session discovery and make truncation explicit | Session-list unit/e2e tests, README contract |
| 03:00-04:30 | Bound doctor subprocess output and Rust probe frames | Doctor tests, timeout/termination tests |
| 04:30-06:00 | Bound FilesystemTool writes and generated postimages | Tools edge-case and change-set tests |
| 06:00-07:00 | Synchronize audit, plan, progress, and candidate documentation | Documentation contract and diff review |
| 07:00-08:00 | Run full verification and leave a clean handoff | `pnpm verify`, package tests, `git diff --check` |

---

### Task 0: Restore context and establish the current baseline

**Files:**
- Modify: `task_plan.md`
- Modify: `progress.md`
- Modify: `findings.md`
- Read: `.superpowers/sdd/2026-09-18-next-development-plan/task-2-audit.md`
- Read: `packages/mcp/src/server.ts`
- Read: `packages/mcp/tests/mcp-server.test.ts`

**Interfaces:**
- The audit's five `FIX` rows are the authoritative scope.
- The current MCP diff is an existing in-flight change and is not to be overwritten.

- [x] **Step 1: Record the eight-hour phase in the repository plan files**

Add this phase to `task_plan.md` and record the baseline in `progress.md`:

```text
Phase 3: eight-hour input-boundary hardening
Status: complete
Scope: MCP error responses, CLI session listing, doctor subprocess output,
FilesystemTool write/postimage size
Release boundary: verified branch changes may be pushed when requested; no
automatic npm publish, tag, or GitHub release
```

- [x] **Step 2: Capture the audit decision list as current findings**

Keep the four `NEEDS-EVIDENCE` rows unchanged. Record that the five `FIX` rows
are the implementation queue and that the existing `packages/mcp` change is
preserved as part of this verified worktree.

- [x] **Step 3: Run the current MCP focused baseline**

Run:

```sh
pnpm --filter @dev-agent/mcp run build
pnpm --filter @dev-agent/mcp run test
```

Expected: the existing MCP test suite passes or reports the exact in-flight
failure; do not hide a failure by changing unrelated packages.

---

### Task 1: Bound MCP error-path responses

**Files:**
- Modify only if the existing in-flight implementation is incomplete:
  `packages/mcp/src/server.ts`
- Test: `packages/mcp/tests/mcp-server.test.ts`
- Verify: `apps/cli/tests/mcp-server.test.ts`,
  `apps/cli/tests/mcp-resource-tool.test.ts`

**Interfaces:**
- `createMcpServer(options).handleMessage(message)` still returns
  `Promise<string | undefined>`.
- Every error response returned from `handleMessage` must be no larger than
  `maxFrameBytes` when the JSON-RPC envelope itself can fit.
- Tool execution failures remain tool results with `isError: true`; protocol
  and unexpected failures remain JSON-RPC errors.

- [x] **Step 1: Exercise the existing oversized-error RED case**

Run the focused test that throws a `1000`-character resource error with
`maxFrameBytes: 160`:

```sh
pnpm --filter @dev-agent/mcp run build
node --test packages/mcp/tests-dist/mcp-server.test.js
```

The response must parse as JSON, retain error code `-32603`, and fit within
`160` UTF-8 bytes.

- [x] **Step 2: Review the response fallback**

Confirm the implementation bounds attacker-controlled error detail, preserves
the request id when the envelope fits, and falls back to a null id only when
needed. The impossible case where the configured frame is smaller than the
minimum JSON-RPC envelope must remain an explicit protocol-size failure rather
than an unbounded retry.

- [x] **Step 3: Run the package and CLI regression suites**

```sh
pnpm --filter @dev-agent/mcp run test
pnpm --filter @agent_cli/cli run test
```

---

### Task 2: Bound and document CLI session listing

**Files:**
- Modify: `apps/cli/src/index.ts`
- Test: `apps/cli/tests/session-list.test.ts`
- Test: `apps/cli/tests/json-output.test.ts`
- Test: `apps/cli/tests/session-dir.test.ts`
- Modify: `apps/cli/README.md`
- Modify: `README.md` only if the root command summary needs the new JSON shape

**Interfaces:**
- Add `MAX_SESSION_LIST_ENTRIES = 256`.
- Enumerate the session directory with `opendir()` and process entries one at
  a time; never call `readdir()` to materialize the full directory.
- Keep only the newest 256 `.json` sessions using `mtimeMs` ordering and a
  bounded candidate array. Count all matching candidates with an integer.
- Preserve human-readable output for untruncated directories:
  `Sessions (2) in <safe path>:` remains unchanged.
- Change `--session-list --json` to:

```json
{
  "sessions": [
    {
      "file": "demo.json",
      "size": 123,
      "modifiedAt": "2026-09-20T00:00:00.000Z",
      "usage": null,
      "evidenceSummary": null
    }
  ],
  "truncated": false,
  "total": 1
}
```

For more than 256 sessions, `truncated` is `true`, `total` is the number of
matching `.json` entries observed, and `sessions` contains the newest 256.
Missing, corrupt, or unreadable entries continue to produce the existing
metadata-only placeholder row.

- [x] **Step 1: Write the failing bounded-list tests**

Add a test that creates 257 session files with deliberately ordered mtimes and
asserts that `--session-list --json` returns the object envelope, exactly 256
rows, `truncated: true`, and `total: 257`. Keep the existing one-session array
assumptions updated to `result.sessions`.

- [x] **Step 2: Run the session-list tests and confirm RED**

```sh
pnpm --filter @agent_cli/cli run build
node --test apps/cli/tests-dist/session-list.test.js apps/cli/tests-dist/json-output.test.js
```

Expected: the new test fails because the current implementation returns every
row as a bare JSON array and calls `readdir()`.

- [x] **Step 3: Implement bounded enumeration**

Use `opendir()` and a bounded insertion helper:

```ts
const kept: SessionRow[] = [];
let total = 0;
for await (const entry of await opendir(directory)) {
  if (!entry.name.endsWith(".json")) continue;
  total += 1;
  const row = await readSessionRow(directory, entry.name);
  insertNewest(kept, row, MAX_SESSION_LIST_ENTRIES);
}
kept.sort((a, b) => b.modified.getTime() - a.modified.getTime());
const result = { sessions: kept, truncated: total > kept.length, total };
```

The insertion helper must compare `modified.getTime()` and use the filename as
a deterministic tie-breaker. Do not store the full directory entry list.

- [x] **Step 4: Run focused and compatibility tests**

```sh
pnpm --filter @agent_cli/cli run test
node --test apps/cli/tests-dist/session-dir.test.js
```

Expected: all existing session metadata, path redaction, empty-directory, and
JSON tests pass with the documented envelope.

---

### Task 3: Bound doctor subprocess output and Rust probe frames

**Files:**
- Modify: `apps/cli/src/doctor.ts`
- Test: `apps/cli/tests/doctor.test.ts`
- Modify: `apps/cli/README.md` for the fixed doctor subprocess limits

**Interfaces:**
- Add `MAX_COMMAND_VERSION_BYTES = 64 * 1024`.
- Add `MAX_RUST_PROBE_FRAME_BYTES = 8 * 1024 * 1024`.
- `defaultCommandVersion()` returns `undefined` when stdout exceeds its limit,
  kills the child, removes listeners, and never returns the unbounded output.
- `probeRustBinary()` reads the four-byte length as soon as available. If the
  declared frame exceeds `MAX_RUST_PROBE_FRAME_BYTES`, it kills the child and
  rejects with a stable error. It never buffers more than the declared frame
  plus the four-byte prefix.
- Rust stderr is capped at `16 KiB`; failure details use a stable code/message
  and never echo an unbounded stderr stream.

- [x] **Step 1: Add RED tests for command-version overflow**

Use a temporary executable on `PATH` that writes `64 * 1024 + 1` bytes to
stdout, run the real doctor flow, and assert the ripgrep check fails without
retaining the banner.

- [x] **Step 2: Add RED tests for Rust declared-frame overflow**

Create a temporary executable with a Node shebang that writes more than the
transport frame limit. Assert `probeRustBinary()` rejects with the stable frame
limit error.

- [x] **Step 3: Run doctor tests and confirm RED**

```sh
pnpm --filter @agent_cli/cli run build
node --test apps/cli/tests-dist/doctor.test.js
```

- [x] **Step 4: Implement early termination and bounded buffers**

Track `settled`/`overflowed` state, destroy both streams on overflow, send
`SIGTERM`, and resolve/reject only once. For the Rust probe, parse the prefix
before collecting the payload and ignore bytes after the bounded frame.

- [x] **Step 5: Run doctor and full CLI regression**

```sh
node --test apps/cli/tests-dist/doctor.test.js
pnpm --filter @agent_cli/cli run test
```

---

### Task 4: Bound FilesystemTool writes and generated postimages

**Files:**
- Modify: `packages/tools/src/filesystem.ts`
- Test: `packages/tools/tests/tools-edge-cases.test.ts`
- Test: `packages/tools/tests/filesystem-preview.test.ts`
- Test: `packages/tools/tests/filesystem-changeset.test.ts`

**Interfaces:**
- Add `MAX_WRITE_FILE_BYTES = 16 * 1024 * 1024`.
- Direct `write`, `edit`, and `patch` reject a UTF-8 postimage larger than the
  limit before any filesystem write.
- `preview` rejects an oversized generated `afterBytes` before creating a diff
  or storing a change set.
- `apply` never writes an oversized prepared postimage, even if the prepared
  object was produced by an older process.
- Existing read limit and atomic apply/rollback behavior remain unchanged.
- Error text is stable and contains only the fixed limit, not content or paths:
  `filesystem file exceeds the 16 MiB write limit`.

- [x] **Step 1: Add RED tests**

Add tests that:

```ts
await assert.rejects(
  () => tool.execute({ action: "write", path, content: "x".repeat(16 * 1024 * 1024) }),
  /16 MiB write limit/
);
```

Also cover an oversized `preview` write and an `edit` whose replacement makes
the postimage too large. Assert the target file remains byte-for-byte unchanged
and no applied change set is created.

- [x] **Step 2: Run tools tests and confirm RED**

```sh
pnpm --filter @dev-agent/tools run build
node --test packages/tools/tests-dist/tools-edge-cases.test.js packages/tools/tests-dist/filesystem-preview.test.js packages/tools/tests-dist/filesystem-changeset.test.js
```

- [x] **Step 3: Implement one shared postimage guard**

Use `Buffer.byteLength(text, "utf8")` for direct text operations and
`afterBytes.byteLength` for prepared mutations. Call the guard before
`writeFile`, before `createChangeSetFileReview`, and before storing a prepared
change set.

- [x] **Step 4: Run tools and CLI regression**

```sh
pnpm --filter @dev-agent/tools run test
pnpm --filter @agent_cli/cli run test
```

---

### Task 5: Synchronize documentation and the audit ledger

**Files:**
- Modify: `.superpowers/sdd/2026-09-18-next-development-plan/task-2-audit.md`
- Modify: `docs/superpowers/plans/2026-09-18-next-development-plan.md`
- Modify: `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/CHANGELOG.md` only for verified workspace-candidate notes
- Test: `tests/documentation-contract.test.mjs`

- [x] **Step 1: Record only verified behavior**

Mark each `FIX` row complete only after its focused test and package regression
pass. Record the exact limit and public JSON envelope for session listing.
Keep the four `NEEDS-EVIDENCE` rows open. The five reproducible `FIX` rows are
now closed by the focused tests and package regressions recorded below.

- [x] **Step 2: Run documentation contracts**

```text
documentation contracts: 57/57 passed
git diff --check: passed
```

- [x] **Step 3: Review the complete diff**

```sh
git status --short --branch
git diff --stat
git diff --check
```

Confirm native desktop files, concurrent MCP work, and unrelated user changes
remain intact.

The complete diff was reviewed on 2026-09-20. Existing native desktop
verification notes and unrelated planning/progress changes were preserved.

---

### Task 6: Full verification and handoff

**Files:**
- Read-only review of the complete worktree.
- Modify: `progress.md`
- Modify: `task_plan.md`

- [x] **Step 1: Run workspace build**

```sh
pnpm build
```

Result: passed for all nine buildable workspace projects.

- [x] **Step 2: Run all TypeScript and Rust gates**

```sh
pnpm verify
```

Read the complete output. Record failed phase, exit code, and exact test count
if any phase fails.

Result: `pnpm verify` passed all selected gates, including CLI 383/383,
Desktop 138/138, package tests, CLI package smoke, preview contracts,
documentation contracts 57/57, Rust unit/doc tests, and real Rust
integration 11/11.

- [x] **Step 3: Re-run native shell verification**

```sh
swift test --package-path apps/macos/SignalLoomDesktop --scratch-path .codex/native-test
./script/build_and_run.sh --verify
plutil -lint "dist/Signal Loom Desktop.app/Contents/Info.plist"
```

Result: Swift package tests 8/8 passed, the native verify launcher passed
without leaving a child process, and `Info.plist` lint passed.

- [x] **Step 4: Update progress and leave the next decision**

Record the exact test counts, whether all five audit findings are closed, and
any remaining `NEEDS-EVIDENCE` item. Do not call the project release-ready
unless the release authorization is separately provided.

The five reproducible input-boundary findings are closed. The four
`NEEDS-EVIDENCE` rows remain open for a future product/compatibility decision.
This worktree is verified but is not independently authorized for a release.
