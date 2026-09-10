# dev-agent Documentation

Architecture, design decisions, and module documentation.

## Architecture Overview

`dev-agent` is a pnpm workspace monorepo. TypeScript packages form the agent
runtime; a Rust runtime provides sandbox enforcement.

```
dev-agent/
├── apps/
│   ├── cli/              Primary CLI entry point (phase 1)
│   └── desktop/          Placeholder (not implemented)
├── packages/
│   ├── agent-core/       Agent loop, context, memory, agent state
│   ├── model/            Unified LLM provider (OpenAI, Anthropic, Gemini, Ollama)
│   ├── tools/            Tool registry + built-in tools (fs, shell, git, search, code-search)
│   ├── mcp/              MCP client, reconnect backoff, notification debounce
│   ├── code-intelligence/ AST scanner, in-memory + JSON-persistent code index, reference search
│   └── executor/         Executor abstraction: LocalExecutor + RustExecutor (protobuf stdio)
├── runtime/
│   └── rust/             Sandbox enforcement (macOS sandbox-exec, Starlark policies)
├── configs/              Shared TypeScript configuration
├── docs/                 This documentation
└── tests/                Test suites
```

## Module Responsibilities

- **agent-core**: The `AgentLoop` drives the chat→tool→chat cycle. `FileMemory`
  persists conversation history as JSON. `AgentToolRegistry` manages tool registration.
- **model**: `ModelProvider` is the unified interface. Each provider (OpenAI, Anthropic,
  Gemini, Ollama) implements `chat(messages, options)`.
- **tools**: `ToolRegistry` holds built-in tools. `CodeSearchTool` queries the code index.
- **mcp**: `McpStdioClient` speaks JSON-RPC over stdio. `McpServerSession` adds reconnect
  backoff and debounced list-change notifications. Errors propagate as `McpRequestError`.
- **code-intelligence**: `InMemoryCodeIndex` ranks symbols by exact/token match with
  case-sensitive bonus and test-file demotion. `JsonFileCodeIndex` persists to disk.
  `TypeScriptReferenceIndex` uses the TS language service for go-to-definition.
- **executor**: `LocalExecutor` runs commands locally with optional history. `RustExecutor`
  spawns the Rust binary and speaks length-prefixed protobuf.
- **runtime/rust**: Enforces sandbox profiles with `sandbox-exec` on macOS. Policies are
  authored in **Starlark** and evaluated by an embedded interpreter.

## Policy Language: Starlark

Sandbox, filesystem, and network policies are authored in Starlark and evaluated
by the Rust runtime. This follows the open-source Codex agent's approach: deterministic,
sandboxable, auditable rules instead of raw JSON or ad-hoc DSLs.

See `runtime/rust/README.md` for the policy model and Linux backend status.
