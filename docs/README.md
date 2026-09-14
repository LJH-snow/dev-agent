# dev-agent Documentation

Architecture, design decisions, and module documentation.

## Architecture Overview

`dev-agent` is a pnpm workspace monorepo. TypeScript packages form the agent
runtime; a Rust runtime provides sandbox enforcement.

```
dev-agent/
├── apps/
│   ├── cli/              Primary CLI entry point (phase 1)
│   └── desktop/          Local web server with streaming chat UI (SSE)
├── packages/
│   ├── agent-core/       Agent loop, context, memory, agent state
│   ├── model/            Unified LLM provider (OpenAI, Anthropic, Gemini, Ollama)
│   ├── tools/            Tool registry + built-in tools (fs, shell, git, search, code-search)
│   ├── mcp/              MCP client, reconnect backoff, notification debounce
│   ├── code-intelligence/ AST scanner, in-memory + JSON-persistent code index, reference search
│   └── executor/         Executor abstraction: LocalExecutor + RustExecutor (protobuf stdio)
├── runtime/
│   └── rust/             Sandbox enforcement (macOS sandbox-exec, Linux bwrap, Starlark policies)
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
- **runtime/rust**: Enforces sandbox profiles with `sandbox-exec` on macOS and `bwrap`
  on Linux. Policies are authored in **Starlark** and evaluated by an embedded interpreter;
  the policy script receives `ctx.network_policy` (`"enabled"`, `"disabled"`, `"loopback"`)
  for network policy decisions.
- **apps/desktop**: `ChatSession` builds the `AgentLoop` with default tools and model
  provider, bridging streaming callbacks to SSE events. `server.ts` serves a static chat UI
  with `POST /api/chat` (Server-Sent Events) and `GET /health`. Single-page dark/light UI
  in `public/index.html`; the header's Evidence control calls the existing metadata-only
  `GET /api/sessions/<id>/evidence/preview` endpoint and renders only counts plus estimated
  canonical export size. It does not replace transcript Download or add audit-export authority;
  the shell also exposes explicit labels, focus-visible styling, live status, and preview loading
  semantics for keyboard and assistive-technology users.

## Policy Language: Starlark

Sandbox, filesystem, and network policies are authored in Starlark and evaluated by the
Rust runtime. This follows the open-source Codex agent's approach: deterministic,
sandboxable, auditable rules instead of raw JSON or ad-hoc DSLs. The policy script receives
a `ctx` struct including `ctx.network_policy` (`"enabled"`, `"disabled"`, `"loopback"`) to
make network access decisions.

See `runtime/rust/README.md` for the policy model and Linux backend status.

## Verification and release gates

The repository has one fixed verification runner so local checks and CI do not
drift:

```bash
pnpm verify                 # TypeScript → Rust → real-Rust integration
pnpm verify:typescript      # structure check, build, typecheck, workspace tests
pnpm verify:rust            # cargo fmt, clippy, and Rust unit/doc tests
pnpm verify:integration     # real Rust integration (after required artifact builds)
```

The runner uses fixed argument arrays and fixed working directories, never enables
a shell, and stops at the first failed phase. The integration phase is separate
from the Rust unit/doc phase and requires two artifacts before it can run: the
debug `dev-agent-executor` binary and the executor package's `dist` output. The
GitHub workflow builds both explicitly, then checks the live sandbox prerequisites
before invoking the standalone `pnpm verify:integration` entrypoint. Gate selection
does not accept arbitrary commands, model output, or persisted evidence as execution
input.

When CI or a local pre-push check needs a machine-readable result, append
`--report` to a phase entry point:

```bash
node scripts/release-gate.mjs --typescript --report
```

This writes only the fixed ignored file `.dev-agent/release-gate-report.json`.
The report is an allowlisted metadata snapshot of selected modes, phase ids,
status, timings, exit codes, and the failed phase. It does not contain commands,
args, cwd, stdout, stderr, environment values, session evidence, or file bytes;
without `--report`, no report file is created or updated.

### Audit export limits

The versioned evidence export is a complete, metadata-only v1 snapshot. Callers
may request rejection-only limits after projection: validations and change sets
are capped at 10,000 each, files at 100,000, and the canonical UTF-8 JSON at
10,485,760 bytes. The CLI flags are `--audit-max-validations`,
`--audit-max-change-sets`, `--audit-max-files`, and `--audit-max-bytes`; the
Desktop evidence endpoint uses matching camel-case query parameters. Invalid
limits are rejected before export, and a complete snapshot that exceeds a limit
returns a structured error rather than a truncated or paginated v1 response.

### Audit export preview

The read-only preflight is a separate preview schema, not an extension of the v1
export. CLI `--preview-evidence` and Desktop
`GET /api/sessions/<id>/evidence/preview` first build the same complete, stable
allowlist projection in memory, then return only `schemaVersion`, `sessionId`,
`generatedAt`, `validationCount`, `changeSetCount`, `fileCount`, and
`serializedBytes`. The byte count is the canonical projection's UTF-8 JSON byte
length, so it can guide a later rejection-only limit without truncation. Preview
accepts the standard evidence filters but not audit limit parameters; it does not
load a provider, enter the chat queue, access the workspace, expose evidence
content, or provide pagination, schema negotiation, restore, or Undo authority.

### Preview bounded-work benchmark (development only)

v45 includes a synthetic, metadata-only benchmark for the complete preview projection:

```bash
pnpm test:benchmark        # benchmark contract/regression tests
pnpm benchmark:evidence    # six fixtures; writes only .dev-agent/evidence-preview-benchmark.json
pnpm test:preview-parity   # core/CLI/Desktop preview contract and query compatibility tests
```

The benchmark never reads a workspace, starts a provider, enters the chat queue, or emits
fixture evidence. It compares preview bytes with the full v1 canonical serializer and records
counts, UTF-8 bytes, wall time, and approximate heap delta. The v45 matrix did not reproduce a
concrete availability gap, so no second preview hard cap was added; future larger real-world
traces should be benchmarked before changing the preview contract.
