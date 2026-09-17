# dev-agent Documentation

Architecture, design decisions, and module documentation.

## Documentation source of truth

- **User-facing status and roadmap:** the [root README](../README.md) is the concise
  entry point; its Roadmap uses one unique sequential number per completed item.
- **Architecture and module boundaries:** [architecture.md](architecture.md) is the
  reference for system responsibilities and runtime boundaries.

The `v62/v63/v64` labels in phase documents are release-planning phase labels; they are not the
numbered items 62/63/64 in the root README Roadmap.
- **Chronological decisions and evidence:** [CHANGELOG.md](CHANGELOG.md) preserves
  dated implementation notes, validation evidence, and Preserve/NO-GO decisions.
- **Current execution and delivery plan:** the v62 Linux hosted integration, v63 executor-mode
  visibility, v64 release-candidate readiness audit, CLI Modern TUI v1, and CLI TUI v1.1 reliability work are
  complete. Their day plans and
  progress records remain the evidence source for each decision. The [next-phase plan](next-roadmap-plans-v62-plus.md)
  records the remaining gated options: formal release preparation, v65 Desktop UX only after a
  concrete trigger, and the Windows backend as NO-GO. The [CLI npm distribution guide](release-cli-npm.md)
  records the clean-install evidence, `--cwd` precedence, config/session isolation, npm preflight,
  and optional Rust sandbox boundary. The [release state](release-state.json) distinguishes the published
  registry version from the local release candidate. The [CLI runtime observability spec](cli-runtime-observability.md),
  [CLI runtime implementation plan](superpowers/plans/2026-09-14-cli-runtime-observability.md),
  [CLI TUI v1 spec](cli-tui-v1.md), [CLI TUI v1.1 reliability spec](cli-tui-v1.1-reliability.md),
  [implementation plan](superpowers/plans/2026-09-14-cli-tui-v1.md), and [v1.1 implementation plan](superpowers/plans/2026-09-14-cli-tui-v1.1-reliability.md)
  describe the current CLI interaction delivery. The [v0.1.0 Release Candidate checklist](release-candidate-checklist-v0.1.0.md)
  and [hardening plan](superpowers/plans/2026-09-15-release-candidate-hardening.md), and the [8-hour
  unattended development goal](superpowers/plans/2026-09-15-eight-hour-unattended-development-goal.md), its [progress
  record](superpowers/plans/2026-09-15-eight-hour-unattended-development-goal-progress.md), the [release provenance
  audit](superpowers/plans/2026-09-15-release-provenance-audit.md), the [cancellation boundary audit](superpowers/plans/2026-09-15-cancellation-boundary-audit.md), and the [current 10-goal overnight development plan](superpowers/plans/2026-09-15-overnight-development-goals.md) define the current merge-preparation boundary
  and maintainer decision gate. The [project-scoped CLI state plan](superpowers/plans/2026-09-16-project-state-isolation.md)
  records the explicit opt-in follow-up for external-project config/session isolation. The [v0.1.5–v0.4.0 development plan](development-plan-v0.1.5-v0.4.0.md) is now the active execution checklist for project initialization, runtime distribution, CI/review mode, provider management, code search, MCP management, and Desktop status UX. Historical phase records remain linked for auditability:
  [v60 plan](day-plan-v60.md), [v60 progress](day-plan-v60-progress.md), [v61 plan](day-plan-v61.md),
  [v61 progress](day-plan-v61-progress.md), [Windows feasibility notes](windows-sandbox-feasibility-v61.md),
  [v62 plan](day-plan-v62.md), [v62 progress](day-plan-v62-progress.md), [v63 plan](day-plan-v63.md),
  [v63 progress](day-plan-v63-progress.md), [v64 plan](day-plan-v64.md), and [v64 progress](day-plan-v64-progress.md).
- **Executable authority:** workflow files, `scripts/release-gate.mjs`, and their
  fixed contract tests remain authoritative for CI and release behavior; prose here
  is navigation and explanation, not a replacement for those checks.

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
debug `dev-agent-executor` binary and the executor package's `dist` output. On a
fresh checkout, run `pnpm build`, `cargo build --bin dev-agent-executor` from
`runtime/rust`, and then the integration entrypoint; the GitHub workflow builds
both explicitly and checks the live sandbox prerequisites before invoking it.
Local workspaces may skip live sandbox cases when their platform prerequisites are absent; hosted macOS/Linux jobs fail closed on missing prerequisites and require all expected live cases to run. Gate
selection does not accept arbitrary commands, model output, or persisted evidence
as execution input. The TypeScript phase also runs the preview, fixed-gate, release-workflow, CI-workflow,
and bounded documentation contracts in a fixed order. The CI workflow installs the
`expect`/`procps` PTY dependencies before the TypeScript gate; the release workflow keeps
publish permissions job-scoped and verifies tag/artifact integrity before invoking GitHub CLI.

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
