# `:editor` progress ledger

## Session: 2026-09-29

### Current status
- Phase 0 (recon) complete; Phase 1 (RED) complete; Phase 2 (implementation)
  complete; Phase 3 (docs) complete; Phase 4 (verification complete; rechecked after Ink 7.1.1 upgrade).

### Phase 0 — recon
- Command flow: composer submit → `ink.controller.nextPrompt()` →
  `normalizeInteractiveCommand` → `handleCommand` (src/index.ts:5709 area).
  `:editor` is dispatched there; `/editor` normalizes to `:editor`.
- Render output already flows through `createInkRenderOutput` (rows guard);
  a new `createGatedWriteOutput` proxy wraps it to pause frame writes.
- Alternate-screen session exposes idempotent `enter`/`exit`, safe to call
  around the editor.
- Composer state is ref-backed (`composerRef` + `applyComposer`); drafts are
  injected via a new monotonic-id `composerInsert` snapshot field, mirroring
  the paste path.

### Phase 1 — RED contracts
- `tests/ink-editor-suspend.test.ts` failed RED: module missing
  (ERR_MODULE_NOT_FOUND), `setComposerInsert`/`composerInsert` missing,
  `:editor` hint missing.
- Component test appended to `tests/ink-app.test.ts`; PTY happy path appended
  to `tests/interactive.test.ts` (expect-based, `EDITOR` pointed at a shell
  script fixture).

### Phase 2 — implementation
- `src/ink/editor-suspend.ts`: resolution ($VISUAL → $EDITOR → vi, single
  token only), token blocklist (`editorTokensAreSafe`), `--` before the only
  dynamic spawn argument, `shell: false`, gated writes, raw-mode toggle,
  alt-screen exit/re-enter, bounded read (64KB) + char cap (8,000), temp dir
  cleanup in `finally`.
- Security-gate iterations: the Mimosa pre-tool-use scanner blocked two
  earlier drafts (env → spawn patterns). Final shape passes: validated single
  command token, fixed argument list `["--", filePath]`, `shell: false`,
  single spawn site. Multi-token editor values (`code -w`) are now refused by
  design (README documents the wrapper-script workaround).
- `runtime-store.ts`: `InkComposerInsert` + `setComposerInsert` +
  snapshot projection.
- `app.tsx`: `composerInsert` effect applies to ref-backed composer state and
  manages the truncation notice (paste vs editor).
- `index.ts`: gated render output; `:editor` branch with idle-only guard,
  SIGINT detach/reattach around the blocking spawn, bounded outcome notices.
- `tui-renderer.ts`: `:editor` hint (drives `:help` + palette).

### Test-fixed findings
- The fake PTY editor originally read `"$1"`, which is now `--`; it selects
  the argument starting with `/` instead.
- A pipe-mode refusal test was removed: with piped stdio the CLI falls back
  to line-oriented mode, so the Ink command path (and its TTY refusal) is not
  reachable there; the refusal stays covered by unit tests.
- Probe evidence (`/tmp/editor-pty-test/probe.out`): EACCES fixture produced
  the bounded `Editor failed: editor failed to start: EACCES` notice with the
  terminal restored and Ctrl-C still exiting cleanly — a real failure-path
  PTY observation before the happy path went green.

### Ink 7.1.1 follow-up (verified)
- The CLI now relies on Ink 7.1.1's public `alternateScreen`, `usePaste`, and
  `suspendTerminal` APIs. `runExternalEditor({manageTerminal: false})` keeps the
  editor helper from duplicating Ink's raw-mode and screen-buffer lifecycle.
- Native suspension can replay one command event buffered at the handoff. The
  runtime suppresses that one resumed event with a bounded timeout, while
  Ctrl-C remains a real cancellation signal.
- Targeted Ink/interactive coverage passed **95/95** and the full CLI suite
  passed **757/757** with no failures/cancellations/skips. Log:
  `/tmp/cli-ink7-full-final.log`.

### Verification (Ink 7.1.1 recheck, 2026-09-29)
- Source/test typechecks and package builds passed.
- Targeted Ink/editor/interactive coverage: **95/95**.
- Full CLI suite: **757/757 passed**, 0 failures/cancellations/skips; log
  `/tmp/cli-ink7-full-final.log`.
- Documentation contract: **60/60**; `git diff --check` clean.

### Verification (final, 2026-09-29)
- Full CLI suite (pre-upgrade closure): `pnpm --dir apps/cli exec sh -c 'node build-package.mjs &&
  node --test --test-concurrency=1 --test-timeout=120000
  tests-dist/*.test.js'` — **751/751 passed, 0 failed/cancelled/skipped**
  (was 737 before this feature; +12 unit, +1 component, +1 PTY), 314692ms,
  shell exit 0. Log: `/tmp/cli-editor-full-suite.log`.
- Documentation contract suite: **60/60** after repairing stale MCP-boundary
  assertions (see below).
- `git diff --check` clean. Source and test typechecks passed earlier in the
  session (`tsc -p tsconfig.json`, `tsc -p tsconfig.test.json`).

### Doc-contract repair (pre-existing debt, not caused by this feature)
- `tests/documentation-contract.test.mjs` asserted the pre-`6e607a7`
  always-shared MCP model ("shares their tool wrappers with workers",
  "registered once by the CLI at the project root") which no longer exists in
  `apps/cli/README.md`, `docs/architecture.md`, or
  `docs/gemini-cli-architecture-alignment.md`. Those docs now describe the
  `collaboration.mcpScope` model (`disabled` default / `shared` / `worker`),
  which matches the runtime (`apps/cli/src/index.ts:1908`). The contract
  assertions were updated to lock the current documented boundary; all five
  documents already matched, so no prose was changed for this repair.

### Cleanup
- Removed a stray `apps/cli/--` file created by the first (failing) PTY test
  run: the original fake-editor fixture appended to `"$1"`, which is `--`
  under the new `["--", filePath]` spawn shape. The fixture now selects the
  argument starting with `/`.
