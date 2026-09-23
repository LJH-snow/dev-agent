# 2026-09-21 A2A Agent Server boundary

## Goal

Expose the existing single-agent runtime through a bounded, local-first A2A
v1.0 server so another agent or host can discover the agent, submit a text
message, observe task progress, fetch a task, and cancel an active task.

The implementation must reuse the existing AgentLoop, Runtime Events, tool
registry, approval policy, executor, MCP context, and session memory. A2A is a
transport/projection boundary; it must not move orchestration or safety policy
into the protocol adapter.

## Verified protocol baseline

- Official package: `@a2a-js/sdk@1.2.0`.
- Protocol baseline: A2A v1.0.
- Server primitives: `DefaultRequestHandler`, `AgentExecutor`,
  `DefaultExecutionEventBus`, `DefaultExecutionEventBusManager`,
  `InMemoryTaskStore`, and `JsonRpcTransportHandler`.
- Agent card discovery path: `/.well-known/agent-card.json`.
- First transport: Node's existing HTTP server with JSON-RPC request handling
  and SSE for streaming responses. Express and gRPC are intentionally out of
  scope for this phase.

## Non-goals

- No multi-agent planner, delegation graph, or autonomous agent-to-agent
  orchestration.
- No public network exposure by default; the CLI binds to loopback unless the
  caller explicitly supplies a host.
- No OAuth, push notifications, signed agent cards, or gRPC in this phase.
  Loopback is unauthenticated; explicit non-loopback binds require a bearer
  token.
- No second model configuration format and no second tool/approval policy.
- No raw provider errors, prompts containing secrets, filesystem contents, tool
  inputs, or workspace paths in the agent card or task metadata.
- No npm publish, release, tag, or package registry operation.

## Design

```text
A2A client
    | JSON-RPC 2.0 / HTTP + SSE
    v
@dev-agent/a2a
    |- Agent Card projection
    |- JSON-RPC + SSE HTTP adapter
    |- task lifecycle and cancellation bridge
    `- bounded metadata/text sanitization
    v
CLI A2A edge
    `- existing model / memory / MCP / tools / executor / approval setup
        v
AgentLoop + Runtime Events
```

The reusable package owns wire lifecycle, task identity, event projection, and
transport cleanup. The CLI edge constructs one runtime session per A2A task
context and supplies the existing policy and tool dependencies.

## Tasks

### Task 1: Lock the adapter contract with tests

- [x] Add package-level tests for the agent card's v1.0 JSON-RPC interface,
      loopback-safe metadata, and capability flags.
- [x] Add in-process tests for `SendMessage`, `SendStreamingMessage`,
      `GetTask`, and `CancelTask`.
- [x] Prove that streamed task/status/artifact events preserve one task id and
      terminate exactly once.
- [x] Prove malformed JSON, unsupported methods, oversized bodies, and unknown
      tasks return bounded protocol errors.

### Task 2: Add the reusable A2A package

- [x] Add `packages/a2a` with the official SDK dependency.
- [x] Define a provider-neutral runtime factory that accepts a task context,
      text prompt, `AbortSignal`, and event sink.
- [x] Map assistant text, reasoning/status, tool progress, approvals, and
      failures into A2A task/status/artifact events without exposing raw
      sensitive payloads; reasoning is suppressed by default.
- [x] Keep task storage and active cancellation bounded and deterministic.
- [x] Protect active tasks from eviction, reject same-context concurrency,
      and preserve unique bounded session keys for distinct context IDs.
- [x] Close event buses, runtime sessions, and task controllers on completion,
      cancellation, connection close, and process shutdown.

### Task 3: Add the Node HTTP transport

- [x] Serve `GET /.well-known/agent-card.json`.
- [x] Serve JSON-RPC requests through the official
      `JsonRpcTransportHandler`.
- [x] Stream A2A responses as bounded SSE with the SDK's event framing.
- [x] Abort the underlying run and emit a bounded protocol error when the SSE
      limit is reached or the client cannot drain the response.
- [x] Require `A2A-Version: 1.0` and protect non-loopback binds with bearer
      authentication.
- [x] Keep protocol output separate from human diagnostics.
- [x] Reuse existing body-size, host, and error-boundary conventions.

### Task 4: Connect the CLI

- [x] Add `--a2a`, `--host`, and `--port` argument handling.
- [x] Reuse the selected provider, model routing, memory, MCP supplement,
      executor, approval policy, validation policy, and tool registry.
- [x] Keep Rich Ink/ANSI UI disabled in A2A mode.
- [x] Print only a short startup diagnostic to stderr; reserve HTTP responses
      for protocol payloads.
- [x] Add CLI subprocess smoke coverage for card discovery, send, stream, and
      cancellation.

### Task 5: Documentation and verification

- [x] Document the local launch command, endpoint, card path, supported
      methods, and explicit limitations.
- [x] Update architecture and CLI docs to distinguish ACP from A2A.
- [x] Run focused A2A tests, CLI tests, Desktop tests, rich CLI evaluations,
      the TypeScript release gate, and `git diff --check`.
- [x] Record exact verification counts and remaining follow-up here and in
      `progress.md`.

## Acceptance criteria

- A2A client discovery returns a valid v1.0 agent card without leaking the
  current working directory or provider credentials.
- A text `SendMessage` request reaches the existing AgentLoop and returns a
  task or message with a stable task/context identity.
- `SendStreamingMessage` emits ordered, bounded task lifecycle updates and a
  final terminal state; no duplicate assistant answer is emitted.
- `GetTask` returns the bounded persisted task for a known id and a protocol
  error for an unknown id.
- `CancelTask` aborts the underlying AgentLoop and reaches a terminal canceled
  state.
- Closing a client connection does not leave an active model/tool run or event
  listener behind.
- Existing CLI, Desktop, core, tools, MCP, and release-contract tests remain
  green.

## Verification record

Final verification:

- A2A package tests: **10/10**.
- CLI A2A subprocess smoke: **4/4** (card/send, real-provider stream,
  session-key isolation, and
  live cancellation).
- CLI argument tests: **19/19**.
- CLI A2A and argument tests: **23/23** after correcting the expected
  machine-output stream for `--a2a --json`.
- Agent Core tests: **176/176**.
- Model tests: **80/80**.
- Desktop tests: **150/150**.
- `pnpm --filter @agent_cli/cli build` and `typecheck` pass.
- Full CLI suite: **513/513**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed all selected gates, including workspace
  build/typecheck/tests, CLI package install smoke, release/preflight
  contracts, preview contracts, documentation contracts, and native Desktop
  bundle contracts.
- `git diff --check` passed. No npm publish, tag, release, or network package
  operation was performed.
