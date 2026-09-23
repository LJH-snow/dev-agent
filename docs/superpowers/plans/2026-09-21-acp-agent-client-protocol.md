# 2026-09-21 ACP Agent Client Protocol bridge

## Goal

Expose the existing single-agent runtime through the stable ACP v1 protocol so
an IDE or another ACP client can use dev-agent without scraping CLI text or
depending on the Ink renderer.

## Scope

This phase adds:

- a reusable `@dev-agent/acp` package backed by the official TypeScript ACP v1
  SDK;
- newline-delimited JSON over stdio for the CLI `--acp` entry point;
- `initialize`, `session/new`, `session/prompt`, and `session/cancel`;
- streamed `session/update` notifications for user/assistant/reasoning chunks,
  tool calls, tool progress/results, usage, and terminal status;
- client-side `session/request_permission` for the existing approval policy;
- one runtime session per ACP session id, with bounded session cleanup and
  cancellation;
- protocol tests that exercise an in-process ACP client and a CLI subprocess
  smoke test.

The bridge does not add A2A, multi-agent orchestration, a second model config
format, or filesystem access outside the existing AgentLoop policy.

## Architecture

```text
ACP client / IDE
       |
       | ACP v1 JSON-RPC over NDJSON stdio
       v
@dev-agent/acp
       |
       | session runtime factory
       v
AgentLoop + FileMemory + ToolRegistry
       |
       v
shared RuntimeEvent stream
```

The ACP package owns protocol lifecycle and content/update mapping. The CLI
owns provider construction, configuration, executor selection, MCP setup, and
approval policy. ACP never renders ANSI or Ink output to stdout.

## Tasks

### Task 1: Lock the protocol contract with RED tests

- Add package tests for initialization and capability advertisement.
- Add session creation, text prompt, streamed assistant update, tool update,
  and final stop reason coverage.
- Add cancellation coverage proving the runtime receives an abort signal and
  returns `cancelled`.
- Add permission forwarding coverage for `session/request_permission`.
- Add an invalid/unsupported prompt-content test with a stable protocol error.
- Add a CLI `--acp` subprocess smoke test that verifies stdout contains only
  ACP frames and stderr is the only diagnostic channel.
- Run the focused tests before implementation and confirm they fail.

### Task 2: Implement the reusable ACP bridge

- Add `packages/acp` with the official stable ACP SDK dependency.
- Define a small `AcpSessionRuntime` / factory contract so the protocol package
  does not know CLI config or provider credentials.
- Register typed ACP request/notification handlers with the SDK.
- Keep session ids, prompt ownership, active-run state, and cancellation
  bounded and deterministic.
- Map runtime-facing updates into ACP `session/update` notifications without
  including raw credentials or absolute paths that the existing redaction
  boundary would reject.

### Task 3: Connect the CLI

- Add `--acp` to the CLI argument surface and help text.
- Build ACP sessions from the existing model selection, tools, executor,
  memory, hooks, approval, validation, and MCP setup boundaries.
- Keep protocol frames on stdout and diagnostics on stderr.
- Preserve all existing rich TTY, pipe, JSON, `--once`, and MCP-server paths.
- Close sessions, MCP clients, and executors when the ACP connection closes.

### Task 4: Verify and record the phase

- [x] Run focused ACP package and CLI tests.
- [x] Run `pnpm test:evals`.
- [x] Run `pnpm verify:typescript` and `git diff --check`.
- [x] Update architecture, CLI, package, task, and progress documentation with
  exact verification evidence.
- [x] Do not publish packages or create a release.

Verification completed on 2026-09-21:

- `@dev-agent/acp` package tests: **5/5**.
- CLI ACP subprocess smoke: **2/2**.
- CLI full suite: **490/490**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed, including the workspace build/typecheck,
  package-install smoke, release-boundary contracts, preview contracts, and
  documentation contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

## Acceptance criteria

- An ACP client can initialize the agent and create a session with an absolute
  working directory.
- A text prompt produces ordered streamed `session/update` notifications and
  an ACP `session/prompt` response with a valid stop reason.
- Tool progress and approval requests remain associated with the same ACP
  session.
- `session/cancel` stops the active AgentLoop run without starting a second
  run or leaking a late completion.
- Stdout is protocol-only in `--acp` mode; human diagnostics use stderr.
- Existing CLI and Desktop behavior remains green under the fixed TypeScript
  gate and the rich TTY evaluations.
