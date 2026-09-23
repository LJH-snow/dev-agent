# dev-agent Architecture

## Overview

dev-agent is an AI coding agent built as a pnpm monorepo with TypeScript packages and a Rust runtime for sandboxing.

## Module Responsibilities

### `packages/agent-core`
- **AgentLoop**: Orchestrates the chat → tool execution → chat cycle.
- **Context**: Carries session state, working directory, and metadata.
- **Memory**: `InMemoryMemory` for testing, `FileMemory` for persistence.
- **Streaming**: Supports `onToken`, `onToolCall`, `onToolResult` callbacks.
- **Tool defaults**: Configurable `maxOutputChars` and `timeoutMs`.
- **Context budget**: optional `contextBudget.maxChars` keeps the newest history
  that fits, never splits an assistant tool call from its results, always keeps
  the system prompt and the newest entry, and reports how many entries it
  dropped.
- **Interrupts**: `run(context, input, { signal })` checks the signal before each
  turn and tool call and forwards it to the model request. The signal also
  reaches tools through `ToolExecutionContext.signal`, so a running command can
  be cancelled instead of only stopping between turns.
- **Runtime events**: `AgentLoop` can publish versioned session, run, status,
  assistant, tool, approval, validation, usage, and terminal events through the
  shared `@dev-agent/runtime-events` contract. Sink failures are isolated from
  the run, and sequence numbers let consumers ignore replayed frames.
- **Checkpoints, Skills, Hooks, and Extensions**: `FileMemory` can persist bounded
  checkpoint records and safely rewind conversation entries to a validated
  anchor. Rewind never rolls back workspace files or changes applied
  change-set evidence; later checkpoints are discarded because they no longer
  describe the current history. The bounded Skills and Hooks registries provide
  explicit extension points around sessions, model calls, and tools. The
  metadata-only `ExtensionRegistry` discovers project/user manifests with
  project precedence; it does not execute extension code or start MCP servers.
- **Run observability**: `AgentRunTrace` observes lifecycle Hooks and retains a
  bounded metadata-only trace of model/tool spans. CLI `:trace` and the Desktop
  trace endpoint expose the same local snapshot without storing prompt/output
  content or sending telemetry.
- **Local task scheduling**: `AgentTaskScheduler` runs caller-owned async work
  with bounded FIFO concurrency, explicit queued/running/confirmation/terminal
  states, cooperative cancellation, and bounded metadata-only retention. The
  interactive CLI uses one scheduler at concurrency one around the Ink prompt
  queue; it does not create detached or cross-session jobs.
- **Collaborative execution**: `runCollaborativeExecution` validates a bounded
  task DAG, runs independent tasks with bounded parallelism, and reports
  metadata-only lifecycle events. Each task gets an injected isolated workspace
  and its own AgentLoop context. The CLI forwards its application-owned
  sandbox profile resolver and bounded expansion callback to each worker, so
  sandbox paths resolve against the task workspace. A trusted caller may also
  provide a per-task tool allowlist; Agent Core intersects it with the supplied
  tool collection before workspace creation and uses the narrowed collection
  for both model schemas and execution lookup. Planner output cannot set this
  scope. The CLI can impose an optional caller-configured tool allowlist shared
  by all team workers. Before every `:team` execution, the CLI presents each
  normalized task's instructions and requires confirmation of the complete
  ordered graph, dependency edges, and user-selected scopes. The deprecated
  `collaboration.reviewTaskToolScopes` boolean is accepted for compatibility
  but ignored; it cannot disable review. The review binds
  scopes to ordered task slots plus a SHA-256 normalized-plan fingerprint, not
  planner IDs. Agent Core revalidates that fingerprint, complete slot coverage,
  registered tool names, and the optional global ceiling synchronously before
  creating any workspace. The review is bounded to 8 tasks and rejects oversized
  prompts; cancellation, interruption, invalid selections, or declined
  confirmation fail closed before worker/workspace creation. This is a tool
  visibility limit, separate from approval and sandbox policy. MCP sessions are
  currently registered once by the CLI at the project root and their tool
  wrappers are shared with workers: per-task tool scopes do not create separate
  MCP processes, rebind MCP roots to a task worktree, or sandbox server-side
  effects. Configured MCP child processes and their external resources remain
  governed by their own configuration. Agent Core keeps the review-before-merge
  boundary and never merges changes itself.
- **Summarization**: with `contextBudget.summarize` the entries dropped by the
  budget are replaced by a model-written `[summary]` digest, which grows
  incrementally as more history is trimmed; a failed summary falls back to the
  `[context] N earlier entries omitted` notice.
- **Summary persistence**: the digest is saved with the session memory and
  re-anchored by the id of its last covered entry, so later runs reuse it and
  only summarize what has been trimmed since. `summaryMaxChars` (default 2000)
  caps its length.
- **Approval**: `AgentLoopOptions.approval` decides whether each tool call may
  run. `denyDangerousPolicy()` matches a built-in pattern table and blocks
  filesystem writes outside the working directory; a denial becomes the tool's
  result so the model can adapt, and a policy that throws counts as a denial.
  Tool risk is normalized by the application-owned registry: missing metadata
  defaults to dangerous/always-confirm, while built-ins keep their explicit
  classifications. Plan mode permits action-aware built-in inspection and
  explicitly classified read-only tools only. MCP action wrappers are always
  dangerous/always-confirm regardless of server annotations; the host's
  resource and prompt read wrappers are separately marked read-only.
  Callers can install their own policy: the desktop passes a requester so `ask`
  can prompt the user over SSE (`approval-request` / `POST /api/approval`) and
  deny when nothing answers within the timeout. `normalizeApprovalKey()` turns a
  request into the key an "always allow" decision is remembered under (command
  name + up to two leading non-flag tokens, `sh -c` unwrapped), so extra flags
  share one key while `npm run test` and `npm run build` stay separate.
  The built-in table matches both spellings of a dangerous shape: `rm -rf` and
  `rm --recursive --force`, `git push --force` / `-f` / `+refspec`, while
  `rm --force file` (no recursion) and `git push --follow-tags` stay allowed.
  Git options that spawn another process (`-c`, `--config-env`, `--exec-path`,
  `--upload-pack`, `--receive-pack`) are flagged as well, so `git -c alias.x=!cmd`
  cannot slip past the shell approval.
  A client disconnect aborts the run's signal, which also settles and removes
  any approval prompt still waiting for an answer.
- **Tool failures**: a tool that throws (including an unknown tool name) is
  turned into that tool's result (`{"error": "…"}`) so the model can correct
  itself; only an abort still propagates. `maxTurns` bounds a model that keeps
  calling a failing tool.
- **Usage**: every model response that reports tokens fires `onUsage`, and the
  loop accumulates the totals on `AgentContext.usage` across runs. Each report
  is also handed to `AgentMemory.recordUsage()`, which `InMemoryMemory` keeps in
  process and `FileMemory` persists as `metadata.usage`, so a restarted CLI or
  desktop session can restore the total. Cache-hit prompt tokens
  (`ChatUsage.cachedPromptTokens`) are carried through the same total.

### `packages/acp`
- **ACP bridge**: Adapts the official ACP v1 SDK to a provider-neutral
  `AcpRuntimeFactory`. The package owns connection-scoped session state,
  text-prompt validation, prompt serialization, cancellation, cleanup, and
  NDJSON stdio framing.
- **Updates and permissions**: Runtime adapters emit ACP user/assistant/thought
  chunks, tool calls and progress, usage, and terminal updates. Permission
  requests are forwarded to the ACP client; provider credentials, filesystem
  policy, and model construction remain outside the package.
- **Boundary**: ACP stdout is reserved for protocol frames. The bridge does
  not render ANSI/Ink output, add A2A, orchestrate multiple agents, or define a
  second model configuration format.

### `packages/a2a`
- **A2A boundary**: Adapts the official A2A v1.0 SDK to a bounded runtime
  factory. It owns the Agent Card, task store, task lifecycle, cancellation,
  JSON-RPC dispatch, and SSE framing.
- **Safety boundary**: Task metadata and projected updates are length-bounded
  and do not carry provider errors, workspace paths, raw tool inputs,
  credentials, or provider reasoning by default. The transport binds to
  loopback by default; non-loopback binds require bearer authentication.
- **Runtime boundary**: The package does not construct providers or tools. The
  CLI edge creates one runtime session per A2A context and reuses the existing
  AgentLoop, memory, MCP prompt context, executor, validation, and approval
  policy.

### `packages/model`
- Unified `ModelProvider` interface with `chat()` and `streamChat()` methods.
- Providers: OpenAI, Anthropic, Gemini, Ollama.
- SSE/streaming parsing for each provider's wire format.
- **Model routing**: `ModelRouter` composes a primary provider with a bounded,
  lazily resolved explicit fallback sequence. It can fail over before the first
  answer or reasoning token, but never replays a stream after visible output
  and never falls back for aborts. CLI profile and alias resolution remains at
  the application edge.
- **Retries**: 429/5xx and network failures retry with exponential backoff and
  jitter; `Retry-After` (seconds or HTTP-date, capped at 2s) is honoured and
  other 4xx fail immediately. Streaming calls only retry the initial request, so
  tokens already delivered are never duplicated.
- **Usage**: `ChatCompletion.usage` normalises each provider's field names
  (OpenAI `usage`, Anthropic `input_tokens`/`output_tokens`, Gemini
  `usageMetadata`, Ollama `prompt_eval_count`/`eval_count`), including usage
  that arrives in a stream's final event. OpenAI's
  `prompt_tokens_details.cached_tokens` and Anthropic's
  `cache_read_input_tokens` become `cachedPromptTokens`; Anthropic cache writes
  are counted as prompt tokens.
- **Cost estimation**: `estimateCost(usage, model, prices)` converts a
  `ChatUsage` into USD using a caller-supplied `PriceTable` (model-name prefix →
  `inputPerMillion` / `outputPerMillion`). The longest matching prefix wins;
  unknown models, malformed prices, and an empty table return `undefined`
  instead of guessing. `cachedInputPerMillion` optionally prices the cached
  prompt tokens at a discount and `cacheCreationInputPerMillion` prices
  Anthropic cache writes; either falls back to the regular input price.

### `packages/tools`
- `AgentToolRegistry` for registering and looking up tools.
- Built-in tools: filesystem, shell, git, code-search.
- The `search` tool passes its query after a `--` separator, so a query such as
  `--files` or `--pre=…` is a literal ripgrep pattern rather than an option the
  model can reach.
- Context-aware execution relative to `workingDirectory`.
- `filesystem` reads in slices (`offset`/`limit`, 2000 lines by default) and
  edits by replacing a snippet that must match exactly once, so a stale or
  ambiguous search string fails loudly instead of mis-editing a file.
- `filesystem patch` applies several `oldText`/`newText` hunks to an in-memory
  copy, requires each to match exactly once and to be non-overlapping, and
  writes the file only after every hunk succeeds, so a failed patch leaves the
  file untouched.
- `CodeSearchTool` caches its scan per root (symbol index, per-file signatures,
  sources) and re-reads only files whose size or mtime changed; deleted files
  leave the index. A cold cache first loads the signature map written by
  `--index` into `<root>/.dev-agent/index.json` (when present) and only rescans
  what changed, then writes the refreshed index back to that file (best effort,
  only when it already exists). A file that exists but cannot be parsed is
  replaced with the freshly scanned index instead of being left broken.
  `getCacheStats()` exposes
  hits/misses/rescanned/loadedFromDisk/persisted.
- The scanned file set matches `--index` (`.ts`/`.tsx`/`.mts`/`.cts`,
  `.js`/`.jsx`/`.mjs`/`.cjs`, `.py`, `.rs`, depth 8, the same ignored
  directories), so a reused index round-trips without losing Python/Rust
  entries. Symbol search covers all four languages; `references` and
  `definition` hand only TS/JS sources to the TypeScript language service.
- A narrow `maxDepth` scan restricts the cache to that depth and merges the
  write-back with the on-disk index, so deeper entries are neither searched nor
  deleted by a shallower call.
- `references`/`definition` validate the line and column against the scanned
  source before calling the TypeScript language service, so an out-of-range
  position answers with `code-search line N is beyond the end of …` instead of
  the service's `Debug Failure`.

### `packages/mcp`
- `McpStdioClient`: JSON-RPC 2.0 over stdio transport.
- `McpServerSession`: Session lifecycle, debounced notifications, reconnect with backoff.
- Resource subscription via `watchResource()`.
- Structured error codes (`McpRequestError`).
- **Server mode**: `createMcpServer({ tools, resources, prompts })` speaks newline-delimited
  JSON-RPC over stdio and implements `initialize`, `ping`, `tools/list`, and
  `tools/call`. Tool implementations are injected, so the package keeps no
  dependency on `@dev-agent/tools`; the CLI's `--mcp-server` wires the built-in
  tools in. Tool failures answer `{ isError: true }`; unknown tools and methods
  are JSON-RPC errors.
- Server mode also exposes injected `resources` (`resources/list`,
  `resources/read`) and `prompts` (`prompts/list`, `prompts/get`); the CLI
  serves `dev-agent://session`, `dev-agent://workspace`, `review-changes`, and
  `explain-codebase`.

### `apps/cli` operational surface
- `--doctor` probes the environment (Node, `rg`, `protoc`, the Rust runtime
  binary via a HealthCheck envelope, the provider key, and the session
  directory), validates the shared `~/.dev-agent/config.json` (missing = ok,
  malformed or non-object = warn with the reason), and reports
  `{ ok, warn, fail }`, exiting 1 on any failure.
- Sessions are managed end to end: `--session-list`, `--metadata`, `--compact`,
  `--session-delete`, and a shared `DEV_AGENT_SESSION_DIR`.
- `--index <path>` walks a directory (skipping `node_modules`, `dist`, `.git`,
  `.next`, `.cache`, `.dev-agent`), scans TS/JS/Python/Rust with `scanFile`, and
  writes `{ version, files, symbols, signatures }` to
  `<path>/.dev-agent/index.json` in the same shape `JsonFileCodeIndex.load()`
  understands. A later run reuses the sources and symbols of files whose
  signature still matches instead of re-reading them (`reused` in the report).
- Session metadata carries the accumulated `usage`; `--metadata` prints it and
  `--session-list --json` includes it per session.
- `--metadata` reads the file back before answering: a missing file reports
  "no metadata", while a file that exists but cannot be parsed exits 1 with the
  path and the `--reset-memory` / `--session-delete` recovery hint.
- Approval rules can come from `~/.dev-agent/config.json`: `approval.allow`
  lists command substrings that always pass and `approval.deny` adds regular
  expressions to the dangerous table. `ask` decisions can be remembered for the
  session only (`a` in the CLI, "Always allow" in the desktop), keyed by the
  normalized command + subcommand rather than the full argument list.
- `--mcp-server` reuses the same policy: flagged calls come back as `isError`
  with the denial reason, and `ask` degrades to `deny-dangerous` because MCP
  has no interactive prompt channel.
- `pricing` in the same config file maps model-name prefixes to USD per million
  input/output tokens; the CLI appends `cost=$…` to its `[usage]` line and adds
  a `cost` field to `--json`, while an unmatched model prints no cost.

### `packages/code-intelligence`
- Multi-language symbol scanning: TypeScript (AST), Python (regex), Rust (regex).
  The Rust scanner handles visibility (`pub`, `pub(crate)`, `pub(in path)`) and
  modifiers (`async`, `unsafe`, `const`, `default`, `extern "C"`), `trait` as
  `interface`, and functions inside `impl`/`trait` blocks as `method` symbols
  carrying their container name.
- The Python scanner handles `def` and `async def`, decorators, classes, and
  methods (including async methods with their class as `containerName`).
- `InMemoryCodeIndex` with ranked search (exact, prefix, token, path scoring).
- `JsonFileCodeIndex` for persistent indexing.
- `TypeScriptReferenceIndex` for go-to-definition and find-references.

### `packages/executor`
- `Executor` abstraction with `LocalExecutor` and `RustExecutor`.
- `RustExecutor` for protobuf-based communication with Rust runtime.
- Quotas: `maxOutputBytes`, `maxConcurrentExecutions`.
- The output quota crosses the protobuf boundary: `max_output_bytes` is enforced
  by the Rust runtime while streaming and reported back as `bytes_truncated`.
- Cancellation crosses it too: `ExecutorRunOptions.signal` makes `LocalExecutor`
  kill the child locally, while `RustExecutor` sends `Envelope.cancel` and the
  runtime kills the matching child and answers `CANCELLED`.
- Termination is graceful on both sides: commands lead their own process group,
  receive SIGTERM (group-wide on Unix) and are SIGKILLed only if they are still
  alive after a two-second grace period. Timeouts use the same sequence, so a
  sandbox wrapper cannot leave the real command running behind it.
- `SandboxProfile` and `SandboxExecutor` for Rust sandbox integration.
- `RestrictedExecutor` enforces profiles on macOS (`sandbox-exec`) and Linux (`bwrap`).
- `createWorkspaceSandboxProfile()` exposes only fixed read-only and
  workspace-write intents; built-in Shell/Git/Search tools use those profiles
  only when the selected executor exposes `runSandboxed`.
- `Executor.dispose()` lets CLI, Desktop, and MCP edges close Rust child
  processes deterministically while keeping LocalExecutor unchanged.


### `apps/desktop`
- **ChatSession**: Builds the `AgentLoop` with default tools and model provider;
  projects the shared runtime events into the existing SSE stream while
  retaining the legacy token/tool/turn frames for current clients.
- **HTTP server** (`server.ts`): Serves the static chat UI, `GET /health`, and `POST /api/chat` (Server-Sent Events). Configurable host/port via env.
- **Chat UI** (`public/index.html`): Single-page dark/light interface; renders live tokens and tool activity from the SSE stream.
- **Usage cost**: `usage` SSE frames carry an optional `cost` when the shared
  config has a matching `pricing` entry; the header accumulates tokens and cost
  per session and shows `$…` only when at least one frame was priced.
- **Sessions**: the picker can rename the current session (same
  `POST /api/sessions/<id>/rename` contract as the CLI), and `GET /api/sessions`
  returns each session's persisted `usage` plus a cost estimate for the current
  model, so switching or reloading restores the header counters.
- **Runtime trace**: the Desktop trace endpoint and Runtime Inspector `Trace`
  action expose the same bounded local snapshot as CLI `:trace`. Rendering is
  limited to run/span timing and status metadata; prompt text, tool inputs and
  output, paths, credentials, and raw errors stay outside the panel.
- **Conversation checkpoints**: ChatSession delegates to the bounded
  FileMemory checkpoint store through `GET /api/sessions/<id>/checkpoints`,
  `POST /api/sessions/<id>/checkpoint`, and
  `POST /api/sessions/<id>/checkpoint/rewind`. Rewind is active-run protected,
  anchor-validated, and truncates only conversation entries. It never rolls
  back workspace files, change sets, validation evidence, or applied-guard
  evidence. The browser requires explicit confirmation before calling rewind.
- **Interrupts**: a client disconnect aborts the run (the stream closes with
  `done { "status": "aborted" }`), and a second concurrent chat is rejected with
  409 so two runs never share one conversation state.
- Reuses `@dev-agent/agent-core`, `@dev-agent/model`, `@dev-agent/tools`, `@dev-agent/mcp`, `@dev-agent/executor`.

### `runtime/rust`
- Starlark policy evaluation for filesystem/network rules.
- macOS `sandbox-exec` enforcement (active).
- Linux `bwrap` backend (active): namespace isolation, filesystem bind policy, network policy, resource limits, and cwd enforcement; pure argument-builder tests run cross-platform and live execution tests run in the hosted Ubuntu integration job after namespace prerequisites pass.
- Per-stream output quota (`max_output_bytes`, default 1 MiB) enforced while
  streaming; exceeding it kills the child and sets `bytes_truncated`.
- The stdio binary keeps reading framed envelopes while each run executes
  in its own async task, so cancellation can be received during execution. Run
  requests are correlated by request id; responses share a serialized writer.
  In-flight work is bounded by `DEV_AGENT_MAX_CONCURRENT` (default 5), with a
  matching client-side limit in `RustExecutor`.
- Protobuf protocol for TS ↔ Rust communication.

### `apps/cli`
- Primary CLI entry point.
- Commands: `--once`, `--tools`, `--metadata`, `--compact`, `--session`, `--session-list`, `--reset-memory`.
- Live streaming output via `onToken`/`onToolCall`/`onToolResult` callbacks; `--no-stream` to disable.
- Ink interactive TTY mode uses Ink 6/React 19 and projects the shared runtime
  event stream into the queue-aware Signal Loom workbench. Ink is the only
  interactive TTY renderer; pipes and other non-rich modes retain their
  line-oriented contracts.
- `:team <request>` uses the CLI Git worktree provider and collaborative
  execution. `:team plan <request>` remains read-only; `:team apply` is the
  explicit, user-confirmed merge boundary. Ink renders task status,
  retry/cancel actions, bounded diff totals, and conflict state without
  exposing private worktree paths.
- Interactive CLI sessions expose `:trace`/`/trace` as a local metadata-only
  run summary. The Desktop server exposes the additive
  `GET /api/sessions/<sessionId>/trace` endpoint; neither surface changes the
  existing JSON, pipe, `--once`, MCP, or SSE contracts.
- Interactive CLI sessions expose `:checkpoint`, `:checkpoints`, and
  `:rewind <checkpointId>` (with slash aliases) for conversation history only.
  Rewind is anchor-validated and explicitly leaves workspace files unchanged.
- `--acp` serves the existing single-agent runtime through ACP v1 over
  newline-delimited JSON-RPC on stdio. Each `session/new` creates one
  AgentLoop context and memory handle; `session/prompt` streams runtime
  updates, tool progress, usage, approvals, cancellation, and stop reasons
  through the ACP client boundary.
- `--a2a` serves the existing single-agent runtime through A2A v1 over HTTP.
  It publishes `/.well-known/agent-card.json`, supports blocking and streaming
  task requests plus task lookup, cancellation, and bounded listing, and keeps
  protocol responses on HTTP while the startup diagnostic goes to stderr.
  Requests require `A2A-Version: 1.0`; non-loopback binds require the
  `DEV_AGENT_A2A_TOKEN` bearer token.
- Config file: `~/.dev-agent/config.json`.
- Ctrl-C interrupt handling with session state preservation.

### `evals`
- PTY-level behavior checks cover queued prompts, response ownership, approvals,
  tool loops, idle cancellation, ANSI resize/commands, and EOF handling.

## Data Flow

```
User Input
    ↓
CLI (parse args, load config)
    ↓
AgentLoop.run(context, input)
    ↓
ModelProvider.chat/streamChat → LLM
    ↓
[tool calls?] → AgentToolRegistry.runTool
    ↓
built-in command adapter → Executor.run or Executor.runSandboxed(profile)
    ↓
Memory.append (FileMemory/InMemory)
    ↓
Final answer → CLI output
```

For an ACP host, the transport and projection are explicit:

```text
ACP client / IDE
    ↓  JSON-RPC 2.0 over NDJSON stdio
packages/acp
    ↓  runtime factory
apps/cli ACP edge
    ↓
AgentLoop + provider + tools + memory + approval
```

For an A2A host, the boundary is HTTP and task-oriented:

```text
A2A client
    ↓  JSON-RPC 2.0 over HTTP, SSE for streaming
packages/a2a
    ↓  runtime factory
apps/cli A2A edge
    ↓
AgentLoop + provider + tools + memory + approval
```

ACP and A2A are separate integration surfaces. ACP owns IDE-style sessions
over stdio; A2A owns discoverable tasks over HTTP. Neither surface introduces
another provider configuration or another tool/approval policy.

## Starlark Policy Language

The Rust sandbox uses **Starlark** for filesystem/network/policy rules, consistent with the open-source Codex agent. See `runtime/rust/README.md` for the policy model.
