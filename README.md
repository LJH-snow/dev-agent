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

The fixed release gate is the preferred pre-push check:

```bash
pnpm verify                 # TypeScript → Rust → real-Rust integration
pnpm verify:typescript      # the TypeScript CI job
pnpm verify:rust            # the Rust CI job
pnpm verify:integration     # the real-Rust integration phase
```

Each gate uses repository-defined commands and working directories, stops at the
first failed phase, and does not use model output or historical evidence as
execution input. The standalone integration phase expects the executor package
`dist` output and the debug `dev-agent-executor` binary; the macOS CI job builds
and checks both explicitly. On a fresh local checkout, build the TypeScript
workspace and Rust binary before using `pnpm verify:integration`; non-macOS
workspaces intentionally report the macOS-only cases as skipped. Add `--report`
when a machine-readable, metadata-only result is needed:

```bash
node scripts/release-gate.mjs --typescript --report
```

The report is written atomically to the fixed, ignored path
`.dev-agent/release-gate-report.json`. It contains only the schema version,
selected modes, phase status, timings, exit codes, and failed phase; it never
contains commands, arguments, working directories, output, environment values,
session evidence, or file contents. Without `--report`, the gate does not create
or update that report.

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

- **TypeScript**: `pnpm verify:typescript` runs the fixed structure check, build,
  typecheck, and workspace tests (Node 26, pnpm 12.3.4).
- **Rust**: `pnpm verify:rust` runs the fixed `cargo fmt --check`, clippy, and
  unit/doc test phases from `runtime/rust`.
- **macOS integration**: the pinned `macos-15` job explicitly builds the debug
  `dev-agent-executor` binary and the `@dev-agent/executor` `dist` artifacts,
  fail-closed checks `/usr/bin/sandbox-exec` and a usable Python socket fixture,
  then runs `pnpm verify:integration`; the hosted gate has recorded 10/10 with
  zero skips.

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

For the project map and decision history, use the [documentation index](docs/README.md),
[architecture reference](docs/architecture.md), [changelog](docs/CHANGELOG.md), and the
current [v61 plan](docs/day-plan-v61.md) with its [progress record](docs/day-plan-v61-progress.md).
The completed [v60 normalization plan](docs/day-plan-v60.md) and [progress record](docs/day-plan-v60-progress.md)
remain the source for the roadmap/documentation boundary. The consolidated
[next-phase plan](docs/next-roadmap-plans-v62-plus.md) records the recommended v62 Linux
integration work and later conditional options.

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
  codes (`McpRequestError`), server-provided tool failure details, graceful
  close, cancellable tool calls, and progress callbacks in `@dev-agent/mcp`
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
- Agent Loop streaming with token-level callbacks (`onToken`, `onToolCall`,
  `onToolProgress`, `onToolResult`)
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
- `review-writes` is an explicit approval mode for filesystem mutations: a
  read-only preview produces a real unified diff, SHA-256 preimage/postimage,
  and file statistics before the approved `apply` runs
- Filesystem change sets support all-or-nothing multi-file apply, atomic
  same-directory replacement, preimage conflict checks, and guarded rollback
  that refuses to overwrite an externally changed postimage
- CLI reviewed writes render the diff in human mode and add structured `reviews`
  records to `--json`; MCP stdio mode denies `review-writes` mutations because
  it has no interactive reviewer channel
- Desktop reviewed writes carry the change set in `approval-request` SSE
  events and expose `POST /api/changesets/rollback` for an in-app **Undo**
- Applied reviewed change sets derive deterministic, allowlisted validation
  checks from their real paths; `ValidationResult` keeps pass/fail/skipped/blocked
  separate from apply status, forwards cancellation, and never auto-rolls back
- Evidence lifecycle is bounded and visible: validation history has a default
  limit, applied change-set guards are protected, explicit metadata-only cleanup
  can remove rolled-back evidence, and CLI/Desktop expose retention summaries
  without putting commands, diffs, or file contents into model context
- v38 adds a versioned metadata-only evidence audit projection: CLI
  `--export-evidence` and Desktop `GET /api/sessions/<id>/evidence` share the
  same allowlisted shape, support bounded filters, and omit commands, output,
  diffs, patches, file bytes, before-images, and absolute working-directory paths
- v41 adds opt-in rejection-only audit limits on that projection: CLI uses
  `--audit-max-validations`, `--audit-max-change-sets`, `--audit-max-files`, and
  `--audit-max-bytes`; Desktop accepts the matching `maxValidations`,
  `maxChangeSets`, `maxFiles`, and `maxBytes` query values. Limits are checked
  after stable projection using canonical UTF-8 JSON; invalid requests return `400`,
  an over-limit complete snapshot returns a structured error (`413` on Desktop),
  and v1 never returns a partial snapshot or pagination cursor.
- v43 adds a separate metadata-only audit preflight: CLI `--preview-evidence` and
  Desktop `GET /api/sessions/<id>/evidence/preview` report only the preview schema
  version, session id, generation time, validation/change-set/file counts, and the
  canonical full v1 projection's UTF-8 `serializedBytes`. Filters are supported,
  export limits remain exclusive to the full `/evidence` export, and preview never
  returns commands, paths, output/errors, file contents, before-images, partial/cursor
  fields, or execution/recovery authorization.
- v49 makes that preflight discoverable in Desktop with a hidden-by-default, read-only
  **Evidence** summary panel beside transcript **Download**. It renders only the three
  counts and human-readable estimated export size, cancels stale session requests, marks
  evidence changes for refresh, and does not add a second audit JSON download authority.
- v50 adds lightweight Desktop accessibility semantics around that shell: visible keyboard focus,
  explicit control labels, an atomic polite stream-status live region, and Evidence loading state
  via `aria-busy`, without changing the API or evidence boundaries.
- CLI human output and `--json.validations` expose the same check ids, structured
  commands, durations, bounded output, and failure reasons; Desktop emits a
  `validation` SSE frame and renders a card without hiding the guarded Undo
- Validation evidence is persisted per session, returned by Desktop history/export,
  and can be explicitly rerun with `:validate <changeSetId>` in the interactive
  CLI or `POST /api/changesets/validate` in Desktop; each rerun gets a fresh
  attempt id and never auto-rolls back the applied bytes
- Applied reviewed change sets now persist a minimal, session-bound evidence
  record so a new CLI process or Desktop session can restore a trusted
  postimage-only validation guard. Restore rechecks the canonical working
  directory, relative paths, file kinds, existence, and SHA-256 postimages;
  conflicts become `blocked` without writing, repairing, executing historical
  commands, or exposing evidence to the model context
- Cross-process restored evidence is intentionally read-only: it can be used for
  explicit validation reruns but cannot provide **Undo** because its before-image
  is not persisted. Evidence summaries in CLI JSON and Desktop history/export
  contain metadata, hashes, state, and validation relationships only — never
  diffs, commands, or file bytes. Desktop history/export also accept
  `changeSetId`, `validationId`, and `status` filters
- Validation planning has three code-defined policies: `fast`, `default`, and
  `strict`. `DEV_AGENT_VALIDATION_POLICY` or `validation.policy` selects only
  the policy name; commands, arguments, working directories, and timeout caps
  remain fixed and allowlisted in the planner
- The workspace boundary check resolves symlinks, so a link inside the working
  directory cannot be used to read or overwrite a file outside it; links that
  stay inside are still allowed
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
- Desktop SSE streams are capped (`DEV_AGENT_SSE_MAX_BYTES`, default 32 MiB): a
  client that stops reading gets an `error` frame and the run is aborted,
  instead of the server buffering events without bound
- MCP resources that answer with several content blocks are no longer truncated:
  the client exposes `readResourceContents()` (all blocks, in order) and the CLI
  resource tool hands every block to the model
- MCP tool prefixes are unique per server: a single unnamed server stays on
  `mcp`, several unnamed ones become `mcp-1`, `mcp-2`, ..., and repeated names
  get a numeric suffix, so two servers can no longer erase each other's tools
- MCP requests time out instead of hanging forever (default 30s, configurable
  with `timeoutMs` or `DEV_AGENT_MCP_TIMEOUT_MS`); a silent server now fails the
  CLI at startup instead of freezing it with no output
- MCP tool cancellation and progress propagate end to end: an `AbortSignal`
  sends `notifications/cancelled` and rejects with `McpRequestError` `-32001`,
  timeout cancellation uses `-32000`, and progress reaches the AgentLoop, CLI
  `[tool-progress]` output, and desktop `tool-progress` SSE frames
- `RustExecutor` no longer waits forever on a wedged runtime: `requestTimeoutMs`
  (default 60s, `0` disables) drops the pending request, frees its concurrency
  slot, and replaces the runtime process, so the sandbox cannot be permanently
  exhausted by a hung request
- Tool timeouts cancel the work instead of only reporting it: `runTool()` aborts
  the signal the tool received, so a command that exceeds `timeoutMs` is killed
  and cannot leave side effects behind after the model was told it timed out
- A bad working directory is named as such (`working directory does not exist`)
  instead of surfacing as `spawn echo ENOENT`, so a missing project path is not
  mistaken for a missing command
- Renaming a session to its own name reports "already has that name" (CLI) or
  answers `200 { renamed: false }` (desktop) when it exists, and a genuine 404 /
  "not found" when it does not — the two cases used to be indistinguishable
- Cache-hit tokens are accounted for: OpenAI
  (`prompt_tokens_details.cached_tokens`) and Anthropic
  (`cache_read_input_tokens`) report `cachedPromptTokens`, Anthropic cache
  writes report `cacheCreationPromptTokens`, the session totals keep both, and
  `pricing` can price them with `cachedInputPerMillion` /
  `cacheCreationInputPerMillion`
- CI runs the fixed TypeScript/Rust gates plus a pinned macOS integration job; the latter checks
  the live sandbox prerequisites before running real Rust integration.
- Test suite: the fixed release gate passes the TypeScript workspace, preview-contract,
  release-gate, release-workflow, and documentation contracts, Rust unit/doc, and real-binary
  integration suites; dated validation counts are recorded in the release notes

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
54. ~~Per-request MCP timeouts~~ (done)
55. ~~Client-side backstop for a wedged Rust runtime~~ (done)
56. ~~Symlink-aware workspace write boundary~~ (done)
57. ~~Tool timeouts cancel the running command~~ (done)
58. ~~Bounded desktop SSE buffering~~ (done)
59. ~~Working-directory validation before spawning~~ (done)
60. ~~Same-name session rename is no longer reported as missing~~ (done)
61. ~~End-to-end MCP tool cancellation and progress propagation~~ (done)
62. ~~MCP-aware diff review, approval, and rollback~~ (done)
63. ~~Change-set-derived automated verification~~ (done)
64. ~~Literal-pattern guard for the `search` tool's query~~ (done)
65. ~~Approval coverage for git command-execution options~~ (done)
66. ~~Clear `--metadata` error for a corrupt session file~~ (done)
67. ~~MCP `reconnect()` resets its closed state~~ (done)
68. ~~Always-allow keys keep two leading arguments~~ (done)
69. ~~Tool errors are reported back to the model instead of ending the run~~ (done)
70. ~~Readable `code-search` errors for out-of-range positions~~ (done)
71. ~~MCP tool failures preserve server-provided error details~~ (done)
