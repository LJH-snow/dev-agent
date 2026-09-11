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
  Callers can install their own policy: the desktop passes a requester so `ask`
  can prompt the user over SSE (`approval-request` / `POST /api/approval`) and
  deny when nothing answers within the timeout. `normalizeApprovalKey()` turns a
  request into the key an "always allow" decision is remembered under (command
  name + first non-flag token, `sh -c` unwrapped), so extra flags share one key.
  The built-in table matches both spellings of a dangerous shape: `rm -rf` and
  `rm --recursive --force`, `git push --force` / `-f` / `+refspec`, while
  `rm --force file` (no recursion) and `git push --follow-tags` stay allowed.
  Git options that spawn another process (`-c`, `--config-env`, `--exec-path`,
  `--upload-pack`, `--receive-pack`) are flagged as well, so `git -c alias.x=!cmd`
  cannot slip past the shell approval.
  A client disconnect aborts the run's signal, which also settles and removes
  any approval prompt still waiting for an answer.
- **Usage**: every model response that reports tokens fires `onUsage`, and the
  loop accumulates the totals on `AgentContext.usage` across runs. Each report
  is also handed to `AgentMemory.recordUsage()`, which `InMemoryMemory` keeps in
  process and `FileMemory` persists as `metadata.usage`, so a restarted CLI or
  desktop session can restore the total. Cache-hit prompt tokens
  (`ChatUsage.cachedPromptTokens`) are carried through the same total.

### `packages/model`
- Unified `ModelProvider` interface with `chat()` and `streamChat()` methods.
- Providers: OpenAI, Anthropic, Gemini, Ollama.
- SSE/streaming parsing for each provider's wire format.
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
- `Executor` abstraction with `LocalExecutor` (phase 1).
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


### `apps/desktop`
- **ChatSession**: Builds the `AgentLoop` with default tools and model provider; bridges `onToken`/`onToolCall`/`onToolResult`/`onTurn` callbacks to streaming events.
- **HTTP server** (`server.ts`): Serves the static chat UI, `GET /health`, and `POST /api/chat` (Server-Sent Events). Configurable host/port via env.
- **Chat UI** (`public/index.html`): Single-page dark/light interface; renders live tokens and tool activity from the SSE stream.
- **Usage cost**: `usage` SSE frames carry an optional `cost` when the shared
  config has a matching `pricing` entry; the header accumulates tokens and cost
  per session and shows `$…` only when at least one frame was priced.
- **Sessions**: the picker can rename the current session (same
  `POST /api/sessions/<id>/rename` contract as the CLI), and `GET /api/sessions`
  returns each session's persisted `usage` plus a cost estimate for the current
  model, so switching or reloading restores the header counters.
- **Interrupts**: a client disconnect aborts the run (the stream closes with
  `done { "status": "aborted" }`), and a second concurrent chat is rejected with
  409 so two runs never share one conversation state.
- Reuses `@dev-agent/agent-core`, `@dev-agent/model`, `@dev-agent/tools`, `@dev-agent/mcp`, `@dev-agent/executor`.

### `runtime/rust`
- Starlark policy evaluation for filesystem/network rules.
- macOS `sandbox-exec` enforcement (active).
- Linux bubblewrap backend (planned).
- Per-stream output quota (`max_output_bytes`, default 1 MiB) enforced while
  streaming; exceeding it kills the child and sets `bytes_truncated`.
- The stdio binary handles one envelope at a time, so a single
  `dev-agent-executor` process runs commands strictly serially.
- Protobuf protocol for TS ↔ Rust communication.

### `apps/cli`
- Primary CLI entry point.
- Commands: `--once`, `--tools`, `--metadata`, `--compact`, `--session`, `--session-list`, `--reset-memory`.
- Live streaming output via `onToken`/`onToolCall`/`onToolResult` callbacks; `--no-stream` to disable.
- Config file: `~/.dev-agent/config.json`.
- Ctrl-C interrupt handling with session state preservation.

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
[tool calls?] → ToolRegistry.runTool → Executor.run
    ↓
Memory.append (FileMemory/InMemory)
    ↓
Final answer → CLI output
```

## Starlark Policy Language

The Rust sandbox uses **Starlark** for filesystem/network/policy rules, consistent with the open-source Codex agent. See `runtime/rust/README.md` for the policy model.
