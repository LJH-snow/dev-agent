# dev-agent

[![CI](https://github.com/LJH-snow/dev-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/LJH-snow/dev-agent/actions/workflows/ci.yml)

An AI coding agent for developers, built with TypeScript and Node.js.

Phase 1 is a pnpm workspace monorepo made of small TypeScript packages. Low-level
capabilities such as sandboxing, process isolation, and filesystem security live
in the Rust runtime under `runtime/rust`; both the macOS (`sandbox-exec`) and
Linux (`bwrap`) backends are active.

## Structure

```text
dev-agent/
|-- apps/
|   |-- cli/              Primary phase-1 entry point
|   `-- desktop/          Local web server with a streaming chat UI
|-- packages/
|   |-- agent-core/       Agent loop, context, memory, agent state
|   |-- model/            Unified LLM provider interface (OpenAI, Anthropic, Gemini, Ollama)
|   |-- tools/            Tool registry and built-in tools
|   |-- mcp/              MCP client and MCP tool integration
|   |-- code-intelligence/ TypeScript/AST symbol scanner, code index, and ranked search
|   `-- executor/         Executor abstraction; phase 1 provides LocalExecutor
|-- runtime/
|   `-- rust/             Active Rust runtime for sandbox and isolation
|-- configs/              Shared TypeScript configuration
|-- docs/                 Project documentation
|-- tests/                TypeScript test suites, compiled to tests-dist/ before running
|-- scripts/              Dev and verification scripts
|-- package.json
|-- pnpm-workspace.yaml
|-- tsconfig.json
|-- README.md
`-- LICENSE
```

## Getting Started

Requires Node.js >= 20 (see `.nvmrc`, currently 26) and pnpm 12.3.4.

Additional tools used by the build and tests:

- `rg` (ripgrep) — the search tool and its tests shell out to ripgrep.
- `protoc` (protobuf-compiler) — the Rust runtime's build script needs it via
  `prost-build`. On Debian/Ubuntu: `apt-get install protobuf-compiler`.

```bash
pnpm install
pnpm check
pnpm build
pnpm typecheck
pnpm test
pnpm cli -- --version
```

`pnpm build` must run before `pnpm typecheck`/`pnpm test` on a fresh checkout:
workspace packages resolve each other through their published `dist/*.d.ts`,
which the build step emits.

Tests are written in TypeScript under each `tests/` directory and compiled to a
sibling `tests-dist/` (git-ignored) before `node --test` runs them, so the
repository stays TypeScript-first while using only the Node test runner.

To catch Linux-only compile errors while developing on macOS:

```bash
rustup target add x86_64-unknown-linux-gnu
cd runtime/rust
cargo clippy --target x86_64-unknown-linux-gnu --all-targets -- -D warnings
```

## Continuous Integration

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests:

- **TypeScript**: install, structure check, build, typecheck, test (Node 26, pnpm 12.3.4).
- **Rust**: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.

## Releases

The sandbox runtime binary (`dev-agent-executor`) has to be built from
`runtime/rust`. `.github/workflows/release.yml` does that for you: pushing a
`v*` tag builds `dev-agent-executor` for each supported platform, packages it as
a `.tar.gz` with a `.sha256` checksum, and attaches everything to a GitHub
Release.

Supported targets:

- `aarch64-apple-darwin` (Apple silicon)
- `x86_64-apple-darwin` (Intel macOS)
- `x86_64-unknown-linux-gnu`
- `aarch64-unknown-linux-gnu`

To cut a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow can also be run manually (`workflow_dispatch`), which builds and
uploads the artifacts without publishing a release.

To build the binary locally:

```bash
cd runtime/rust
cargo build --release --bin dev-agent-executor
# -> runtime/rust/target/release/dev-agent-executor
```

Point the CLI or desktop app at it with `--rust-executor <path>` or
`DEV_AGENT_RUST_BINARY`.

## Current Status

- Phase 1 workspace skeleton with pnpm monorepo TypeScript setup
- Agent loop, context, and in-memory memory in `@dev-agent/agent-core`
- File-backed memory in `@dev-agent/agent-core` for cross-run conversation history,
  with session metadata (created/last-active timestamps) and `--compact` support
- CLI session isolation and reset via `--session` and `--reset-memory`
- Rich agent context with session id, working directory, metadata, task, and error state
- Context-aware built-in tools that run relative to `workingDirectory`
- `code-search` tool that scans TypeScript/JavaScript symbols in the project
- MCP server environment injection for session id and working directory
- TypeScript AST scanner in `@dev-agent/code-intelligence` for functions, classes,
  interfaces, type aliases, enums, methods, properties, variables, and arrow functions
- `InMemoryCodeIndex` with improved ranking: case-sensitive exact-match bonus,
  test-file demotion, and path-depth penalty in `@dev-agent/code-intelligence`
- `JsonFileCodeIndex` with JSON persistence and incremental updates
- `TypeScriptReferenceIndex` for reference search and go-to-definition via the
  TypeScript language service in `@dev-agent/code-intelligence`
- `code-search` tool now supports `search` (default), `references`, and `definition`
- Model contracts plus OpenAI, Anthropic, Gemini, and Ollama providers in `@dev-agent/model`
- Built-in filesystem, shell, git, and search tools in `@dev-agent/tools`
- Executor contract in `@dev-agent/executor` with `cwd`, `env`, stdin `input`,
  `timeoutMs`, `durationMs`, and `command` on `LocalExecutor`; optional execution
  history via `historyLimit`. `RustExecutor` implements `SandboxExecutor` over the
  protobuf stdio boundary
- Stdio MCP client with reconnect backoff, notification debounce, structured error
  codes (`McpRequestError`), and graceful close in `@dev-agent/mcp`
- MCP resources, prompts, capability negotiation, and roots handling
- MCP server mode: `createMcpServer` plus `--mcp-server` exposes the built-in
  tools to a host agent over stdio (`initialize`, `tools/list`, `tools/call`)
- CLI entry point wired to the loop with `--once`, `--tools`, `--metadata`,
  `--compact`, and Ctrl-C interrupt handling. Agent loop exposes `onTurn` callback
  for streaming progress
- Policy language: the Rust sandbox uses **Starlark** for filesystem/network/policy
  rules, consistent with the open-source Codex agent
- Rust runtime boundary is active: `runtime/rust` has a `dev-agent-runtime`
  crate with `LocalExecutor`, `SandboxExecutor`, a `dev-agent-executor` stdio
  binary, and a protobuf protocol (`proto/executor.proto`)
- macOS `sandbox-exec` enforcement is active for filesystem, network, timeout,
  and resource limits. Linux `bwrap` backend is active: namespace isolation
  (user/ipc/pid/uts/cgroup), read-only root filesystem with writable/read-only path
  bind mounts, network policy (`--unshare-net`), environment injection, resource
  limits, and cwd enforcement. Pure argument-builder unit tests run on macOS; live
  `bwrap` tests run on Linux when `bwrap` is available
- Agent Loop streaming with token-level callbacks (`onToken`, `onToolCall`, `onToolResult`)
- Tool output truncation and timeout protection
- MCP resource subscription (`watchResource`)
- Multi-language code intelligence (TypeScript AST, Python/Rust regex scanners)
- Executor quotas (`maxOutputBytes`, `maxConcurrentExecutions`)
- CLI configuration file support (`~/.dev-agent/config.json`) and ANSI color output
- CLI live streaming output, `--session-list`, `--no-stream`, and hardened session
  management
- Desktop shell in `apps/desktop`: local web server with a streaming chat UI
  (Server-Sent Events), health check, and single-page dark/light interface
- Network policy enforcement via Starlark: the policy script receives
  `ctx.network_policy` (`"enabled"`, `"disabled"`, `"loopback"`) and can make
  allow/deny decisions; enforced through macOS `sandbox-exec` and Linux `bwrap`
- Model streaming: `streamChat` for OpenAI, Anthropic, Gemini, and Ollama emits
  tokens via `onToken`, flushes a final event that lacks a trailing newline, and
  surfaces tool calls so the agent can still run tools in streaming mode
- Rust runtime output quota: `RunRequest.max_output_bytes` is enforced while
  streaming, a command that exceeds it is killed, and `bytes_truncated` reports
  the truncation back through `RustExecutor`
- Agent context budget: `contextBudget.maxChars` drops the oldest history first,
  never splits a tool call from its results, always keeps the system prompt and
  the newest entry, and announces the omission; configured with
  `DEV_AGENT_MAX_CONTEXT_CHARS` or `maxContextChars`
- `code-search` scans TypeScript/JavaScript/Python/Rust, caches per root, and
  re-reads only files whose size or mtime changed; deleted files leave the index
  and `getCacheStats()` reports hits/misses/rescanned
- `code-search` also reuses the index written by `--index` when it starts in a
  new process: the persisted file/symbol/signature map loads first and only the
  files whose mtime or size changed are re-read (`getCacheStats().loadedFromDisk`)
- Model providers retry 429/5xx and network failures with exponential backoff,
  honour `Retry-After`, and never restart a stream that already emitted tokens
- Desktop chat aborts on client disconnect (the SSE stream closes with
  `done { "status": "aborted" }`) and rejects a concurrent run with 409
- Interrupting a run now cancels the tool that is already running: the abort
  signal reaches the tool context, `LocalExecutor` kills the child, and
  `RustExecutor` sends `Envelope.cancel` so the runtime kills it too
- Termination is graceful: commands run in their own process group and get
  SIGTERM first, SIGKILL only after a two-second grace period, so wrappers and
  grandchildren are covered and nothing keeps running in the background
- Token usage: providers report `usage`, the loop accumulates it on the
  context and fires `onUsage`, and the CLI (`[usage] …`) plus the desktop
  (`usage` SSE event and header counter) surface it. The total is also written
  to the session (`metadata.usage`), so `--metadata`, `--session-list --json`,
  and a desktop reload can restore it
- `--metadata` tells an absent session apart from a corrupt one: a file that
  exists but cannot be parsed exits 1 with its path and the
  `--reset-memory` / `--session-delete <id>` recovery options, while `--json`
  reports `{ error, path }`
- Long sessions can summarize instead of forget: `contextBudget.summarize`
  replaces trimmed history with an incrementally grown `[summary]` digest
  (`DEV_AGENT_SUMMARIZE_CONTEXT`), falling back to the omission notice on error
- The digest is stored with the session (`FileMemory` persists it, `InMemoryMemory`
  keeps it in process), re-anchors by entry id after compaction, and is capped
  by `summaryMaxChars`
- Tool calls can go through an approval policy: `denyDangerousPolicy()` blocks
  the built-in dangerous command table plus filesystem writes outside the
  working directory, and a denial is written back to the model so it can pick
  another path. The CLI exposes it as `--approval allow|deny-dangerous|ask`,
  the desktop via `DEV_AGENT_APPROVAL` and an `approval` SSE frame
- A tool that throws is reported back to the model as that tool's result
  (`{"error": "…"}`) instead of ending the run, so it can fix its arguments or
  pick another tool; an unknown tool name goes through the same path, and
  `maxTurns` still bounds a model that keeps failing
- MCP server mode also serves `resources` (`dev-agent://session`,
  `dev-agent://workspace`) and `prompts` (`review-changes`, `explain-codebase`)
- `--mcp-server` honours the approval policy too: `--approval deny-dangerous`
  (or the config file's `approval` section) answers a flagged tool call with
  `isError` and the reason instead of running it. MCP has no prompt channel, so
  `ask` behaves like `deny-dangerous` there
- Desktop approvals are interactive: `DEV_AGENT_APPROVAL=ask` renders an
  Allow/Deny prompt in the chat, waits for the click (denying after
  `DEV_AGENT_APPROVAL_TIMEOUT_MS`), and reports the decision as an `approval`
  frame. If the client disconnects while a prompt is open, that prompt is
  dropped immediately instead of lingering until the timeout
- `dev-agent --doctor` checks Node, `rg`, `protoc`, the Rust runtime binary, the
  provider key, `~/.dev-agent/config.json`, and the session directory, with
  `--json` output and a non-zero exit when something fails. A malformed config
  is reported as a warning instead of being silently ignored
- Sessions can be removed: `--session-delete <id>` in the CLI and
  `DELETE /api/sessions/<id>` plus a Delete button in the desktop picker
- Sessions can be renamed from both surfaces: `--session-rename <old> <new>` in
  the CLI, and `POST /api/sessions/<id>/rename` plus a Rename button in the
  desktop picker; an existing target is refused instead of overwritten
- Editing stopped being "rewrite the whole file": `filesystem` gained an `edit`
  action that replaces a snippet only when it matches exactly once, and `read`
  takes `offset`/`limit` (2000 lines by default) so large files come back in
  slices
- `filesystem read` counts lines like an editor: a trailing newline terminates
  the last line rather than adding an empty one, and an `offset` past the end
  reports an empty range just past the last line instead of an inverted one
- Approval can be remembered per session: the CLI accepts `a` and the desktop
  shows "Always allow", so the same command is not asked about twice. The memory
  key is the command plus up to two leading arguments (`npm test`, `git status`,
  `npm run test`), so extra flags such as `npm test -- --watch` do not trigger a
  second prompt while `npm run test` and `npm run build` stay separate
- The dangerous-command table covers the long and short spellings of the same
  shapes: `rm --recursive --force` alongside `rm -rf`, and `git push -f` /
  `git push origin +main` alongside `--force`, without flagging
  `rm --force file` or `git push --follow-tags`
- The table also flags git options that execute another process
  (`-c alias.x=!cmd`, `--config-env`, `--exec-path`, `--upload-pack`,
  `--receive-pack`), closing the hole where the git tool could run shell
  commands without an approval prompt
- The `search` tool passes its query after `--`, so a query that starts with `-`
  (including `--files` or `--pre=…`) is a literal pattern instead of a ripgrep
  option the model could reach
- `dev-agent --index <path>` scans a directory and writes a symbol index to
  `<path>/.dev-agent/index.json`; TypeScript/JavaScript/Python/Rust up to depth
  8, with the same ignore rules as `code-search`. A second run reuses the files
  whose mtime/size did not change (`reused` in the report)
- The Rust scanner understands visibility and item modifiers (`pub`,
  `pub(crate)`, `async`, `unsafe`, `const`, `default`, `extern "C"`), traits,
  and `impl`/trait methods (which carry their container), so real Rust files
  produce symbols instead of silently scanning to nothing
- The Python scanner understands `async def` at module level and inside classes
  (decorated methods included), so async services no longer index to nothing
- `code-search` refreshes that same index file after its incremental scan finds
  changed files, so the next process starts from a current cache; an index that
  exists but is corrupt is replaced with a freshly scanned one. The scan scope
  matches `--index`, so Python/Rust symbols are never pruned from a reused
  index; `references`/`definition` remain TypeScript/JavaScript
- A narrow `code-search` call (`maxDepth`) only replaces the entries inside that
  depth: deeper entries stay in the index instead of being pruned as "deleted"
- `code-search` references/definition validate the requested position against
  the source first, so a line/column past the end of the file gets a readable
  error instead of a TypeScript `Debug Failure`
- `filesystem` gained a `patch` action that applies several `oldText`/`newText`
  hunks in one write: every hunk must match exactly once and not overlap, and a
  failure leaves the file untouched
- Usage costs are estimated when `~/.dev-agent/config.json` has a `pricing`
  section: the CLI appends `cost=$…` to its `[usage]` line, the desktop header
  adds `$…`, and an unconfigured or unknown model shows no cost at all
- The CLI validates its arguments: an unknown flag, a missing value, or a stray
  positional argument exits `1` instead of being silently ignored (a typo like
  `--nope` used to drop into interactive mode, and `--session --once hi` used
  to create a session named `once`)
- The interactive CLI is a real session loop: `turns` and `[usage]` accumulate
  across prompts instead of restarting at 1 every time, and `Ctrl-C` aborts the
  request in flight (or exits when idle) with status 130
- The desktop chat can be stopped without reloading: a header `Stop` button calls
  `POST /api/chat/cancel`, the run unwinds through the same abort path the
  disconnect handler uses, and the status stays `aborted`
- MCP resources that answer with several content blocks are no longer truncated:
  the client exposes `readResourceContents()` (all blocks, in order) and the CLI
  resource tool hands every block to the model
- MCP tool prefixes are unique per server: a single unnamed server stays on
  `mcp`, several unnamed ones become `mcp-1`, `mcp-2`, ..., and repeated names
  get a numeric suffix, so two servers can no longer erase each other's tools
- Cache-hit tokens are accounted for: OpenAI
  (`prompt_tokens_details.cached_tokens`) and Anthropic
  (`cache_read_input_tokens`) report `cachedPromptTokens`, Anthropic cache
  writes report `cacheCreationPromptTokens`, the session totals keep both, and
  `pricing` can price them with `cachedInputPerMillion` /
  `cacheCreationInputPerMillion`
- Test suite: 407 TypeScript tests + 46 Rust tests, all passing

### Rust runtime progress

- Starlark policy evaluation with `starlark 0.14`, tick/heap limits, and `ctx` bindings
- macOS `sandbox-exec` enforcement: writable/read-only paths, network policy, cwd,
  timeout, and resource limits (CPU, FSIZE, NOFILE, NPROC, CORE)
- Linux `bwrap` backend: namespace isolation (user/ipc/pid/uts/cgroup), read-only root
  filesystem with per-distro path detection, writable/read-only path bind mounts,
  network policy (`--unshare-net`), environment injection, resource limits, and cwd
  enforcement. Pure argument-builder unit tests run on macOS; live `bwrap` tests run
  on Linux when `bwrap` is available
- `RestrictedExecutor` detects `bwrap` availability for clearer error messages

## Roadmap

1. ~~Richer code index and reference search~~ (done)
2. ~~MCP resources, prompts, and richer server lifecycle~~ (done)
3. ~~Agent Loop streaming and tool safety~~ (done)
4. ~~Multi-language symbol scanning~~ (done)
5. ~~Linux bubblewrap backend for Rust sandbox~~ (done)
6. ~~Desktop shell in `apps/desktop`~~ (done)
7. ~~CLI streaming output and session management hardening~~ (done)
8. ~~Network policy enforcement via Starlark~~ (done)
9. ~~Rust runtime output quota across the protobuf boundary~~ (done)
10. ~~Agent context budget with tool-call-aware trimming~~ (done)
11. ~~code-search incremental index caching~~ (done)
12. ~~Model retry and rate-limit handling~~ (done)
13. ~~Desktop interrupt and concurrency protection~~ (done)
14. ~~Cancel a running tool through the Rust protocol~~ (done)
15. ~~Desktop end-to-end coverage for interrupts and the context budget~~ (done)
16. ~~Session token-usage accounting across providers~~ (done)
17. ~~MCP server mode (`--mcp-server`) exposing the built-in tools~~ (done)
18. ~~Graceful process-group termination before SIGKILL~~ (done)
19. ~~Incremental summarization of trimmed context~~ (done)
20. ~~Persistent, length-capped context digests~~ (done)
21. ~~Approval policies for dangerous commands~~ (done)
22. ~~CLI `--approval` modes and desktop approval wiring~~ (done)
23. ~~MCP server resources and prompts~~ (done)
24. ~~Interactive approval prompts in the desktop UI~~ (done)
25. ~~`--doctor` environment self-check~~ (done)
26. ~~Session deletion in the CLI and desktop~~ (done)
27. ~~Unique-snippet editing and line-range reads~~ (done)
28. ~~`--index` symbol index command~~ (done)
29. ~~Per-session approval memory ("always allow")~~ (done)
30. ~~Reusing the persisted `--index` file in `code-search`~~ (done)
31. ~~Atomic multi-hunk `filesystem patch`~~ (done)
32. ~~Normalized always-allow keys across flags and arguments~~ (done)
33. ~~Usage cost estimation from a configurable price table~~ (done)
34. ~~Incremental `--index` refresh and `code-search` write-back~~ (done)
35. ~~Session token usage persisted with the session~~ (done)
36. ~~Desktop session rename control~~ (done)
37. ~~Approval gating for `--mcp-server`~~ (done)
38. ~~Cached prompt-token accounting and cache-aware pricing~~ (done)
39. ~~Self-repair for a corrupt persisted code-search index~~ (done)
40. ~~Multi-language `code-search` scope aligned with `--index`~~ (done)
41. ~~Rust scanner coverage for visibility, modifiers, traits, and impl methods~~ (done)
42. ~~Cache-write token accounting and pricing~~ (done)
43. ~~Config-file validation in `--doctor`~~ (done)
44. ~~Dangerous-pattern coverage for long options and short force flags~~ (done)
45. ~~`async def` support in the Python scanner~~ (done)
46. ~~Depth-safe `code-search` index write-back~~ (done)
47. ~~TypeScript-first test suite (compiled `tests/` -> `tests-dist/`)~~ (done)
48. ~~Strict CLI argument validation~~ (done)
49. ~~Editor-style line counts and clamped read ranges~~ (done)
50. ~~Interactive CLI session loop (accumulated state, working Ctrl-C)~~ (done)
51. ~~Explicit stop control for a running desktop chat~~ (done)
52. ~~All MCP resource content blocks reach the model~~ (done)
53. ~~Unique MCP tool prefixes per server~~ (done)
47. ~~Literal-pattern guard for the `search` tool's query~~ (done)
48. ~~Approval coverage for git command-execution options~~ (done)
49. ~~Clear `--metadata` error for a corrupt session file~~ (done)
50. ~~MCP `reconnect()` resets its closed state~~ (done)
51. ~~Always-allow keys keep two leading arguments~~ (done)
52. ~~Tool errors are reported back to the model instead of ending the run~~ (done)
53. ~~Readable `code-search` errors for out-of-range positions~~ (done)
