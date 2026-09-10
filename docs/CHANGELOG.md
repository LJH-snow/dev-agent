# Changelog

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
