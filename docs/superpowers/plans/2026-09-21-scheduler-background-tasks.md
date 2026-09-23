# Scheduler Background Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded local task scheduler with explicit lifecycle states, cancellation, and a read-only `:tasks` inspection command while preserving the current single-session prompt queue.

**Architecture:** Agent Core owns a small scheduler that accepts caller-owned async work, limits concurrency, exposes metadata-only task snapshots, and never persists prompt contents or task results. The CLI uses one scheduler per interactive session with concurrency one, so the existing Ink/ANSI prompt queue remains the source of input ordering while each consumed prompt receives a stable task lifecycle.

**Tech Stack:** TypeScript, Node.js `AbortController`, Agent Core, CLI command adapters, Ink/ANSI shared command hints, Node test runner.

**Spec:** `docs/geminicli/gemini-cli-coding-agent-architecture-study.md`, section 28 “Scheduler / Background Tasks”, plus the existing Runtime Events and queue behavior contracts.

## Global Constraints

- Task snapshots expose only ids, lifecycle status, timestamps, and bounded safe detail; never expose prompt text, model output, tool arguments, filesystem paths, environment values, or credentials.
- The scheduler is local and in-process; it does not create detached processes, network jobs, persistent background services, or cross-session work.
- Default concurrency is `1`; the interactive CLI must keep concurrency `1` so prompt ownership and streamed answers remain ordered.
- Retain at most `64` task snapshots by default; prune the oldest terminal snapshots before removing active tasks.
- Cancellation must abort queued work without invoking its runner and must forward an abort signal to running work.
- Existing JSON, pipe, `--once`, MCP, approval, checkpoint, extension, and prompt-queue behavior must remain unchanged.
- Do not publish packages, create tags, or perform network release operations.

---

### Task 1: Implement and test the bounded Agent Core scheduler

**Files:**
- Create: `packages/agent-core/src/scheduler.ts`
- Create: `packages/agent-core/tests/scheduler.test.ts`
- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**
- Produces `AgentTaskScheduler`, `AgentTaskSnapshot`, `AgentTaskStatus`,
  `AgentTaskExecutionContext`, and `AgentTaskCancelledError`.
- `new AgentTaskScheduler(options?)` accepts optional `concurrency`, `maxRetained`,
  `now`, and `idFactory`.
- `schedule<T>({ id?, run })` returns `Promise<T>`, queues work, and passes
  `{ signal, setStatus }` to the runner.
- `list()` returns deterministic snapshots ordered by creation sequence.
- `get(id)` returns one immutable metadata snapshot or `undefined`.
- `cancel(id, reason?)` returns `true` only when a queued or active task was
  cancelled; terminal tasks return `false`.

- [x] **Step 1: Write the failing scheduler tests**

```ts
test("runs one task at a time and keeps later work queued", async () => {
  const scheduler = new AgentTaskScheduler({ concurrency: 1 });
  const release: Array<() => void> = [];
  const first = scheduler.schedule({
    id: "task-1",
    run: async () => new Promise<string>((resolve) => release.push(() => resolve("one"))),
  });
  const second = scheduler.schedule({
    id: "task-2",
    run: async () => "two",
  });

  assert.deepEqual(scheduler.list().map((task) => task.status), ["running", "queued"]);
  release.shift()?.();
  assert.equal(await first, "one");
  assert.equal(await second, "two");
  assert.deepEqual(scheduler.list().map((task) => task.status), ["completed", "completed"]);
});
```

Also cover waiting-for-confirmation to running transitions, queued cancellation
without invoking the runner, running cancellation through `AbortSignal`,
bounded terminal retention, duplicate ids, invalid concurrency, and the
metadata-only snapshot invariant.

- [x] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter @dev-agent/agent-core exec tsc -p tsconfig.test.json
node --test --test-concurrency=1 packages/agent-core/tests-dist/scheduler.test.js
```

Expected: compilation or runtime failure because `scheduler.ts` and the
exported scheduler API do not exist yet.

- [x] **Step 3: Implement the minimal scheduler**

Use an in-memory FIFO queue and a bounded active-task map. Start work only
while `activeCount < concurrency`; transition snapshots in this order:

```text
queued -> running -> waiting-for-confirmation -> running -> completed
                                      └───────> failed/cancelled
queued ────────────────────────────────────────> cancelled
running ───────────────────────────────────────> cancelled
```

Generate ids as `task-<counter>` when the caller omits one. Reject duplicate
ids and invalid positive-integer limits. Let runner failures reject the
returned promise while recording only a stable `failed` status and bounded
detail. On cancellation, abort the runner and reject with
`AgentTaskCancelledError`; a runner that later settles must not overwrite the
cancelled snapshot.

- [x] **Step 4: Run the focused test to verify it passes**

Run the same focused commands and expect all scheduler tests to pass.

- [x] **Step 5: Export the API and run the full core suite**

Run:

```bash
pnpm --filter @dev-agent/agent-core build
pnpm --filter @dev-agent/agent-core test
```

Expected: the full Agent Core suite and the new scheduler tests pass.

### Task 2: Add the CLI task inspection command

**Files:**
- Create: `apps/cli/src/task-command.ts`
- Create: `apps/cli/tests/task-command.test.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/tui-renderer.ts`

**Interfaces:**
- `executeTaskCommand(command, scheduler)` handles `:tasks`,
  `:task <id>`, `/tasks`, and `/task <id>`.
- `formatTaskCommandResult(result)` returns bounded human-readable output.
- List output includes id, status, and safe lifecycle timing only.
- Inspect output includes one task or a stable unknown-task message; it never
  prints task input, output, or runner detail beyond the bounded safe detail.

- [x] **Step 1: Write the failing command tests**

Test list output, inspect output, slash aliases, usage, unknown ids, and the
invariant that output cannot contain a prompt, an absolute path, or a raw
runner error.

- [x] **Step 2: Run the focused command test to verify it fails**

Run:

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json
node --test --test-concurrency=1 apps/cli/tests-dist/task-command.test.js
```

Expected: the command module and formatter functions are missing.

- [x] **Step 3: Implement and wire the command adapter**

Keep parsing and formatting outside Agent Core. Add the two commands to
`DEFAULT_COMMAND_HINTS`, load one scheduler per interactive session, and route
the command before model prompts in both ANSI and Ink paths. Command notices
must not enter conversation memory or the provider.

- [x] **Step 4: Run focused CLI tests**

Run the task-command tests and the existing renderer, interactive, Ink, and
queue tests. Expected: current prompt/answer ownership and cursor behavior
remain unchanged.

### Task 3: Attach scheduler lifecycle to interactive runs

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/ink/runtime-store.ts` only if a task notice requires
  a renderer snapshot update
- Modify: `apps/cli/tests/interactive.test.ts`
- Modify: `apps/cli/tests/ink-app.test.ts` only if the existing harness needs
  an explicit task assertion

**Interfaces:**
- `InteractiveUiOptions` receives one `AgentTaskScheduler`.
- Each normal interactive prompt is scheduled with a safe static label and
  concurrency-one semantics.
- The scheduler receives the same abort signal used by Ctrl-C/Escape and
  records cancellation or failure without changing the existing visible
  response path.

- [x] **Step 1: Add a failing interactive lifecycle regression**

Exercise two prompts in the existing interactive harness and assert that the
task snapshots end in creation order with separate terminal statuses. Add a
second case that queues input during an active run and verifies that the
queued prompt does not start until the first task reaches a terminal state.

- [x] **Step 2: Run the focused regression to verify it fails**

Run:

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json
node --test --test-concurrency=1 apps/cli/tests-dist/interactive.test.js
```

Expected: the test cannot observe scheduler task snapshots because the
interactive runner is not yet connected to the scheduler.

- [x] **Step 3: Connect the scheduler without moving queue ownership**

Create the scheduler during interactive setup, wrap only the existing
`runPrompt`/`loop.run` call, and keep `InkUiController`/`RichPromptQueue` as the
input queue. Do not read stdin from the scheduler and do not render duplicate
prompt frames. On `waiting-approval`, update the task status only through the
existing approval boundary; on completion, failure, or cancellation let the
existing runtime event and renderer paths remain authoritative.

- [x] **Step 4: Run focused interactive and behavior tests**

Run:

```bash
pnpm --filter @agent_cli/cli test
pnpm test:evals
```

Expected: all CLI tests and rich behavior evaluations pass, including queue,
streaming, approval, Ctrl-C, resize, EOF, and command-panel cases.

### Task 4: Document and verify the scheduler boundary

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/README.md`
- Modify: `task_plan.md`
- Modify: `progress.md`

- [x] **Step 1: Document lifecycle, cancellation, and non-persistence**

Describe the local scheduler, `:tasks` commands, default concurrency-one
interactive behavior, 64-entry retention, and the explicit deferral of
detached background services or cross-session jobs.

- [x] **Step 2: Add the next phase checklist and verification record**

Record the scheduler focused tests, CLI suite, behavior evaluations, fixed
TypeScript gate, and `git diff --check` with the applicable date
`2026-09-21`.

- [x] **Step 3: Run complete gates**

Run:

```bash
pnpm --filter @dev-agent/agent-core test
pnpm --filter @agent_cli/cli test
pnpm test:evals
pnpm verify:typescript
git diff --check
```

Expected: all existing and new tests pass; no package is published.

## Verification

Completed on 2026-09-21:

- Agent Core full suite: **167/167**.
- CLI full suite: **439/439**.
- Desktop full suite: **143/143**.
- Tools full suite: **152/152**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed, including workspace build and typecheck,
  package-install smoke, release-boundary contracts, documentation contracts,
  and native Desktop bundle contracts.
- `git diff --check` passed.
- Fixed the context-attachment test contract, bounded directory traversal
  handle lifecycle, and Ink command-palette regression discovered by the gate.
- No npm publish, tag, release, or network package operation was performed.
