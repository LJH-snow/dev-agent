# Changelog

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
