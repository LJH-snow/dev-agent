# Runtime Events and Ink CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared runtime event protocol, behavior evaluations, checkpoint metadata, Skills, Hooks, richer tool metadata, and an Ink-based rich CLI while preserving existing non-rich contracts.

**Architecture:** Additive migration. `@dev-agent/runtime-events` defines versioned event envelopes; AgentLoop emits events beside its existing callbacks; CLI and Desktop consume adapters; the rich TTY path moves to Ink 6/React 19 while `--once`, pipes, JSON, and MCP server paths remain line-oriented. FileMemory stores checkpoint metadata and existing change-set evidence remains the only authority for guarded workspace rollback.

**Tech Stack:** TypeScript, Node.js 20+, pnpm workspaces, Ink 6.8.0, React 19, Node test runner, PTY/`expect`, existing AgentLoop/FileMemory/Executor/MCP packages.

**Spec:** `docs/superpowers/specs/2026-09-20-runtime-events-and-ink-cli-design.md`

## Global Constraints

- Keep Node engine support at `>=20`; do not upgrade the CLI to Ink 7 because its current engine floor is Node 22.
- Preserve line-oriented behavior for `--once`, `--json`, pipes, and `--mcp-server`.
- Do not put terminal escape sequences or React imports in `packages/agent-core`.
- Approval metadata may inform policy and rendering but cannot bypass the existing approval decision.
- Checkpoint restore must not silently change workspace files.
- Every production behavior change requires a test written and observed failing first.
- Do not publish npm packages, create a release, or upload artifacts.

---

### Task 1: Add the architecture records

**Files:**
- Create: `docs/superpowers/specs/2026-09-20-runtime-events-and-ink-cli-design.md`
- Create: `docs/superpowers/plans/2026-09-20-runtime-events-ink-cli.md`
- Modify: `docs/README.md`
- Modify: `task_plan.md`

**Interfaces:**
- Produces the approved design and executable task order used by all later tasks.

- [x] **Step 1: Record the design and plan**

  Add the design and plan documents with the shared event, Ink migration,
  evaluation, checkpoint, Skills, Hooks, tool metadata, and deferred protocol
  phases.

- [ ] **Step 2: Link the records from the documentation index**

  Add the design and plan to the current execution-plan list in
  `docs/README.md` and add a new active phase to `task_plan.md` without
  changing historical verification records.

- [ ] **Step 3: Validate the documents**

  Run:

  ```bash
  rg -n 'TBD|TODO|placeholder' docs/superpowers/specs/2026-09-20-runtime-events-and-ink-cli-design.md docs/superpowers/plans/2026-09-20-runtime-events-ink-cli.md
  git diff --check
  ```

  Expected: no forbidden placeholder markers and no whitespace errors.

---

### Task 2: Create the shared runtime-events package

**Files:**
- Create: `packages/runtime-events/package.json`
- Create: `packages/runtime-events/tsconfig.json`
- Create: `packages/runtime-events/src/index.ts`
- Create: `packages/runtime-events/tests/events.test.ts`
- Modify: `packages/agent-core/package.json`
- Modify: `apps/cli/package.json`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Produces `RuntimeEvent`, `RuntimeEventType`, event payload types,
  `RuntimeEventSink`, `createRuntimeEvent`, and `RuntimeEventSequence`.
- Consumes only TypeScript/Node standard types; it must not depend on CLI,
  Desktop, React, Ink, or tools.

- [ ] **Step 1: Write failing event contract tests**

  Add tests that assert:

  ```ts
  const sequence = new RuntimeEventSequence("session-1");
  const event = sequence.create("run.started", {
    runId: "run-1",
    prompt: "hello",
  });

  assert.deepEqual(
    [event.version, event.sequence, event.sessionId, event.type],
    [1, 1, "session-1", "run.started"],
  );
  ```

  Also test that payloads for `input.queued`, `tool.approval-requested`,
  `run.interrupted`, and `run.failed` remain distinguishable.

- [ ] **Step 2: Run the focused test and verify the expected failure**

  Run:

  ```bash
  pnpm --filter @dev-agent/runtime-events test
  ```

  Expected: the package or exported types are missing.

- [ ] **Step 3: Implement the minimal package**

  Define the discriminated union and sequence helper. `createRuntimeEvent`
  must copy payload objects, assign an ISO timestamp, and never accept a caller
  supplied sequence number.

- [ ] **Step 4: Run the focused test**

  Run the same command and expect all event contract tests to pass.

- [ ] **Step 5: Build the workspace package**

  Run:

  ```bash
  pnpm --filter @dev-agent/runtime-events build
  ```

  Expected: declarations and JavaScript are emitted under `dist/`.

---

### Task 3: Emit runtime events from AgentLoop

**Files:**
- Modify: `packages/agent-core/src/loop.ts`
- Modify: `packages/agent-core/src/index.ts`
- Create: `packages/agent-core/tests/runtime-events.test.ts`

**Interfaces:**
- Consumes `RuntimeEvent`, `RuntimeEventSequence`, and `RuntimeEventSink`.
- Produces optional `eventSink` support on `AgentLoopOptions`.
- Existing callback behavior remains unchanged.

- [ ] **Step 1: Write failing AgentLoop event tests**

  Build a deterministic provider and registry. Assert the event order:

  ```text
  run.started
  assistant.delta
  tool.started
  tool.completed
  assistant.completed
  run.completed
  ```

  Add cases for approval waiting, abort, provider error, and repeated tool
  failure. Verify every event has one session id and strictly increasing
  sequence numbers.

- [ ] **Step 2: Run the focused Agent Core tests**

  Run:

  ```bash
  pnpm --filter @dev-agent/agent-core test
  ```

  Expected: the new event tests fail because no event sink exists.

- [ ] **Step 3: Add the optional event sink**

  Add an `eventSink?: RuntimeEventSink` option and emit:

  - `run.started` before the first model call;
  - `run.status` for thinking, streaming, tool-running, waiting-approval,
    validating, and ready/error/interrupted transitions;
  - `assistant.delta` for streamed tokens;
  - `tool.started`, `tool.progress`, `tool.approval-requested`,
    `tool.approval-resolved`, `tool.completed`, and `tool.failed`;
  - `validation.started` and `validation.completed`;
  - exactly one terminal event.

  The sink must be observational: a sink error is caught and cannot change the
  model result.

- [ ] **Step 4: Run the focused and existing Agent Core tests**

  Run:

  ```bash
  pnpm --filter @dev-agent/agent-core test
  ```

  Expected: the new and existing tests pass.

---

### Task 4: Unify CLI and Desktop event adapters

**Files:**
- Modify: `apps/cli/src/tui-session.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/desktop/src/chat-session.ts`
- Modify: `apps/desktop/src/server.ts`
- Create: `apps/cli/tests/runtime-event-adapter.test.ts`
- Create: `apps/desktop/tests/runtime-event-adapter.test.ts`

**Interfaces:**
- `TuiSessionModel` consumes `RuntimeEvent`.
- Desktop `StreamEvent` is a transport projection of `RuntimeEvent`.
- CLI queue emits `input.submitted` and `input.queued`.

- [ ] **Step 1: Write failing adapter tests**

  Assert that the same sequence of shared events produces:

  - one CLI transcript prompt, one assistant block, and one completed tool
    card;
  - one Desktop SSE event per shared event with the same `runId`;
  - queued input does not create a second active run.

- [ ] **Step 2: Run focused adapter tests**

  Run:

  ```bash
  pnpm --filter @agent_cli/cli test -- tui-session
  pnpm --filter @agent_cli/desktop test
  ```

  Expected: new adapter assertions fail until the projections consume the
  shared event shape.

- [ ] **Step 3: Add projections without removing compatibility types**

  Add `applyRuntimeEvent()` to the CLI session model and a Desktop mapping
  function. Keep legacy callback adapters in place until the Ink migration is
  green.

- [ ] **Step 4: Run the focused suites**

  Run the commands from Step 2 and expect green results.

---

### Task 5: Add root behavior evaluations

**Files:**
- Create: `evals/README.md`
- Create: `evals/cli-rich-tui.evals.mjs`
- Create: `evals/helpers/pty.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `pnpm test:evals`.
- Launches the built CLI through a PTY and checks user-visible transcript
  invariants instead of importing renderer internals.

- [ ] **Step 1: Write the failing queue and transcript evaluations**

  Cover two prompts submitted during a streaming run, exact provider request
  order, one occurrence of each answer, and no duplicated prompt/footer.

- [ ] **Step 2: Run the evaluations before the Ink migration**

  Run:

  ```bash
  pnpm build
  pnpm test:evals
  ```

  Expected: the new evaluator either passes the existing ANSI path or exposes
  the exact baseline differences that the Ink renderer must preserve.

- [ ] **Step 3: Add interruption, approval, resize, and EOF cases**

  Use the existing deterministic provider fixtures and PTY helper. Assert
  Ctrl-C, Escape, visible `^C`, EOF, narrow width, and approval resolution.

- [ ] **Step 4: Run the full evaluation matrix**

  Run `pnpm test:evals` and require all cases to pass before switching the
  default renderer.

---

### Task 6: Add FileMemory-backed checkpoints

**Files:**
- Create: `packages/agent-core/src/checkpoint.ts`
- Modify: `packages/agent-core/src/memory.ts`
- Modify: `packages/agent-core/src/index.ts`
- Create: `packages/agent-core/tests/checkpoint.test.ts`

**Interfaces:**
- Produces `AgentCheckpoint`, `CheckpointStore`,
  `FileMemoryCheckpointStore`, and `CheckpointRestoreResult`.
- Consumes `AgentContext`, `FileMemory`, and persisted change-set evidence.

- [ ] **Step 1: Write failing checkpoint tests**

  Create two memory entries and one applied change-set record. Assert that
  `create()` stores the session id, last entry id, entry count, and change-set
  id; `list()` and `inspect()` restore the same metadata after reopening the
  memory file.

- [ ] **Step 2: Run the focused test**

  Run:

  ```bash
  pnpm --filter @dev-agent/agent-core test
  ```

  Expected: checkpoint symbols and persistence fields are missing.

- [ ] **Step 3: Implement metadata-only restore**

  Persist a bounded `checkpoints` array in the existing memory envelope. Use
  the current serialized file limit and retention policy. `restore()` returns
  the memory anchor and referenced evidence ids; it must not call filesystem
  rollback.

- [ ] **Step 4: Run Agent Core tests**

  Run `pnpm --filter @dev-agent/agent-core test` and require memory,
  evidence, and checkpoint tests to pass.

---

### Task 7: Add Skills and Hooks

**Files:**
- Create: `packages/agent-core/src/skills.ts`
- Create: `packages/agent-core/src/hooks.ts`
- Modify: `packages/agent-core/src/loop.ts`
- Modify: `packages/agent-core/src/index.ts`
- Create: `packages/agent-core/tests/skills.test.ts`
- Create: `packages/agent-core/tests/hooks.test.ts`

**Interfaces:**
- Produces `SkillRegistry`, `SkillDefinition`, `AgentHookRegistry`,
  `AgentHookName`, and hook execution helpers.
- Consumes the existing `systemPromptProvider`, `AgentToolRegistry`, and
  runtime event sink.

- [ ] **Step 1: Write failing Skills tests**

  Create a temporary `.dev-agent/skills/review/SKILL.md`. Assert project-local
  loading, description parsing, fixed instruction-size limits, and on-demand
  activation without changing persisted user messages.

- [ ] **Step 2: Write failing Hooks tests**

  Register `before.model`, `after.model`, `before.tool`, `after.tool`,
  `session.start`, and `session.end` observers. Assert deterministic order,
  abort propagation, and that a thrown observer error is recorded but does not
  change a successful run.

- [ ] **Step 3: Implement bounded registries**

  Resolve project skills before user skills. Use explicit hook registration
  and removal handles. Pass sanitized event context and never expose raw
  credentials or full tool output to hooks.

- [ ] **Step 4: Run focused Agent Core tests**

  Run:

  ```bash
  pnpm --filter @dev-agent/agent-core test
  ```

  Expected: all Skills, Hooks, loop, memory, and approval tests pass.

---

### Task 8: Add risk, confirmation, and result metadata to tools

**Files:**
- Modify: `packages/agent-core/src/tools.ts`
- Modify: `packages/tools/src/create-default-tools.ts`
- Modify: `packages/tools/src/filesystem.ts`
- Modify: `packages/tools/src/shell.ts`
- Modify: `packages/tools/src/git.ts`
- Modify: `packages/tools/src/search.ts`
- Modify: `packages/tools/src/code-search.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/desktop/src/chat-session.ts`
- Create: `packages/agent-core/tests/tool-metadata.test.ts`

**Interfaces:**
- Extends `AgentTool` with `metadata?: AgentToolMetadata`.
- Existing consumers remain valid because metadata is optional.
- Policy and renderers can read normalized metadata through the registry.

- [ ] **Step 1: Write failing metadata tests**

  Assert default metadata for every built-in tool and explicit overrides for
  filesystem mutation, shell execution, and read-only search. Assert that
  metadata never changes an approval decision without a policy result.

- [ ] **Step 2: Run the focused test**

  Run:

  ```bash
  pnpm --filter @dev-agent/agent-core test
  pnpm --filter @dev-agent/tools test
  ```

  Expected: metadata fields are absent or not normalized.

- [ ] **Step 3: Implement metadata defaults and registry access**

  Add `risk`, `confirmation`, `resultFormat`, and `supportsProgress`. Keep the
  existing dangerous-pattern and reviewed-write policy authoritative.

- [ ] **Step 4: Run the focused suites**

  Run the commands from Step 2 and require all tool and approval tests to pass.

---

### Task 9: Install the compatible Ink toolchain

**Files:**
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/tsconfig.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Adds Ink 6.8.0, React 19, and matching React types only to the CLI package.
- Keeps the workspace Node floor at 20.

- [ ] **Step 1: Add the dependency contract test**

  Extend the CLI package-manifest test to assert that interactive rendering
  depends on Ink 6 and React 19 while the package engine remains `>=20`.

- [ ] **Step 2: Run the manifest test and verify the expected failure**

  Run:

  ```bash
  pnpm --filter @agent_cli/cli test -- package-manifest
  ```

  Expected: the new dependency assertions fail before installation.

- [ ] **Step 3: Install dependencies and enable JSX**

  Add `ink@6.8.0`, `react@19`, and `@types/react@19`; set the CLI compiler
  `jsx` option to `react-jsx`. Do not add Ink to core packages.

- [ ] **Step 4: Run build and manifest tests**

  Run:

  ```bash
  pnpm --filter @agent_cli/cli build
  pnpm --filter @agent_cli/cli test -- package-manifest
  ```

  Expected: the package builds and the compatibility contract passes.

---

### Task 10: Implement the Ink renderer and composer

**Files:**
- Create: `apps/cli/src/ink/app.tsx`
- Create: `apps/cli/src/ink/composer.tsx`
- Create: `apps/cli/src/ink/transcript.tsx`
- Create: `apps/cli/src/ink/status-bar.tsx`
- Create: `apps/cli/src/ink/tool-card.tsx`
- Create: `apps/cli/src/ink/welcome.tsx`
- Create: `apps/cli/src/ink/terminal-adapter.ts`
- Modify: `apps/cli/src/index.ts`
- Create: `apps/cli/tests/ink-renderer.test.ts`
- Create: `apps/cli/tests/ink-composer.test.ts`

**Interfaces:**
- `InkCliApp` receives runtime events, queue state, command hints, approval
  callbacks, and footer metadata.
- `InkComposer` emits submitted strings and queue events through callbacks.
- `terminal-adapter.ts` owns stdin/stdout lifecycle and Ink render/unmount.

- [ ] **Step 1: Write failing component behavior tests**

  Assert that rendering a fixed event transcript includes the Signal Loom mark,
  runtime summary, blue composer frame, one cursor marker, working-directory
  footer, queued prompt, tool card, and approval state.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

  Run:

  ```bash
  pnpm --filter @agent_cli/cli test -- ink-renderer ink-composer
  ```

  Expected: the Ink modules and components do not exist.

- [ ] **Step 3: Implement the static transcript components**

  Use Ink `Box`, `Text`, `useInput`, and `useApp`. Keep colors and spacing
  centralized. Render the existing Signal Loom mark as text/ANSI-safe output;
  do not add a remote image dependency.

- [ ] **Step 4: Implement the composer state machine**

  Support multiline text, cursor movement, history, command completion,
  queued prompts, submission, Ctrl-C, Escape, visible `^C`, EOF, and terminal
  width changes. Only the active composer owns the cursor.

- [ ] **Step 5: Connect the app to the shared event projection**

  Replace the rich TTY path's direct ANSI writes with the Ink adapter. Keep
  the old `RichInputController` available behind `DEV_AGENT_TUI=ansi` until
  the behavior evaluations pass.

- [ ] **Step 6: Run focused CLI tests**

  Run:

  ```bash
  pnpm --filter @agent_cli/cli test -- tui-session tui-input tui-renderer ink-renderer ink-composer
  ```

  Expected: all existing queue/cursor contracts and new Ink contracts pass.

---

### Task 11: Switch rich TTY mode and run behavior evaluations

**Files:**
- Modify: `apps/cli/src/tui-mode.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `evals/cli-rich-tui.evals.mjs`
- Modify: `apps/cli/tests/interactive.test.ts`

**Interfaces:**
- Interactive TTY defaults to Ink.
- `DEV_AGENT_TUI=ansi` selects the compatibility renderer.
- Non-rich modes remain unchanged.

- [ ] **Step 1: Add a failing default-selection test**

  Assert that a TTY invocation selects Ink by default and that pipes, JSON,
  `--once`, and MCP server mode select the existing non-rich path.

- [ ] **Step 2: Run the mode tests**

  Run:

  ```bash
  pnpm --filter @agent_cli/cli test -- tui-mode
  ```

  Expected: the rich path still selects the ANSI renderer.

- [ ] **Step 3: Change only the rich TTY selection**

  Route rich TTY startup through `terminal-adapter.ts`, keep command handling
  and AgentLoop wiring unchanged, and retain the ANSI override.

- [ ] **Step 4: Run all evaluations**

  Run:

  ```bash
  pnpm build
  pnpm test:evals
  pnpm --filter @agent_cli/cli test
  ```

  Expected: queue ordering, prompt ownership, approvals, interruptions,
  resize, EOF, and no-duplicate-frame assertions pass.

---

### Task 12: Document and verify the migration

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/README.md`
- Modify: `apps/cli/README.md`
- Modify: `task_plan.md`
- Modify: `progress.md`

**Interfaces:**
- Documents the shared event package, Ink default, ANSI fallback, eval gate,
  checkpoint semantics, Skills/Hooks boundaries, and deferred phases.

- [ ] **Step 1: Update architecture and user-facing CLI documentation**

  Document the new event flow and the exact environment variable for the ANSI
  fallback. Explicitly state that non-rich contracts are unchanged.

- [ ] **Step 2: Run package and workspace verification**

  Run:

  ```bash
  pnpm build
  pnpm test:evals
  pnpm verify
  git diff --check
  ```

  Expected: all TypeScript, Rust, CLI, Desktop, behavior, and documentation
  gates pass.

- [ ] **Step 3: Review the final diff**

  Run:

  ```bash
  git status --short
  git diff --stat
  git diff -- docs/superpowers/specs/2026-09-20-runtime-events-and-ink-cli-design.md docs/superpowers/plans/2026-09-20-runtime-events-ink-cli.md
  ```

  Confirm that no unrelated user changes are staged or modified and that no
  package publish or release command was executed.
