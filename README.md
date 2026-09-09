# dev-agent

An AI coding agent for developers, built with TypeScript and Node.js.

Phase 1 is a pnpm workspace monorepo made of small TypeScript packages. Low-level
capabilities such as sandboxing, process isolation, and filesystem security will be
added later in the Rust runtime under `runtime/rust`.

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
|   `-- rust/             Future Rust runtime for sandbox and isolation
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
- File-backed memory in `@dev-agent/agent-core` for cross-run conversation history
- CLI session isolation and reset via `--session` and `--reset-memory`
- Rich agent context with session id, working directory, metadata, task, and error state
- Context-aware built-in tools that run relative to `workingDirectory`
- `code-search` tool that scans TypeScript/JavaScript symbols in the project
- MCP server environment injection for session id and working directory
- TypeScript AST scanner in `@dev-agent/code-intelligence` for functions, classes,
  interfaces, type aliases, enums, methods, properties, variables, and arrow functions
- `InMemoryCodeIndex` with `addSource`, kind filters, token ranking, and
  limit-aware `searchSymbols` in `@dev-agent/code-intelligence`
- `TypeScriptReferenceIndex` for reference search and go-to-definition via the
  TypeScript language service in `@dev-agent/code-intelligence`
- `code-search` tool now supports `search` (default), `references`, and `definition`
  modes, so agents can find symbol usages and jump to definitions
- Model contracts plus OpenAI, Anthropic, Gemini, and Ollama providers in `@dev-agent/model`
- Built-in filesystem, shell, git, and search tools in `@dev-agent/tools`
- Executor contract in `@dev-agent/executor` with `cwd`, `env`, stdin `input`,
  and `timeoutMs` support on `LocalExecutor`; `RustExecutor` implements
  `SandboxExecutor` over the protobuf stdio boundary, with sandbox enforcement
  reserved for the Rust runtime
- Basic stdio MCP client and MCP tool registration in `@dev-agent/mcp`, wired into the CLI
- MCP resources and prompts support in `@dev-agent/mcp`, with `ping` and
  initialized lifecycle notifications
- MCP resources and prompts wired into the CLI agent loop via `<prefix>:resource`
  and `<prefix>:prompt` tools, with available resources/prompts listed in the
  agent system prompt
- CLI entry point wired to the loop and verified with local Ollama smoke tests
- Policy language direction set: the future Rust sandbox will use **Starlark** for
  filesystem/network/policy rules, consistent with the open-source Codex agent
- Rust runtime boundary is active: `runtime/rust` has a `dev-agent-runtime`
  crate with `LocalExecutor`, `SandboxExecutor`, a `dev-agent-executor` stdio
  binary, and a protobuf protocol (`proto/executor.proto`) defining the TS↔Rust
  boundary. `RustExecutor` on the TS side spawns the binary and speaks
  length-prefixed protobuf over stdio, implementing both `Executor` and
  `SandboxExecutor`
- `apps/cli --check-rust <path>` sends a health check to the Rust binary and
  reports the runtime version and capabilities; `--rust-executor <path>` routes
  command execution through `RustExecutor`
- MCP capability negotiation: client declares `roots` capability, captures and exposes
  server capabilities and server info from the `initialize` response
- MCP server lifecycle: `McpStdioClient.reconnect()` re-establishes a dropped session,
  and `onNotification` receives server→client notifications (`tools/list_changed`,
  `resources/list_changed`, `prompts/list_changed`, `message`, `progress`, `cancelled`)
- MCP `roots/list` handling: client responds to server roots requests with the workspace
  directory, so servers that query client roots work correctly
- MCP `McpServerSession` wraps connect/reconnect/close with change callbacks, so the CLI
  can dynamically re-register tools when a server reports its tool list changed
- `AgentToolRegistry.unregister` added to support clean MCP tool re-registration

### Rust runtime progress

- Fixed binary framing bug in `RustExecutor`: protobuf data is now handled as
  `Buffer` (not UTF-8 strings), so binary payloads are no longer corrupted
- Fixed request/response matching: Rust binary now propagates `request_id` from
  `Envelope` to `Response`, so the TS side can match responses to pending requests
- Self-contained mock binary (`packages/executor/tests/mock-executor-binary.mjs`)
  speaks the same length-prefixed protobuf protocol with zero external dependencies,
  enabling TS↔Rust boundary testing without a Rust toolchain
- Rust unit tests for `LocalExecutor`, `SandboxExecutor`, and `stdio_transport`
  pass (16 tests with the current Rust toolchain)
- `SandboxExecutor::evaluate_policy` now runs Starlark policy scripts with
  `starlark 0.14`, binding `ctx.command`, `ctx.args`, `ctx.cwd`,
  `ctx.network_policy`, `ctx.writable_paths`, and `ctx.readonly_paths` before
  returning an `Allow` or `Deny` decision
- The Rust `dev-agent-executor` binary routes `runSandboxed` through
  `SandboxExecutor`, and a real-binary integration test verifies both allow and
  policy-denied responses from TypeScript

## Roadmap

1. Richer code index and reference search
2. MCP resources, prompts, and richer server lifecycle
3. Rust runtime under `runtime/rust`, implemented behind the `SandboxExecutor` contract.
   Sandbox and filesystem policies will be authored in **Starlark** (the same
   approach used by the open-source Codex agent), evaluated at runtime by an
   embedded Starlark interpreter in Rust. Starlark `policy` evaluation is now
   implemented and tested; the remaining work is enforcement of filesystem,
   network, and process isolation semantics around the evaluated decision
4. Desktop shell in `apps/desktop`
