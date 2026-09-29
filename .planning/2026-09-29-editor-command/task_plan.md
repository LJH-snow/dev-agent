# `:editor` command — compose prompts in an external editor

## Goal
Implement the first Phase 5 backlog item from
`.planning/2026-09-28-ink-tui-input-and-rendering/task_plan.md`: an `:editor`
command that suspends the Ink TUI, opens `$VISUAL`/`$EDITOR` (fallback `vi`)
on a bounded temp file, and loads the saved content into the composer draft.
No new runtime dependencies; every guard fails closed; bounded I/O only.

## Design

- New module `apps/cli/src/ink/editor-suspend.ts`:
  - `resolveEditorCommand(env)`: `$VISUAL` → `$EDITOR` → `vi`; whitespace
    token split (first token = command, rest = args; no shell, no quoting).
  - `normalizeEditorContent(raw)`: CRLF → LF, strip one trailing newline,
    cap at `MAX_EDITOR_CHARS = 8_000` (parity with `MAX_PASTE_CHARS`).
  - `createGatedWriteOutput(output)`: proxy that drops Ink frame writes while
    paused so the suspended session cannot corrupt the editor's screen.
  - `runExternalEditor(deps)`: orchestrates temp file (mkdtemp 0o700, file
    0o600, bounded read), suspend (pause writes → exit alt screen → raw off),
    `spawnSync(editor, [args..., file], { stdio: "inherit" })`, resume (raw on
    → re-enter alt screen → unpause), bounded read + normalize, temp cleanup
    in `finally`. Refusals: win32 platform, non-TTY stdin. Failures report
    bounded detail (exit code / signal / errno) without command output.
- `index.ts` handleCommand: `:editor` and `/editor` alias handled while idle
  only (busy, queued prompts, or active task → notice, fail closed). SIGINT
  listener is detached during the editor so a Ctrl-C that kills the editor
  does not cascade into session cancel; it is re-attached after resume.
  Outcome notices: loaded (+truncation), empty, failed, refused.
- Composer draft insertion: `InkRuntimeStore.setComposerInsert(value,
  truncated)` exposes a monotonic-id `composerInsert` on the snapshot; the
  Ink app applies it to `composerRef`/render state in an effect (same
  ref-backed pattern as paste) and surfaces a truncation notice.
- Command hint `{ command: ":editor", ... }` added to `DEFAULT_COMMAND_HINTS`
  so `:help` and the command palette advertise it.

## Phases

- [x] Phase 0 — recon: command flow (`nextPrompt` → `handleCommand`),
      render output wrapper, alternate-screen session, composer ref state.
- [x] Phase 1 — RED contracts: `tests/ink-editor-suspend.test.ts` (unit),
      composer-insert component test, real-PTY happy path in
      `tests/interactive.test.ts` (a pipe-refusal test was dropped: piped
      stdio falls back to line-oriented mode, so the Ink path is unreachable
      there; refusal stays covered by unit tests).
- [x] Phase 2 — implement module, store field, app effect, command wiring.
- [x] Phase 3 — docs: `apps/cli/README.md`, `docs/CHANGELOG.md`, `:help` hints.
- [x] Phase 4 — verification: typecheck, builds, targeted suites, full CLI
      suite, documentation contract, `git diff --check`.

## Constraints

- No new runtime dependencies; no shell invocation; no quoting semantics.
- Editor writes to a private temp file, read back bounded (≤ 8,000 chars,
  bounded byte read), never logged; temp dir removed on every exit path.
- Idle-only; refusal notices are explicit; pipe/JSON/once/MCP modes unaffected.
- Preserve all existing dirty/untracked work; no resets or broad formats.

## Closure evidence (2026-09-29)

- RED→GREEN: `tests-dist/ink-editor-suspend.test.js` 12/12 (RED first:
  module import failure, then store/hint failures).
- Real-PTY happy path green ("Ink TTY composes a prompt in $EDITOR and loads
  it into the composer", ~1.1s); a manual PTY probe also captured the bounded
  EACCES failure notice with the terminal restored — failure path observed,
  not just inferred.
- Full CLI suite: **751/751 passed, 0 failed** (`node build-package.mjs &&
  node --test --test-concurrency=1 --test-timeout=120000
  tests-dist/*.test.js`), 314692ms, shell exit 0. Log:
  `/tmp/cli-editor-full-suite.log`.
- Documentation contract **60/60** (includes repair of stale pre-`6e607a7`
  MCP-boundary assertions — recorded in progress.md). `git diff --check`
  clean. Typecheck (source + tests) clean.
