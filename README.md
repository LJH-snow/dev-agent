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
|-- tests/                Test suites (framework to be added)
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
- `code-search` caches its scan per root and re-reads only files whose size or
  mtime changed; deleted files leave the index and `getCacheStats()` reports
  hits/misses/rescanned
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
  (`usage` SSE event and header counter) surface it
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
- MCP server mode also serves `resources` (`dev-agent://session`,
  `dev-agent://workspace`) and `prompts` (`review-changes`, `explain-codebase`)
- Desktop approvals are interactive: `DEV_AGENT_APPROVAL=ask` renders an
  Allow/Deny prompt in the chat, waits for the click (denying after
  `DEV_AGENT_APPROVAL_TIMEOUT_MS`), and reports the decision as an `approval`
  frame
- `dev-agent --doctor` checks Node, `rg`, `protoc`, the Rust runtime binary, the
  provider key, and the session directory, with `--json` output and a non-zero
  exit when something fails
- Sessions can be removed: `--session-delete <id>` in the CLI and
  `DELETE /api/sessions/<id>` plus a Delete button in the desktop picker
- Editing stopped being "rewrite the whole file": `filesystem` gained an `edit`
  action that replaces a snippet only when it matches exactly once, and `read`
  takes `offset`/`limit` (2000 lines by default) so large files come back in
  slices
- Approval can be remembered per session: the CLI accepts `a` and the desktop
  shows "Always allow", so the same command line is not asked about twice
- `dev-agent --index <path>` scans a directory and writes a symbol index to
  `<path>/.dev-agent/index.json` (same ignore rules as `code-search`)
- Test suite: 342 TypeScript tests + 46 Rust tests, all passing

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
