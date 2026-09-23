# Hooks and Run Observability Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini-style lifecycle Hooks active in CLI and Desktop sessions, and expose a bounded metadata-only Agent Run trace for diagnosing model/tool timing without storing prompts, file contents, or secrets.

**Architecture:** Add a small `AgentRunTrace` collector in Agent Core that registers deterministic observers on the existing `AgentHookRegistry`. AgentLoop supplies timestamps, operation identifiers, and model usage to the lifecycle hooks; CLI and Desktop own one registry/trace per session and pass the registry into every loop. The CLI gets a `:trace` command and Desktop gets a read-only session trace endpoint, both backed by the same bounded snapshot.

**Tech Stack:** TypeScript, Node.js `node:test`, existing Agent Core Hooks, Runtime Events, CLI ANSI/Ink adapters, Desktop HTTP/SSE server.

**Spec:** `docs/geminicli/gemini-cli-coding-agent-architecture-study.md` sections 25, 29, and 30; existing `docs/superpowers/plans/2026-09-20-runtime-events-ink-cli.md`.

## Global Constraints

- Trace data is metadata-only: never retain prompt text, model output, tool inputs, tool outputs, file contents, environment values, or credentials.
- Keep the existing Hook error policy: observer failures are retained for diagnostics and never fail an agent run; an aborted signal still propagates.
- Bound in-memory retention to at most 20 completed runs and 100 spans per run; dropped data must be represented by counters.
- Keep the CLI `--json`, pipe, `--once`, MCP-server, and existing Desktop SSE contracts stable except for the additive trace endpoint and additive `:trace` command.
- Do not add an OpenTelemetry or network dependency in this slice.
- Preserve user changes and do not publish packages, create release tags, or make network releases.

---

### Task 1: Define the metadata-only trace model

**Files:**
- Create: `packages/agent-core/src/trace.ts`
- Modify: `packages/agent-core/src/hooks.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/tests/trace.test.ts`

**Interfaces:**
- Consumes: `AgentHookRegistry`, `AgentHookName`, and `ChatUsage`.
- Produces: `AgentRunTrace`, `AgentTraceSnapshot`, `AgentTraceRun`, and `AgentTraceSpan`.

- [x] **Step 1: Write failing trace tests**

Cover these exact behaviors:

```ts
test("records one run with model and tool spans from lifecycle hooks", async () => {
  const hooks = new AgentHookRegistry();
  const trace = new AgentRunTrace(hooks, { now: fixedClock() });

  await hooks.run("session.start", {
    sessionId: "session-1",
    runId: "run-1",
    occurredAt: "2026-09-20T10:00:00.000Z",
  });
  await hooks.run("before.model", {
    sessionId: "session-1",
    runId: "run-1",
    operationId: "model-1",
    turn: 1,
    occurredAt: "2026-09-20T10:00:00.010Z",
  });
  await hooks.run("after.model", {
    sessionId: "session-1",
    runId: "run-1",
    operationId: "model-1",
    turn: 1,
    status: "streaming",
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    occurredAt: "2026-09-20T10:00:00.030Z",
  });
  await hooks.run("before.tool", {
    sessionId: "session-1",
    runId: "run-1",
    operationId: "tool-1",
    turn: 1,
    toolName: "filesystem",
    occurredAt: "2026-09-20T10:00:00.040Z",
  });
  await hooks.run("after.tool", {
    sessionId: "session-1",
    runId: "run-1",
    operationId: "tool-1",
    turn: 1,
    toolName: "filesystem",
    status: "done",
    occurredAt: "2026-09-20T10:00:00.090Z",
  });
  await hooks.run("session.end", {
    sessionId: "session-1",
    runId: "run-1",
    status: "done",
    occurredAt: "2026-09-20T10:00:00.100Z",
  });

  assert.deepEqual(trace.snapshot().runs[0], {
    runId: "run-1",
    status: "completed",
    startedAt: "2026-09-20T10:00:00.000Z",
    completedAt: "2026-09-20T10:00:00.100Z",
    durationMs: 100,
    turns: 1,
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    spans: [
      {
        id: "model-1",
        kind: "model",
        status: "completed",
        startedAt: "2026-09-20T10:00:00.010Z",
        completedAt: "2026-09-20T10:00:00.030Z",
        durationMs: 20,
        turn: 1,
      },
      {
        id: "tool-1",
        kind: "tool",
        name: "filesystem",
        status: "completed",
        startedAt: "2026-09-20T10:00:00.040Z",
        completedAt: "2026-09-20T10:00:00.090Z",
        durationMs: 50,
        turn: 1,
      },
    ],
  });
});
```

Also assert that a 21st run evicts the oldest run and increments the bounded snapshot counter, and that a span snapshot contains no input/output summaries.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @dev-agent/agent-core test -- --test-name-pattern "trace"
```

Expected: the test fails because `AgentRunTrace` and the new hook metadata fields do not exist.

- [x] **Step 3: Add hook metadata and the bounded collector**

Extend `AgentHookContext` with optional `occurredAt`, `operationId`, and `usage` fields. Implement `AgentRunTrace` with:

```ts
new AgentRunTrace(hooks, {
  maxRuns?: number;
  maxSpansPerRun?: number;
  now?: () => Date;
});

snapshot(): AgentTraceSnapshot;
latest(): AgentTraceRun | undefined;
recordUsage(usage: ChatUsage, runId?: string): void;
dispose(): void;
```

Use hook registration handles for `dispose()`, clone snapshots on return, and store only allowlisted names/statuses/counts/timestamps/durations/usage.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same focused test command and confirm the trace model and bounds pass.

- [x] **Step 5: Run Agent Core regression tests**

Run:

```bash
pnpm --filter @dev-agent/agent-core build
pnpm --filter @dev-agent/agent-core test
```

Expected: the existing suite and the new trace tests pass.

### Task 2: Populate lifecycle metadata from AgentLoop

**Files:**
- Modify: `packages/agent-core/src/loop.ts`
- Test: `packages/agent-core/tests/runtime-events.test.ts`
- Test: `packages/agent-core/tests/hooks.test.ts`

**Interfaces:**
- Consumes: `AgentRunTrace`'s `occurredAt`, `operationId`, and `usage` fields.
- Produces: uniquely correlatable model/tool lifecycle hook calls for normal turns and max-turn finalization.

- [x] **Step 1: Write failing AgentLoop hook assertions**

Run a real `AgentLoop` with a deterministic model and tool, register observers for all six lifecycle hooks, and assert:

```ts
assert.equal(events[0]?.name, "session.start");
assert.equal(events[1]?.name, "before.model");
assert.equal(events[2]?.name, "after.model");
assert.equal(events[3]?.name, "before.tool");
assert.equal(events[4]?.name, "after.tool");
assert.equal(events.at(-1)?.name, "session.end");
assert.match(events[1]?.context.operationId ?? "", /^model-/);
assert.equal(events[1]?.context.operationId, events[2]?.context.operationId);
assert.equal(events[3]?.context.operationId, events[4]?.context.operationId);
assert.equal(events[2]?.context.usage?.totalTokens, 6);
assert.ok(events.every((event) => event.context.occurredAt));
```

Add a finalization case that proves the no-tools final model call also emits `before.model` and `after.model`.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @dev-agent/agent-core test -- --test-name-pattern "operationId|finalization|lifecycle"
```

Expected: the assertions fail because the loop currently does not populate operation IDs, timestamps, or usage in hook contexts.

- [x] **Step 3: Add deterministic hook metadata**

Generate one operation ID per model call and use `call.id` for tool spans. Pass the completion usage to `after.model`, add timestamps at each lifecycle boundary, and wrap `finalizeAfterMaxTurns` with the same model hooks. Keep the existing abort/error semantics unchanged.

- [x] **Step 4: Run focused and full Agent Core tests**

Run the focused command, then:

```bash
pnpm --filter @dev-agent/agent-core test
```

Expected: all lifecycle assertions and existing tests pass.

### Task 3: Connect Hooks and traces to CLI and Desktop

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/desktop/src/chat-session.ts`
- Test: `apps/cli/tests/interactive.test.ts`
- Test: `apps/desktop/tests/chat-session-e2e.test.ts`
- Test: `apps/desktop/tests/runtime-event-adapter.test.ts`

**Interfaces:**
- Consumes: `AgentHookRegistry`, `AgentRunTrace`, and `AgentTraceSnapshot`.
- Produces: one bounded trace per CLI/Desktop session, with usage collected from
  the authoritative `after.model` Hook metadata and hooks passed into every
  `AgentLoop`. `recordUsage()` remains available as an escape hatch for
  adapters that receive usage outside AgentLoop.

- [x] **Step 1: Write failing integration tests**

Assert that a CLI interactive session accepts `:trace` after a completed prompt and prints run status, model/tool span counts, and token totals without echoing prompt/output text. Assert that `ChatSession.getTraceSnapshot()` returns the same metadata-only shape after a run.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @dev-agent/cli test -- --test-name-pattern ":trace|trace"
pnpm --filter @dev-agent/desktop test -- --test-name-pattern "trace"
```

Expected: the command/getter is missing and the tests fail.

- [x] **Step 3: Wire one registry and collector per session**

Create the registry and trace beside each session's memory/context, pass
`hooks` to `AgentLoop`, and let the loop's `after.model` Hook provide the
authoritative usage metadata. Keep `trace.recordUsage(usage)` as an escape
hatch for adapters that receive usage outside AgentLoop. Add
`getTraceSnapshot()` to `ChatSession`; do not persist trace data to session
memory.

- [x] **Step 4: Add the CLI trace command**

Add `:trace` and `/trace` to the shared command hints. In ANSI and Ink command handling, render a compact summary from the trace snapshot:

```text
Run run-...  completed  120ms  turns=1
  model 1 span(s)  tool 2 span(s)  tokens=prompt:4 completion:2 total:6
```

Use `safeTerminalText` and never render prompt/output summaries.

- [x] **Step 5: Run focused CLI/Desktop tests**

Run the focused commands again and confirm both application adapters pass.

### Task 4: Expose a read-only Desktop trace endpoint

**Files:**
- Modify: `apps/desktop/src/server.ts`
- Modify: `apps/desktop/src/index.ts`
- Test: `apps/desktop/tests/server.test.ts`

**Interfaces:**
- Consumes: optional `DesktopChatSession.getTraceSnapshot()` and `AgentTraceSnapshot`.
- Produces: `GET /api/sessions/<sessionId>/trace`, returning only the bounded metadata snapshot or a stable `trace_unavailable` error for injected legacy fakes.

- [x] **Step 1: Write the failing endpoint test**

Start the existing test server with a session fake that exposes `getTraceSnapshot()`, request `/api/sessions/default/trace`, and assert `200`, `metadataOnly: true`, bounded run/span metadata, and absence of prompt/output/path/secret-shaped text. Add a legacy fake case that returns `404` with `{ "error": "trace unavailable" }`.

- [x] **Step 2: Run the focused server test and verify RED**

Run:

```bash
pnpm --filter @dev-agent/desktop test -- --test-name-pattern "trace endpoint"
```

Expected: the route is not found or the fake method is not part of the server interface.

- [x] **Step 3: Add the additive route and interface method**

Decode and normalize the session ID using the existing helpers, resolve the session, call `getTraceSnapshot()`, and return JSON with `cache-control: no-store`. Do not add trace data to existing history, evidence, or SSE payloads.

- [x] **Step 4: Run the full Desktop suite**

Run:

```bash
pnpm --filter @dev-agent/desktop build
pnpm --filter @dev-agent/desktop test
```

Expected: all existing Desktop contracts and the new endpoint test pass.

### Task 5: Document and verify the integration

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/README.md`
- Modify: `task_plan.md`
- Modify: `progress.md`
- Create: `docs/trace-observability.md`

**Interfaces:**
- Consumes: the completed Hook, trace, CLI command, and Desktop endpoint contracts.
- Produces: user-facing documentation and repository evidence for the completed Gemini-inspired phase.

- [x] **Step 1: Document the bounded trace contract**

Explain lifecycle Hooks, the metadata-only fields, retention bounds, CLI `:trace`, and Desktop `/api/sessions/<id>/trace`. Explicitly state that this slice does not publish or send telemetry to a remote service.

- [x] **Step 2: Update the execution records**

Add a completed Phase 10 entry to `task_plan.md`, link the new plan/spec from `docs/README.md`, and append dated progress evidence for the focused and full test gates.

- [x] **Step 3: Run repository verification**

Run:

```bash
pnpm verify:typescript
pnpm test:evals
git diff --check
```

Expected: the TypeScript release gate, rich CLI behavior evaluations, and whitespace checks pass without a package publish or release operation.

- [x] **Step 4: Review the final diff**

Run:

```bash
git status --short
git diff --stat
rg -n "prompt|output|workingDirectory|apiKey|secret|token" packages/agent-core/src/trace.ts apps/desktop/src/server.ts apps/cli/src/index.ts
```

Confirm that trace output uses only the allowlisted metadata and that no unrelated user changes were reverted.
