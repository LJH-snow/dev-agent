# dev-agent

An AI coding agent for developers, built with TypeScript and Node.js.

Phase 1 is a pnpm workspace monorepo made of small TypeScript packages. Low-level
capabilities such as sandboxing, process isolation, and filesystem security live
in the Rust runtime under `runtime/rust`; the macOS backend is active, and Linux
backend support is planned next.

## Structure

```text
dev-agent/
|-- apps/
|   |-- cli/              Primary phase-1 entry point
|   `-- desktop/          Placeholder; desktop shell is not implemented yet
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

Requires Node.js >= 20 and pnpm.

```bash
pnpm install
pnpm check
pnpm build
pnpm typecheck
pnpm cli -- --version
```

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
- CLI entry point wired to the loop with `--once`, `--tools`, `--metadata`,
  `--compact`, and Ctrl-C interrupt handling. Agent loop exposes `onTurn` callback
  for streaming progress
- Policy language: the Rust sandbox uses **Starlark** for filesystem/network/policy
  rules, consistent with the open-source Codex agent
- Rust runtime boundary is active: `runtime/rust` has a `dev-agent-runtime`
  crate with `LocalExecutor`, `SandboxExecutor`, a `dev-agent-executor` stdio
  binary, and a protobuf protocol (`proto/executor.proto`)
- macOS `sandbox-exec` enforcement is active for filesystem, network, timeout,
  and resource limits. Linux bubblewrap backend is planned next
- Test suite: 90 TypeScript tests + 26 Rust tests, all passing

### Rust runtime progress

- Starlark policy evaluation with `starlark 0.14`, tick/heap limits, and `ctx` bindings
- macOS `sandbox-exec` enforcement: writable/read-only paths, network policy, cwd,
  timeout, and resource limits (CPU, FSIZE, NOFILE, NPROC, CORE)
- Linux placeholder detects `bwrap` availability for clearer error messages
## Current Status (v2)

- Agent Loop streaming with token-level callbacks
- Tool output truncation and timeout protection
- MCP resource subscription (watchResource)
- Multi-language code intelligence (TypeScript, Python, Rust)
- Executor quotas (maxOutputBytes, maxConcurrentExecutions)
- CLI configuration file support (~/.dev-agent/config.json)
- 101 TypeScript tests + 26 Rust tests passing

## Roadmap

1. ~~Richer code index and reference search~~ (done)
2. ~~MCP resources, prompts, and richer server lifecycle~~ (done)
3. ~~Agent Loop streaming and tool safety~~ (done)
4. ~~Multi-language symbol scanning~~ (done)
5. Linux bubblewrap backend for Rust sandbox
6. Desktop shell in `apps/desktop`
7. CLI streaming output and session management hardening
8. Network policy enforcement via Starlark
