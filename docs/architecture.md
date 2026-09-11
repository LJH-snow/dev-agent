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
- **Usage**: every model response that reports tokens fires `onUsage`, and the
  loop accumulates the totals on `AgentContext.usage` across runs.

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
  that arrives in a stream's final event.

### `packages/tools`
- `AgentToolRegistry` for registering and looking up tools.
- Built-in tools: filesystem, shell, git, code-search.
- Context-aware execution relative to `workingDirectory`.
- `CodeSearchTool` caches its scan per root (symbol index, per-file signatures,
  sources) and re-reads only files whose size or mtime changed; deleted files
  leave the index. `getCacheStats()` exposes hits/misses/rescanned.

### `packages/mcp`
- `McpStdioClient`: JSON-RPC 2.0 over stdio transport.
- `McpServerSession`: Session lifecycle, debounced notifications, reconnect with backoff.
- Resource subscription via `watchResource()`.
- Structured error codes (`McpRequestError`).
- **Server mode**: `createMcpServer({ tools })` speaks newline-delimited
  JSON-RPC over stdio and implements `initialize`, `ping`, `tools/list`, and
  `tools/call`. Tool implementations are injected, so the package keeps no
  dependency on `@dev-agent/tools`; the CLI's `--mcp-server` wires the built-in
  tools in. Tool failures answer `{ isError: true }`; unknown tools and methods
  are JSON-RPC errors.

### `packages/code-intelligence`
- Multi-language symbol scanning: TypeScript (AST), Python (regex), Rust (regex).
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
