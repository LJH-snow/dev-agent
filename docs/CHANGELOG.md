# Changelog

## 2026-09-12 (Day plan v18: strict CLI arguments)

Executed `docs/day-plan-v18.md`. A mistyped flag used to do the wrong thing
quietly, which is the worst failure mode for a CLI that scripts and CI drive.

### Fixed: unknown and malformed arguments are rejected
- `validateCliArgs()` declares every flag and how many values it consumes, and
  runs before anything else in `main()`.
- Unknown flag: `--nope` exited `0` and dropped into interactive mode; it now
  exits `1` with `Unknown option '--nope'.`
- Swallowed value: `--session --once hi` consumed `--once` as the session id and
  wrote `once.json`; a value may no longer start with `-`, so this exits `1`.
- Flag as prompt: `--once --json` sent the literal string `--json` to the model;
  it now exits `1` with `--once requires a value.`
- Stray positional: `dev-agent hello` silently started interactive mode; it now
  exits `1` with `Unexpected argument 'hello'.`
- Valid input is unchanged, including the optional values for `--compact` and
  `--check-rust` and the `-v` short flag.

### Tests
- TypeScript: 407 -> 413. Rust: 46; real-binary integration: 10.

## 2026-09-12 (Day plan v17: TypeScript-first test suite)

Executed `docs/day-plan-v17.md`. The test suite moved from hand-written ESM
JavaScript to TypeScript, so the repository is TypeScript-first end to end —
including the tests.

### Changed: tests are TypeScript now
- Every `tests/*.test.mjs` became `tests/*.test.ts` (73 files across
  `apps/cli`, `apps/desktop`, and the six packages), preserving git history.
- Each workspace gained a `tsconfig.test.json`: `rootDir: tests`,
  `outDir: tests-dist`, declarations/source maps off, and `strict` relaxed for
  test ergonomics. The `test` script compiles that config and then runs
  `node --test tests-dist/*.test.js`, so the Node test runner and the
  zero-extra-dependency policy are unchanged.
- `tests-dist/` is git-ignored, like `dist/`.
- Three fixtures stay `.mjs` because they are spawned as child processes:
  `fake-mcp-server`, `flaky-mcp-server`, and `mock-executor-binary`.
- README documents the two-step test pipeline.

### Removed
- `.gitattributes` no longer excludes `tests/**` and `scripts/**` from GitHub
  Linguist. That exclusion existed only because the tests were JavaScript files
  that out-weighed the TypeScript sources; with the tests in TypeScript it
  would under-count the real language. GitHub now reports TypeScript at about
  83.8% (was 38.1%), with JavaScript down to about 3.1% (was 48.8%).

### Tests
- TypeScript: 407 tests, still all passing after the migration; Rust: 46;
  real-binary integration: 10.

## 2026-09-12 (Day plan v16: recoverable tool errors, readable code-search positions)

Executed `docs/day-plan-v16.md`. Two failure paths made the agent unable to
help itself: a thrown tool error ended the whole run, and an out-of-range
`code-search` position surfaced a TypeScript debug failure.

### Fixed: tool errors are reported back to the model
- `AgentLoop` runs tools through a new `runToolSafely()`: an exception (including
  `Tool not found: X`) is written back as `{"error": "…"}` in that tool's
  result and the loop continues, so the model can correct its arguments or pick
  another tool. An abort still propagates, and `maxTurns` bounds a model that
  keeps calling a failing tool.
- Reproduction: a tool that threw `bad path` used to end after one model call
  with `status: "error"`; now the model gets a second turn and can finish.

### Fixed: `code-search` validates line and column
- `references`/`definition` used to hand the position straight to the TypeScript
  language service, so `line: 99` on a one-line file produced
  `Debug Failure. Bad line number` (and `line: 0` did the same).
- The requested position is now checked against the scanned source (and line and
  column must be >= 1), answering `code-search line 99 is beyond the end of …`
  or `… column 999 is beyond the end of line 1 …` instead.

### Tests
- TypeScript: 403 -> 407. Rust: 46 (unchanged).
- New coverage: missing tool recovered by the model, a throwing tool recovered
  by the model, a permanently failing tool stopped by `maxTurns`, and both
  out-of-range position cases.

## 2026-09-12 (Day plan v15: MCP reconnect state, sharper approval keys)

Executed `docs/day-plan-v15.md`. Two subtle states were wrong: a reconnected MCP
client kept its closed flag, and "always allow" collapsed `npm run test` and
`npm run build` onto the same key.

### Fixed: MCP client reconnect resets its closed flag
- `close()` sets `closed = true`; `connect()` never cleared it, so after
  `client.reconnect()` a later server crash skipped `rejectAll` and any pending
  request hung forever instead of failing. `connect()` now resets `closed` and
  the line buffer.
- The fake MCP server gained a `crash` tool that exits without answering, and a
  regression test races the call against a 2s timeout. Removing the fix makes
  that test fail with `expected a rejection, got timeout`.

### Fixed: the always-allow key keeps two leading arguments
- `normalizeApprovalKey()` used the first non-flag token only, so `npm run test`
  became `npm run` and approving it silently covered `npm run build` /
  `npm run deploy`; `git -C /repo status` similarly covered other git
  subcommands in that directory.
- The key is now the command plus up to two leading non-flag tokens. Existing
  equivalences still hold (`npm test` / `npm test -- --watch`,
  `git status` / `git status --short`,
  `chmod 777 x` / `chmod -R 777 x`), while different scripts and different
  `-C` subcommands stay separate.

### Tests
- TypeScript: 401 -> 403. Rust: 46 (unchanged).
- New coverage: MCP reconnect followed by a crashing server, and the
  two-argument approval key (npm scripts, `git -C`, `chmod` with/without `-R`).

## 2026-09-12 (Day plan v14: literal search, git exec options, corrupt metadata)

Executed `docs/day-plan-v14.md`. Three holes found by driving the tools rather
than reading them: the search query was parsed as ripgrep options, git could
spawn a shell through its own options without an approval, and `--metadata`
presented a corrupt session file as an empty one.

### Fixed: the `search` tool treats the query as a literal pattern
- `SearchTool` now passes `--` before the query, so `--files`, `--version`, or
  `--pre=…` are searched for instead of being interpreted by ripgrep. Before the
  change `--files` listed the directory and `--version` printed ripgrep's
  version; both looked like a successful search to the model.

### Fixed: git options that execute another process need approval
- `denyDangerousPolicy` gained a "git command execution" pattern covering `-c`
  (including `-calias…`), `--config-env`, `--exec-path`, `--upload-pack`, and
  `--receive-pack`. Reproduction: `git -c alias.probe=!echo injected-command-ran
  probe` printed `injected-command-ran` through the git tool while the policy
  reported nothing. Plain `git status` / `git log` / `git push origin main`
  stay allowed, and `approval.allow` still takes precedence.

### Fixed: `--metadata` explains a corrupt session file
- A file that exists but cannot be parsed now exits 1 with the path and
  `--reset-memory` / `--session-delete <id>` recovery hints instead of printing
  `No session metadata found.`; `--json` returns `{ error, path }`. A genuinely
  absent file, and a valid file that simply has no metadata, keep the old
  exit-0 behaviour.

### Tests
- TypeScript: 395 -> 401. Rust: 46 (unchanged).
- New coverage: literal `--files` / `-f` search queries, the git execution
  pattern plus its allowlist exemption, and the corrupt/missing/valid-but-empty
  `--metadata` cases.

## 2026-09-11 (Day plan v13: pattern coverage, async Python, depth-safe index)

Executed `docs/day-plan-v13.md`. All three fixes came from probing the running
code rather than reading it: the approval table missed long-option `rm` and
short force pushes, the Python scanner ignored `async def`, and a narrow
`code-search` call deleted deeper entries from the shared index.

### Fixed: the dangerous-command table matches both spellings
- `rm --recursive --force` was allowed while `rm -rf` was denied. The
  "recursive delete" pattern now accepts long and short recursion flags, uses a
  token boundary so `rm file-r.txt` is not a false positive, and still allows
  `rm --force file` because it is not recursive.
- `git push -f` and `git push origin +main` were allowed while
  `git push --force` was denied. The "force push" pattern now covers `-f`,
  `--force`, `--force-with-lease`, `--force-if-includes`, and `+refspec`;
  `git push --follow-tags` and branch names containing `-f` stay allowed.

### Fixed: the Python scanner sees `async def`
- Top-level `async def` becomes a `function`, class-level and decorated
  `async def` become `method` symbols with their class as `containerName`.
  `await some_call(...)` is not mistaken for a declaration.

### Fixed: a narrow `code-search` no longer prunes deeper index entries
- Reproduction: an index holding `shallow.ts` and `deep/nested/deep.ts` lost the
  deep file after a `maxDepth: 1` search, which rewrote the shared index.
- A loaded index is now restricted to the requested depth for that scan, and the
  write-back merges with the on-disk index: entries outside the scanned depth
  survive untouched, while a deep file that really is gone is still removed by a
  scan that covers its depth.

### Fixed: a disconnect drops a pending desktop approval
- When the SSE client went away while an `ask` prompt was open, the pending
  approval stayed in the server's map until the 120s timeout fired. The prompt
  is now settled as a denial and removed as soon as the request's abort signal
  fires, and the endpoint answers `404` for that id afterwards.

### Tests
- TypeScript: 389 -> 395. Rust: 46 (unchanged).
- New coverage: long-option `rm`, `-f`/`+refspec` pushes and their look-alike
  false positives, async Python functions and methods, and both directions of
  the depth-safe index write-back, plus a client-disconnect approval cleanup
  case.

## 2026-09-11 (Day plan v12: multi-language search, cache writes, config doctor)

Executed `docs/day-plan-v12.md`. These gaps only showed up once the pieces were
exercised end to end: the shared index silently lost Python/Rust entries, the
Rust scanner ignored `pub`, Anthropic cache writes were priced as plain input,
and a malformed config file failed without saying so.

### Fixed: `code-search` and `--index` now share one scope
- Reproduction: `--index` reported `files: 3, symbols: 2` for a TS/Python/Rust
  project, then `code-search` loaded the index (`loadedFromDisk: 1`) but
  returned zero hits for the Python/Rust symbols and rewrote the file with
  `rescanned: 2, persisted: 1` — the entries were pruned as "deleted".
- `code-search` now scans the same set as `--index`: `.ts`/`.tsx`/`.mts`/`.cts`,
  `.js`/`.jsx`/`.mjs`/`.cjs`, `.py`, `.rs`, depth 8, skipping
  `node_modules`/`dist`/`.git`/`.next`/`.cache`/`.dev-agent`. Symbol search
  covers all four languages; `references` and `definition` deliberately keep
  handing only TS/JS sources to the TypeScript language service.
- End-to-end check after the fix: `--index` 3 files / 3 symbols, one hit per
  language, `rescanned: 0, persisted: 0`.

### Fixed: the Rust scanner understands real Rust
- Visibility (`pub`, `pub(crate)`, `pub(in path)`) and item modifiers (`async`,
  `unsafe`, `const`, `default`, `extern "C"`) are stripped before matching, so
  `pub fn`/`pub struct`/`pub enum`/`pub type`/`pub mod`/`pub use` all produce
  symbols.
- `trait` becomes an `interface` symbol; functions inside `impl`/`trait` blocks
  are `method` symbols carrying `containerName`; `impl<T> Foo<T>` and
  `impl Trait for Foo` resolve to `Foo`; one-line `impl` blocks do not leak a
  container into the lines that follow.

### Added: Anthropic cache-write accounting and pricing
- `ChatUsage.cacheCreationPromptTokens` records Anthropic's
  `cache_creation_input_tokens` (inside `promptTokens`); streamed output-only
  deltas no longer risk double counting. `addUsage` keeps it in session totals.
- `ModelPrice.cacheCreationInputPerMillion` prices those tokens; prompt cost is
  now split into plain input, cache reads, and cache writes, each falling back
  to the input price when its own price is unset, with both cache buckets
  clamped to `promptTokens`.

### Added: `--doctor` validates the shared config
- The report gained a `config` check: a missing file is `ok` (defaults are
  used), a valid object is `ok` and lists the recognised sections, and invalid
  JSON, a non-object, or an unreadable file is a `warn` with the reason — the
  runtime readers still ignore it, but the user is no longer left guessing.

### Tests
- TypeScript: 379 -> 389. Rust: 46 (unchanged).
- New coverage: multi-language index round-trip (search + no pruning, with and
  without a persisted index), Rust visibility/modifier/trait/impl-method
  scanning, cache-write pricing with fallback, and the three config states in
  `--doctor`.

## 2026-09-11 (Day plan v11: MCP approvals, cache accounting, index repair)

Executed `docs/day-plan-v11.md`. Three boundaries that were still half-open:
MCP server mode bypassed the approval policy entirely, provider cache hits were
discarded before accounting, and a corrupt index file stayed broken forever.

### Added: `--mcp-server` obeys the approval policy
- The MCP branch now loads `~/.dev-agent/config.json`, resolves
  `--approval` / `approvalMode`, and runs every tool call through
  `denyDangerousPolicy` (built-in patterns plus `approval.deny`, with
  `approval.allow` exemptions).
- A denied call throws `[denied by approval policy] …`, which the MCP server
  returns as `{ isError: true }` with the reason, so the host model can adapt.
  MCP has no prompt channel, so `ask` behaves like `deny-dangerous` there.

### Added: cached prompt tokens are accounted for and priced
- `ChatUsage.cachedPromptTokens` records the cached part of the prompt. OpenAI
  maps `prompt_tokens_details.cached_tokens`; Anthropic maps
  `cache_read_input_tokens` and counts `cache_creation_input_tokens` as prompt
  tokens too (only the event carrying `input_tokens` contributes them, so a
  stream's output-only delta cannot double count). The field stays absent when
  a response reports no cache hits.
- `ModelPrice.cachedInputPerMillion` optionally prices that part at a discount;
  without it cached tokens use the regular input price. Cached counts are
  clamped to `promptTokens`, and `addUsage` carries them into session totals.

### Fixed: a corrupt persisted index is rewritten
- `code-search` already refreshed an index it had loaded; now, when the file
  exists but cannot be parsed (bad JSON, wrong version, missing fields), the
  full scan that follows replaces it with a valid
  `{ version, files, symbols, signatures }`. A missing index is still never
  created by a search, and a failed write is still ignored.

### Tests
- TypeScript: 368 -> 379. Rust: 46 (unchanged).
- New coverage: MCP gating (deny, allow, config allowlist), OpenAI/Anthropic
  cache parsing including a streaming no-double-count case, cache-aware pricing
  and its fallback/clamp paths, cached-token accumulation, and corrupt-index
  replacement.

## 2026-09-11 (Day plan v10: incremental indexing, session usage, rename UI)

Executed `docs/day-plan-v10.md`. This pass closes the loops v9 left open: the
symbol index refreshes itself instead of only being read back, token usage
survives the process that produced it, and the desktop exposes the session
rename API it already had.

### Changed: `--index` reuses unchanged files
- `indexDirectory` stats the tree first and loads the previous
  `.dev-agent/index.json`; files whose mtime/size signature still matches keep
  their stored sources and symbols instead of being re-read, changed or new
  files are rescanned, and deleted files drop out. First runs and malformed
  indexes still do a full scan.
- `IndexReport` gained `reused`; the human output reads
  `Indexed N files / M symbols (K reused)` and `--json` carries the field.

### Added: `code-search` writes refreshed scans back
- When a scan that started from `<root>/.dev-agent/index.json` finds changed or
  deleted files, the tool rewrites the refreshed
  `{ version, files, symbols, signatures }` to that file. It only touches an
  index that already exists, and a failed write never fails the search.
- `getCacheStats()` gained `persisted`; `InMemoryCodeIndex` gained
  `listSymbols()` for the write-back.

### Added: session token usage survives a restart
- `AgentMemory.recordUsage()` is awaited for every provider usage report.
  `InMemoryMemory` accumulates it in process; `FileMemory` merges it into the
  session file as `metadata.usage` (and `addUsage` moved to `usage.ts` so both
  paths share the arithmetic).
- CLI `--metadata` prints `Usage: prompt=… completion=… total=…`, and
  `--session-list --json` includes each session's `usage` (`null` when absent).
- Desktop `GET /api/sessions` returns `usage` plus a `cost` estimate made with
  the current model and `pricing` table; the chat header restores both when a
  session is switched or the page is reloaded.

### Added: desktop session rename control
- The picker gained a `Rename` button that prompts for a new id and calls the
  existing `POST /api/sessions/<id>/rename`, then reloads the list and history;
  conflicts and failures surface in the status line.

### Tests
- TypeScript: 359 -> 368. Rust: 46 (unchanged).
- New coverage: index reuse and `reused` reporting, code-search write-back
  (changed scan, unchanged no-write, no index created, failed write tolerated),
  usage accumulation in both memory implementations and through a full agent
  run, CLI metadata usage output, desktop session summaries with usage/cost,
  and the served rename control.

## 2026-09-11 (Day plan v9: index reuse, atomic patches, cost estimates)

Executed `docs/day-plan-v9.md`. The theme is making the agent's own bookkeeping
cheaper and more predictable: it reuses the index it already wrote, patches
files in one atomic edit, remembers approvals by intent instead of by exact
argument list, and can price the tokens it spends.

### Added: `code-search` reads back the persisted index
- `--index` now records per-file signatures (mtime + size) next to the symbol
  map in `<path>/.dev-agent/index.json`; the format stays `version: 1`, so
  `JsonFileCodeIndex.load()` keeps working.
- A cold `CodeSearchTool` cache loads that file first and only re-reads files
  whose signature changed, removing files that disappeared. Corrupt or
  version-mismatched files fall back to a full scan silently.
- `getCacheStats()` gained `loadedFromDisk`.

### Added: atomic multi-hunk `filesystem patch`
- `filesystem patch` takes `hunks: [{ oldText, newText }]`, applies them in
  order to an in-memory copy, requires every hunk to match exactly once and not
  overlap an earlier one, and writes the file only after all of them succeed.
  Errors name the failing hunk and the reason; the file stays untouched.
- The approval policy treats `patch` like `write`/`edit`/`mkdir`: targets
  outside the working directory are denied.

### Changed: "always allow" is keyed by command + subcommand
- `normalizeApprovalKey()` derives the key from the command name plus its first
  non-flag token, unwrapping `sh -c "…"` first. `npm test` and
  `npm test -- --watch`, or `git status` and `git status --short`, now share one
  decision; unrelated commands still prompt separately.
- The CLI and desktop session allowlists use the normalized key. The desktop
  `ApprovalPrompt.command` field became `key`.

### Added: usage cost estimation
- `@dev-agent/model` exports `PriceTable` and
  `estimateCost(usage, model, prices)`: the longest model-name prefix wins, and
  unknown models or malformed/negative prices return `undefined` rather than
  guessing.
- `~/.dev-agent/config.json` gained a `pricing` section
  (`{"gpt-4o-mini": {"inputPerMillion": 0.15, "outputPerMillion": 0.6}}`).
  The CLI appends `cost=$…` to `[usage]` and adds a `cost` field to `--json`;
  the desktop's `usage` SSE frame carries `cost` and the chat header accumulates
  it next to the token counter. Unconfigured or unmatched models print no cost,
  exactly as before.

### Tests
- TypeScript: 342 -> 359. Rust: 46 (unchanged).
- New coverage: persisted-index read-back (load, incremental re-read, deletion,
  corrupt fallback), multi-hunk patch (success, atomic failure, overlap,
  validation), normalized approval keys on both surfaces, and cost estimation
  (known model, unknown model, longest prefix, malformed entry) plus the CLI
  `cost=$…` output.

## 2026-09-11 (Day plan v8: editing, indexing, approval memory)

Executed `docs/day-plan-v8.md`. The headline is that the agent can finally
change code the way a coding agent should: by editing a snippet instead of
rewriting whole files.

### Added: unique-snippet editing and line-range reads
- `filesystem edit` replaces `oldText` with `newText` only when the snippet
  appears exactly once; a missing match, an ambiguous match, a missing
  `oldText`, or a missing `newText` is an error and the file stays untouched.
  An empty `newText` deletes the snippet.
- `filesystem read` accepts `offset` (1-based) and `limit` (2000 lines by
  default) and answers with `startLine`/`endLine`/`totalLines`/`truncated`, so
  large files can be read in slices.
- The approval policy treats `edit` like `write`: targets outside the working
  directory are denied.

### Added: `--index` symbol index command
- Scans a directory with the same ignore rules as `code-search`
  (`node_modules`, `dist`, `.git`, `.next`, `.cache`, `.dev-agent`) and writes
  `{ version, files, symbols }` to `<path>/.dev-agent/index.json`, a shape
  `JsonFileCodeIndex.load()` can read.
- Reports files, symbols, and a language breakdown; `--json` gives the same as
  an object. `.dev-agent/` is now git-ignored.

### Added: per-session approval memory
- CLI `ask` accepts `a` (or "always") to run a command and remember it for the
  rest of the process; the desktop prompt gained an "Always allow" button that
  posts `decision: "allow-always"`.
- The memory is keyed by the exact command line and lives in memory only; it is
  per session and never written to disk.

### Fixed
- The CLI's own `--index` run created `.dev-agent/index.json` files that were
  not ignored by git; they now are.

### Tests
- TypeScript: 329 -> 342. Rust: 46 (unchanged).
- New coverage: edit success/not-found/ambiguous/delete/validation, read
  pagination and past-the-end offsets, approval denial for out-of-workspace
  edits, the index command (scan, ignores, missing path), and approval memory
  on both the CLI and the desktop.

## 2026-09-11 (Day plan v7: interactive approvals, doctor, session deletion)

Executed `docs/day-plan-v7.md`, closing the approval boundary v6 left open and
adding the operational tooling that was missing for real use.

### Added: interactive approval prompts in the desktop UI
- `ChatSession.run` accepts a `requestApproval` callback; with `ask` it confirms
  flagged calls instead of denying them outright, and still denies when no
  requester is available.
- The server tracks pending approvals, emits `approval-request` over SSE, and
  answers `POST /api/approval`; unanswered prompts are denied after
  `DEV_AGENT_APPROVAL_TIMEOUT_MS` (default 120s).
- The chat UI renders Allow/Deny buttons and shows the resulting decision.

### Added: `dev-agent --doctor`
- Checks Node (>=20), `rg`, `protoc` (warn only), the Rust runtime binary
  (missing or failing health check is a failure; unconfigured is a warning),
  the provider API key, and whether the session directory is writable.
- `--doctor --json` prints `{ checks, summary }` and the process exits 1 when
  any check fails. The runtime health probe is shared with `--check-rust`.

### Added: session deletion
- CLI `--session-delete <id>` removes `<sessionDir>/<id>.json` and reports
  `{ sessionId, deleted }` with `--json`; a missing session is not an error.
- Desktop `DELETE /api/sessions/<id>` removes the file and forgets the session
  (404 when unknown), with a Delete button in the session picker.

### Tests
- TypeScript: 304 -> 315. Rust: 46 (unchanged this plan).
- New coverage: interactive approval (deny, allow, timeout), doctor checks
  (healthy, missing key, missing binary, JSON round trip), and session deletion
  on both surfaces.

### Fixed
- `streamChat` referenced a closure variable it could not see, which only
  surfaced once the desktop approval tests ran against a fresh build.
- Desktop tests bound the shared default port 4317; they now use port 0 so test
  files can run in parallel.

## 2026-09-11 (Day plan v6: approval policies, persistent digests, MCP resources)

Executed `docs/day-plan-v6.md`. The main line is a command-approval layer: the
sandbox decides how a command runs, nothing decided whether it should.

### Added: approval policies
- `packages/agent-core/src/approval.ts`: `ApprovalPolicy`, `ApprovalRequest`
  (tool, input, session, working directory), `ApprovalOutcome` (decision plus
  reason), `allowAllPolicy()`, and `denyDangerousPolicy()`.
- The dangerous table covers recursive delete, `sudo`, `mkfs`, `dd of=`, power
  control, force push, pipe-to-shell, `chmod 777`, fork bombs, `git reset
  --hard`/`clean -f`, and privileged containers; extra patterns can be added.
  Filesystem writes outside the working directory are blocked too.
- `AgentLoop` consults the policy before each tool call. A denial is written
  back as that tool's result so the model can adapt, a throwing policy counts as
  a denial, and no policy means every call runs exactly as before.

### Added: CLI `--approval allow|deny-dangerous|ask`
- `--approval` wins over `DEV_AGENT_APPROVAL`, which wins over the config file's
  `approvalMode`; invalid values are rejected (flag) or ignored (env/config).
- `ask` confirms flagged calls with `y/N`, reusing the interactive readline
  interface and falling back to one line of stdin for `--once`. Anything but
  `y`, EOF, or a read failure denies the call.

### Added: desktop approval
- `DEV_AGENT_APPROVAL` and `ChatSessionOptions.approvalMode`. The web UI has no
  approval prompt yet, so `ask` maps to `deny-dangerous` rather than silently
  running the command.
- New `approval` SSE frame `{ tool, decision, reason }`; the chat UI renders a
  `[denied]` line for denials.

### Added: persistent, length-capped context digests
- `AgentMemory` gained optional `getSummary`/`setSummary`. `FileMemory` stores
  the digest alongside the session (optional field, older files still load) and
  `InMemoryMemory` keeps it in process, so a new run reuses it instead of
  summarizing the same history again.
- The digest re-anchors by the id of its last covered entry: when compaction
  removed that entry the digest text is kept while new trims are summarized.
- `summaryMaxChars` (default 2000) caps the digest, and
  `DEV_AGENT_SUMMARY_MAX_CHARS` / `summaryMaxChars` expose it.

### Added: MCP server resources and prompts
- Server mode implements `resources/list`, `resources/read`, `prompts/list`,
  and `prompts/get` and advertises both capabilities.
- `--mcp-server` serves `dev-agent://session` (id, working directory,
  timestamps, memory size), `dev-agent://workspace` (top-level entries),
  `review-changes`, and `explain-codebase` (optional `focus` argument).

### Tests
- TypeScript: 270 -> 297. Rust: 43 (unchanged).
- New coverage: approval policies and their loop integration, CLI mode
  resolution plus three approval round trips, desktop denial over SSE, digest
  reuse/compaction/clamping/persistence, and MCP resources and prompts
  (including the host-script round trip).

## 2026-09-11 (Development plan v5: graceful termination, context summaries)

Executed `docs/night-plan-v5.md`, closing the two boundaries v4 left open:
cancellation went straight to SIGKILL (and could orphan a sandboxed command),
and the context budget dropped old history outright.

### Added: graceful process-group termination
- Commands now run in their own process group — `process_group(0)` in the Rust
  runtime, `detached: true` in the TypeScript `LocalExecutor` — so a termination
  signal reaches the whole tree, including `sandbox-exec`/`bwrap` wrappers.
- Cancellation and timeouts send SIGTERM first and SIGKILL only after a
  two-second grace period; commands that exit on SIGTERM are unaffected, and
  commands that ignore it are still stopped. Output truncation keeps ending
  immediately.
- Non-Unix falls back to killing the single process.

### Added: incremental context summarization
- `contextBudget.summarize` (default off) replaces the
  `[context] N earlier entries omitted` notice with a model-written
  `[summary]` digest. Only newly trimmed entries are summarized, and the digest
  is extended rather than regenerated.
- Summarization tokens count toward the session usage and fire `onUsage`; a
  failed summary falls back to the omission notice and the run continues.
- CLI: `DEV_AGENT_SUMMARIZE_CONTEXT` / `summarizeContext`; desktop:
  `ChatSessionOptions.summarizeContext` with the same env fallback.
- Known boundary: the digest lives on the `AgentLoop` instance, so the desktop
  (which builds a loop per run) regenerates it once per run. Persisting it in
  memory metadata is the follow-up if that cost matters.

### Tests
- TypeScript: 262 -> 270. Rust: 42 -> 43.
- New coverage: SIGTERM-ignoring commands on both executors, summary replacing
  the notice, incremental summarization, summary tokens in usage, summary
  failure fallback, and a CLI round trip where the provider receives the
  `[summary]` message.

## 2026-09-11 (Development plan v4: cancellation, usage, MCP server)

Executed `docs/night-plan-v4.md`, which closed the gaps v3 left behind:
interrupts only stopped at turn boundaries, token usage was invisible, and
dev-agent could consume MCP servers but not act as one.

### Added: cancelling a running tool
- `Envelope` gains `cancel = 5` with `CancelRequest { request_id }`. The
  cancelled run answers `ErrorResult { code: "CANCELLED" }`; the cancel itself
  is not acknowledged separately.
- `dev-agent-executor` now reads envelopes concurrently with running commands
  and tracks a `oneshot` sender per in-flight request id, so a cancel can
  arrive mid-command and kill its child process. This replaces the previous
  strictly-serial execution model.
- `ExecutorRunOptions.signal` aborts a run: `LocalExecutor` kills the child and
  rejects with `ExecutorCancelledError`; `RustExecutor` sends the cancel
  envelope and rejects when the runtime answers `CANCELLED`. `RustExecutor`
  gained the same default concurrency limit as `LocalExecutor` (5).
- The loop forwards its run signal into `ToolExecutionContext.signal`, and
  shell/git/search pass it to the executor, so a disconnect stops the command.
- Fixed two latent `RustExecutor` bugs the new tests exposed: concurrent first
  calls could spawn two runtimes, and `dispose()` left the instance unusable.

### Added: desktop end-to-end coverage
- New e2e suite with a local OpenAI-compatible SSE stub driving a real
  `ChatSession` and `startServer`.
- Disconnecting the client is proven to kill a running command: the tool
  touches a start marker, sleeps, then touches a finish marker that never
  appears.
- `DEV_AGENT_MAX_CONTEXT_CHARS` is verified through the real session, and the
  `usage` SSE event is asserted end to end.

### Added: token-usage accounting
- `ChatUsage { promptTokens, completionTokens, totalTokens }` on
  `ChatCompletion`; all four providers map their own field names, including
  usage from a stream's final event (Anthropic merges `message_start` and
  `message_delta`). Responses without usage stay undefined.
- `AgentLoop` fires `onUsage` per turn and accumulates the session total on
  `AgentContext.usage`, so it survives across runs.
- CLI prints `[usage] prompt=… completion=… total=…`; the desktop emits a
  `usage` SSE event and the UI shows a running token counter.

### Added: MCP server mode
- `createMcpServer({ tools })` speaks newline-delimited JSON-RPC 2.0 over
  stdio: `initialize`, `ping`, `tools/list`, `tools/call`. Tool implementations
  are injected, so `@dev-agent/mcp` keeps no dependency on `@dev-agent/tools`.
- Tool execution failures answer `{ isError: true }` for the host model, while
  unknown tools (-32602) and methods (-32601) are protocol errors.
- `apps/cli --mcp-server` exposes the built-in tool set with no model provider
  and keeps stdout protocol-only.

### Tests
- TypeScript: 237 -> 262. Rust: 39 -> 42.
- New coverage: Rust cancellation (unit + real-binary), LocalExecutor and
  RustExecutor aborts plus the concurrency limit, tool-signal forwarding, the
  desktop interrupt/context-budget/usage e2e suite, per-provider usage parsing,
  and the MCP server unit tests plus a CLI host-script round trip.

## 2026-09-11 (Night plan v3: quotas, context budget, retries, interrupts)

Executed `docs/night-plan-v3.md` end to end. The through-line is making the
sandbox path and long sessions behave under real use rather than only in the
happy path.

### Added: Rust runtime output quota
- `RunRequest.max_output_bytes` (field 7) and `RunResult.bytes_truncated`
  (field 5) extend the protobuf protocol; both are optional/backward compatible,
  and a client that omits the limit gets a 1 MiB default rather than unbounded
  capture.
- The Rust `LocalExecutor` streams stdout/stderr instead of buffering with
  `wait_with_output`, stops at the per-stream limit, kills a child that would
  otherwise block on a full pipe, and reports the truncation.
- `RustExecutor` forwards `maxOutputBytes` (default 1 MiB) and surfaces
  `bytesTruncated` on the result, so the quota that already existed in the
  TypeScript `LocalExecutor` now also applies when the sandbox is enabled.
- The stdio binary is documented as strictly serial: it reads the next envelope
  only after the current command finished.

### Added: Agent context budget
- `AgentLoopOptions.contextBudget.maxChars` bounds the history sent to the
  model. Oldest entries are dropped first, an assistant tool call is never
  separated from its tool results, the system prompt and the newest entry are
  always kept, and a `[context] N earlier entries omitted` system message
  announces the drop. Unset means the full history, exactly as before.
- CLI: `DEV_AGENT_MAX_CONTEXT_CHARS` (over `maxContextChars` in the config file).
- Desktop: `ChatSessionOptions.maxContextChars` with the same env fallback.

### Added: code-search incremental caching
- `InMemoryCodeIndex.removeFile()` (declared on `CodeIndex`) drops a file's
  symbols so a cached index can be updated in place.
- `CodeSearchTool` caches the symbol index, per-file signatures, and sources per
  scan root. A repeated search re-reads only files whose size or mtime changed,
  drops deleted files, and reuses cached sources for `references`/`definition`.
  `getCacheStats()` reports hits/misses/rescanned.
- On this repository a repeated `AgentLoop` symbol search dropped from 261ms to
  65ms with identical results.

### Added: model retry and rate-limit handling
- New `retry` module: 429/5xx and network failures retry with exponential
  backoff and jitter; other 4xx fail immediately; aborts are never retried.
  `Retry-After` is honoured in delta-seconds and HTTP-date form, capped at 2s.
- All four providers share the wrapper, configured via
  `ProviderConfig.retry` (defaults: 2 retries, 250ms base, 2s cap).
- `streamChat` only retries the initial request, so tokens already delivered to
  the caller are never duplicated.

### Added: desktop interrupts and concurrency protection
- `AgentLoop.run` accepts an optional `AbortSignal`, checked before each turn
  and tool call and forwarded to the model request; interruptions are rethrown
  instead of being recorded as a failed turn.
- A client disconnect aborts the run and closes the stream with
  `done { "status": "aborted" }`; a second concurrent `POST /api/chat` is
  rejected with 409 so two runs never interleave one conversation state.
- Documented boundary: an already-running tool call is not killed.

### Tests
- TypeScript: 206 -> 237. Rust: 35 -> 39.
- New coverage: Rust output truncation (unit + real-binary integration), the
  macOS test interpreter discovery, context-budget trimming and CLI wiring,
  code-search cache hits/invalidations, model retry policy, and desktop
  abort/409 behaviour.

## 2026-09-10 (Sandbox network test interpreter discovery)

### Fixed: macOS network tests asserted on the Xcode python3 stub
- `sandbox_executor_denies_network_when_disabled` and
  `sandbox_executor_allows_loopback_network_when_loopback` hardcoded
  `/usr/bin/python3`. On machines without full developer tools that path is a
  stub which shells out to `xcode-select`; the sandbox profiles under test deny
  writes to `/dev/null`, so the stub aborted before Python started and the
  assertions checked the stub's error instead of the network policy. Both tests
  failed locally while passing on CI, where `/usr/bin/python3` is a real
  interpreter.
- The tests now resolve an interpreter by probing candidates outside the
  sandbox: `DEV_AGENT_TEST_PYTHON`, then `python3` from `PATH`, then
  `/usr/bin/python3`, `/opt/homebrew/bin/python3`, and `/usr/local/bin/python3`.
  Candidates that cannot run are skipped, so a broken stub no longer masks the
  behaviour under test.
- With no usable interpreter the two tests skip with an explanatory message
  instead of reporting a failure. The sandbox policy behaviour is unchanged;
  only the interpreter the tests drive it with.

### Tests
- Rust: 33 passed / 2 failed -> 35 passed. Verified both network tests still
  exercise the policy by pointing `DEV_AGENT_TEST_PYTHON` at a nonexistent
  binary and confirming the probe falls through to a working interpreter.

## 2026-09-10 (Release pipeline)

### Added: tag-driven release workflow
- `.github/workflows/release.yml` builds `dev-agent-executor` for
  `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, and
  `aarch64-unknown-linux-gnu`, packages each as `.tar.gz` with a `.sha256`
  checksum, and attaches them to a GitHub Release on a `v*` tag.
- The macOS targets build natively on `macos-latest`; the Linux arm64 target
  cross-compiles on `ubuntu-latest` with `gcc-aarch64-linux-gnu`.
- Manual `workflow_dispatch` runs build and upload the artifacts without
  publishing a release, so the pipeline can be verified without cutting a tag.
- Checksum files record only the archive name, so `shasum -a 256 -c` works next
  to the downloaded files rather than expecting the CI build directory.

Verified end to end: a dispatched run built all four targets and uploaded four
artifacts; the downloaded macOS arm64 archive contained a Mach-O arm64 binary
that answered `--check-rust` with runtime version `0.1.0` and capabilities
`run, run_sandboxed`.

## 2026-09-10 (Config file wiring and sandbox binary selection)

### Fixed: the config file was never read
- `apps/cli/src/config.ts` implemented `parseConfig`/`loadConfig` with unit tests,
  but nothing in the CLI called them: `~/.dev-agent/config.json` had no effect at
  all, despite being documented as supported.
- The CLI now loads it and applies it to provider selection (`defaultProvider` /
  `defaultModel`), the agent turn budget (`maxTurns`), and MCP servers
  (`mcpServers`). Environment variables and CLI flags take precedence, so an
  explicit invocation always overrides a saved preference. A malformed config
  file is ignored rather than fatal.

### Fixed: DEV_AGENT_RUST_BINARY did not reach tool execution
- The variable was only read inside `--check-rust`, so setting it left real tool
  runs on `LocalExecutor` -- the sandbox was silently bypassed. The CLI's own
  error message told users to set it, and the root README pointed at it too.
- `--rust-executor <path>` / `--check-rust <path>` now win, then
  `DEV_AGENT_RUST_BINARY`, and that resolved path is what builds the executor.
  `ChatSession` in the desktop app honours the same variable.

### Docs
- `apps/cli/README.md` gained the missing `--metadata`, `--session-list`,
  `--compact`, `--no-stream`, `--rust-executor`, and `--check-rust` options, the
  `DEV_AGENT_RUST_BINARY` variable, and a configuration-file section describing
  the keys and their precedence.

### Tests
- New `apps/cli/tests/config-file.test.mjs` (3 tests): a config file's
  `defaultProvider` is applied, an environment variable overrides it, and a
  malformed config still lets the CLI run. These point `HOME` at a scratch
  directory so they never touch a developer's real config.
- New `apps/cli/tests/rust-executor-wiring.test.mjs` (2 tests): against a local
  OpenAI-compatible stub, a streamed tool call is executed through
  `RustExecutor` when `DEV_AGENT_RUST_BINARY` is set, and through
  `LocalExecutor` when it is not.
- Config resolver unit tests cover flag/env precedence for the binary path,
  provider, model, and turn budget.
- `apps/cli` tests: 23 -> 33. TypeScript tests: 196 -> 206.

## 2026-09-10 (CLI session directory consistency)

### Fixed: DEV_AGENT_SESSION_DIR only affected listing
- `sessionDir()` honoured `DEV_AGENT_SESSION_DIR` for `--session-list`, but
  `createMemory()` built its path from `homedir()` directly. Setting the variable
  therefore pointed the listing at an empty directory while `--session`,
  `--metadata`, and `--compact` kept reading and writing
  `~/.dev-agent/sessions` -- the CLI's own sessions never appeared in its own
  listing, contradicting the documented behaviour.
- `createMemory()` now resolves through `sessionDir()`, so all four commands use
  the same directory. `DEV_AGENT_MEMORY_FILE` still takes precedence.

### Docs
- `apps/cli/README.md` now documents `DEV_AGENT_SESSION_DIR`, which was
  previously only mentioned in the changelog.

### Tests
- New `apps/cli/tests/session-dir.test.mjs` (3 tests): `--metadata` and
  `--compact` operate on the configured session directory, and
  `DEV_AGENT_MEMORY_FILE` still wins. Tests use a unique session id so a failure
  cannot read or mutate a developer's real sessions.
- `apps/cli` tests: 20 -> 23. TypeScript tests: 193 -> 196.

## 2026-09-10 (Desktop server hardening)

### Fixed: client errors were reported as server errors
- `POST /api/chat` with a malformed or empty JSON body threw out of `JSON.parse`
  and surfaced as a 500. Both cases now return 400 with a clear message, so a bad
  request is no longer indistinguishable from a server fault.
- Static file misses returned 500 as well: requesting a missing `/public/*` asset
  or the directory itself propagated `readFile`'s ENOENT/EISDIR to the catch-all
  handler. `serveFile` now maps unreadable paths to a 404.

### Note on `/public/` path traversal
- The `/public/` handler normalizes the request path through `new URL`, which
  resolves `..` segments before `join`, and `join` does not re-base on absolute
  segments — so the prefix check is not reachable via traversal. Percent-encoded
  parent segments resolve to a literal directory name and now return 404 rather
  than 500. This was verified with tests that send the raw path (fetch normalizes
  `..` client-side, which is why an earlier test passed for the wrong reason).

### Tests
- New `apps/desktop/tests/server-edge-cases.test.mjs` (11 tests): missing static
  assets, directory requests, malformed and empty JSON bodies, non-string
  messages, health content type, streamed `error` events when a session throws,
  encoded and raw parent-segment paths, and successful static serving.
- `apps/desktop` tests: 5 -> 16. TypeScript tests: 182 -> 193.

## 2026-09-10 (Built-in tools hardening)

### Fixed: code-search ignored relative file paths
- `CodeSearchTool` builds its index from absolute paths but passed the `file`
  input through verbatim. A relative path -- what a model naturally emits, e.g.
  `src/agent.ts` -- matched nothing, so `references` silently returned
  `count: 0` and `definition` returned `undefined`, with no error.
- `file` is now resolved against the scanned root (the working directory by
  default), so relative and absolute paths both work.

### Fixed: filesystem write silently discarded non-string content
- `write` accepted any `content` type and coerced non-strings to `undefined`,
  which wrote an empty file. A model sending structured content would silently
  clobber a file instead of getting an error.
- `content` must now be a string when provided; omitting it still writes an
  empty file.

### Tests
- New `packages/tools/tests/tools-edge-cases.test.mjs` (26 tests) covering the
  built-in tools beyond their happy paths: filesystem write/read round-trips,
  `mkdir`, `stat` and input validation; shell and git argument validation and
  the exact command/args/cwd forwarded to the executor; search argument
  construction; and code-search relative paths, kind filtering, `limit`, and
  `node_modules`/`dist` skipping.
- `packages/tools` tests: 10 -> 36. TypeScript tests: 156 -> 182.

## 2026-09-10 (Model streaming hardening)

### Fixed: streaming dropped tool calls, breaking tool use
- The agent loop calls `streamChat` whenever `onToken` is set, and the CLI enables
  token streaming by default. All four providers returned only `{ content }` from
  `streamChat`, so `completion.toolCalls` was always empty: the loop saw zero tool
  calls and ended the turn without ever running a tool. Tool use was effectively
  broken in streaming mode for every provider.
- `streamChat` now surfaces tool calls:
  - OpenAI accumulates `tool_calls` deltas by index (id, name, concatenated
    arguments) and parses the assembled JSON.
  - Anthropic tracks `content_block_start` `tool_use` blocks and concatenates
    `input_json_delta` fragments before parsing.
  - Gemini collects `functionCall` parts from streamed candidates.
  - Ollama collects `message.tool_calls` from each NDJSON chunk (the array was
    declared and returned but never populated).

### Fixed: the final streamed event was dropped
- Every provider kept a partial-line buffer but never flushed it when the stream
  ended, so a final event without a trailing newline was silently lost.
- OpenAI additionally stopped on `[DONE]` only inside the inner line loop, so
  events arriving after `[DONE]` were still parsed; the stream now terminates.

### Tests
- New `packages/model/tests/streaming.test.mjs` (25 tests): token accumulation and
  `onToken`, events split across chunk boundaries, multi-byte characters split
  mid-UTF-8, `[DONE]` termination, trailing-event flush, malformed payloads,
  non-OK and body-less responses, abort-signal forwarding, and streamed tool
  calls for all four providers.
- New `packages/agent-core/tests/streaming-tool-calls.test.mjs`: wires the real
  OpenAI provider (fake `fetch`) into `AgentLoop` and asserts the streamed tool
  call is actually executed. Existing streaming tests used a mock provider that
  returned tool calls directly, which is why they never caught this.
- TypeScript tests: 130 -> 156.

## 2026-09-10 (CI + build hardening)

### Continuous integration (`.github/workflows/ci.yml`)
- Added a GitHub Actions workflow that runs on push to `main`, pull requests, and
  manual dispatch:
  - TypeScript job (ubuntu, Node 26 via `.nvmrc`, pnpm 12.3.4): `pnpm install
    --frozen-lockfile` -> structure check -> build -> typecheck -> test.
  - Rust job (ubuntu, stable toolchain): `cargo fmt --check`, `cargo clippy
    --all-targets -- -D warnings`, `cargo test`.
- Validated the workflow with `actionlint`.
- Added `.nvmrc` pinning Node 26 and a CI status badge in the root README.

### Fixed: root `clean` script caused infinite recursion
- `pnpm clean` is a **built-in pnpm command** (it removes `node_modules`
  directories) and a same-named script in `package.json` overrides it. The root
  `"clean": "pnpm -r clean"` therefore re-entered the root script recursively,
  spawning processes until it was interrupted instead of removing `dist`.
- Root delegating scripts now use the explicit `run` verb
  (`pnpm -r run build|typecheck|test|clean`), which avoids built-in collisions and
  correctly skips the workspace root. Added a root `test` script.

### Build ordering
- Documented and wired the required order on a fresh checkout: `build` before
  `typecheck`/`test`, because workspace packages resolve each other through
  `dist/*.d.ts`, which only exist after a build.

### Rust lint gates
- `cargo fmt --check` is now clean.
- Resolved all `cargo clippy --all-targets -- -D warnings` findings: gated the
  Linux-only `ro_bind_if_exists`/`build_bwrap_args` helpers with
  `#[cfg(any(target_os = "linux", test))]`, switched to `std::io::Error::other`,
  and moved `impl Default for SandboxExecutor` before the test module.

## 2026-09-10 (Night Build v4)

### Network policy enforcement via Starlark (`runtime/rust`)
- Fixed a bug where `ctx.network_policy` exposed the Rust enum Debug output
  (e.g. `"NetworkDisabled"`) instead of the documented lowercase labels
  (`"enabled"`, `"disabled"`, `"loopback"`, `"unspecified"`). This silently broke
  the example policy's `check_network_policy` function. Added a
  `network_policy_label` helper that maps the prost-generated enum to the
  documented lowercase contract.
- Added Starlark-level unit tests for network policy decisions: the policy script
  can now deny network commands (e.g. `curl`, `wget`) when `network_policy ==
  "disabled"` and allow them when `"enabled"`, and the example policy's
  `check_network_policy` function is verified end to end.
- Rust tests: 31 → 35 passing (+4 network policy tests).

### Documentation
- Updated root `README.md` Roadmap to mark items 5–8 as done, consolidated the
  stale "Current Status (v2)" section, and refreshed the Rust runtime progress
  section to reflect the active Linux `bwrap` backend and Starlark network policy.
- Updated `docs/README.md` to reflect the implemented desktop shell, Linux `bwrap`
  backend, and Starlark `ctx.network_policy` contract.

## 2026-09-10 (Night Build v3)

### Desktop shell (`apps/desktop`)
- New `@dev-agent/desktop` package: a local web server with a streaming chat UI.
- `src/server.ts` serves a static HTML chat UI and streams chat responses from
  `POST /api/chat` as Server-Sent Events (`token`, `tool`, `tool-result`, `turn`, `done`, `error`).
- `src/chat-session.ts` builds the `AgentLoop` with the default tools and model
  provider, and bridges its streaming callbacks to SSE events. Reuses
  `@dev-agent/agent-core`, `@dev-agent/model`, `@dev-agent/tools`, `@dev-agent/mcp`,
  and `@dev-agent/executor`.
- Single-page dark/light chat UI in `public/index.html` (vanilla JS, no build step).
- Configurable via env vars (`DEV_AGENT_MODEL_PROVIDER`, `DEV_AGENT_DESKTOP_HOST`,
  `DEV_AGENT_DESKTOP_PORT`, `DEV_AGENT_MEMORY_FILE`). Health check at `GET /health`.
- New HTTP-level tests covering the UI, health, chat SSE stream, and 404 handling.

### CLI streaming and session management hardening
- Agent loop now wires `onToken`, `onToolCall`, `onToolResult` callbacks so tokens
  print live and tool activity is shown with color in interactive and `--once` modes.
- New `--no-stream` flag disables live token output (falls back to printing the final answer).
- New `--session-list` command enumerates saved sessions sorted by recency, showing
  file size and last-modified time. Honors `DEV_AGENT_SESSION_DIR` for the sessions directory.
- New E2E tests for `--session-list` (empty and populated) and `--no-stream`.

### Linux bubblewrap backend (`runtime/rust`)
- `RestrictedExecutor` now has a real `#[cfg(target_os = "linux")]` execution path
  using `bwrap` (bubblewrap) instead of returning `Unsupported`.
- `build_bwrap_args` is a pure function (testable on any host) that constructs the
  bubblewrap argument list: namespace unsharing (`--unshare-user-try`, `--unshare-ipc`,
  `--unshare-pid`, `--unshare-uts`, `--unshare-cgroup-try`), read-only root filesystem
  with per-distro path detection, writable/read-only path bind mounts, network policy
  (`--unshare-net` for disabled/loopback), environment injection (`--setenv`), cwd
  enforcement (`--chdir`), and `--die-with-parent`.
- Resource limits (`setrlimit`) now shared across macOS and Linux backends
  (CPU, FSIZE, NOFILE, NPROC, CORE).
- Linux-only live `bwrap` integration test (skipped when `bwrap` is not installed).
- New unit tests for the argument builder: namespace flags, network policy toggling,
  writable/readonly binds, environment variables.

## 2026-09-10 (Night Build v2)
