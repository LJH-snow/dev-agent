# Desktop Message Queue and Turn Isolation

- **Status:** complete
- **Date:** 2026-09-22
- **Owner:** Signal Loom / Dev Agent
- **Related phase:** Phase 29
- **Primary surface:** `apps/desktop` local web workbench

## Goal

Close the remaining Desktop interaction gap identified after the Rich TUI
queue work:

- A prompt submitted while another prompt is running must enter a visible
  FIFO waiting queue instead of being ignored or sent concurrently.
- The next prompt must start automatically only after the current run reaches a
  terminal result.
- Every prompt, reasoning block, tool card, approval request, validation
  result, error, and assistant answer must remain inside its own conversation
  turn.
- Reconnect, session switching, history hydration, and run replay must not
  duplicate a turn, attach output to the next prompt, or replay an old answer
  into a new response region.

This phase makes the Desktop interaction model consistent with the already
verified Rich TUI queue semantics while preserving the server's existing
single-flight safety boundary.

## Current Evidence

The current Desktop client has these concrete behaviors:

- `apps/desktop/public/index.html` returns early when
  `activeChatSessionId !== null`, so a second submitted prompt is discarded
  instead of queued.
- The server intentionally rejects concurrent requests for one session with
  HTTP `409`; this is a useful safety backstop but is not a user-facing queue.
- `currentAssistant`, `currentReasoning`, and `currentToolProgress` are
  page-level mutable references rather than turn-owned state.
- `loadHistory()` reconstructs a flat sequence of user, assistant, and tool
  nodes, and `restoreRunSnapshot()` appends live fragments into the same
  global references.
- Run replay already exposes a bounded `runId`, monotonic `sequence`, and
  sanitized event list through `apps/desktop/src/run-state.ts`; the client
  does not yet use that sequence as a complete idempotency boundary.
- Existing Desktop tests cover session isolation, background run reconnect,
  manual scroll preservation, approvals, validation, and fixed port lifecycle,
  but they do not cover queued Desktop prompts or turn-local rendering.

## Architecture

### Browser-owned queue

The first implementation keeps the queue in the Desktop browser session. The
server continues to allow only one active run per session, and its `409`
response remains a fail-closed race detector rather than a normal queue path.

Each session owns a bounded queue state:

```text
sessionId
  ├── active request: { requestId, turnId, controller }
  ├── queued prompts: [{ queueId, message, turnId, state }]
  └── queue mode: idle | running | waiting-approval | paused | failed
```

Queue limits are fixed and local:

- at most 32 waiting prompts per session;
- each waiting prompt is limited to 16 KiB after trimming;
- the queue is not persisted across a full page reload;
- switching sessions preserves in-memory queues but never sends a hidden
  session's next prompt while another session is visible.

When the queue is full, the composer stays intact and shows a localized
bounded error. The current running request is never dropped to make room.

### Turn-owned rendering

Every submitted prompt creates one stable turn container before the network
request starts:

```text
turn
  ├── prompt row
  ├── turn status
  ├── reasoning block
  ├── tool/progress/approval/validation nodes
  ├── assistant response
  └── terminal result
```

The renderer receives an explicit `turnId` and never writes through a global
assistant or reasoning node. A queued turn is rendered immediately as
`queued`; it becomes `running` when its request starts and reaches a terminal
state independently of later queued turns.

History hydration groups persisted entries by each user message. Live events
are appended only to the active turn. Validation and approval controls retain
their session and turn ownership so a later turn cannot update an earlier
button or diff card.

### Replay and reconnect

The existing `runId` and monotonic event `sequence` become the client replay
boundary:

- store the last applied sequence per session and run;
- ignore an event whose sequence is already rendered;
- replace or update the active turn's live fragments idempotently instead of
  appending a second copy;
- when a run changes, close the old active turn before creating the recovered
  live turn;
- after a recovered run reaches a terminal status, hydrate persisted history
  once, then resume the session's queue only if the queue is not paused.

No new SSE event type is required for this phase. The current server-side run
registry remains authoritative for background recovery.

### Terminal-state policy

- `done`: mark the turn complete and automatically drain the next queued
  prompt in FIFO order.
- normal provider/tool `failed` or `error`: keep queued prompts visible but
  pause the queue, exposing a localized resume action so a provider failure
  cannot trigger a burst of repeated requests.
- explicit Stop/abort: preserve queued prompts and pause the queue.
- `waiting-approval`: do not drain; the approval belongs to the active turn.
- session switch: preserve the queue for that session, but drain only after
  the user returns to that session and its active run is terminal.

## Tech Stack

- TypeScript and Node.js server boundary.
- Static Desktop HTML/CSS/JavaScript client; no new frontend framework or
  bundler.
- Existing SSE stream and `DesktopRunRegistry`.
- Existing Node test runner and TypeScript test compilation.
- Existing metadata-only, bounded, bilingual UI contracts.

## Files to Map Before Editing

- `apps/desktop/public/index.html`
  - composer submit path;
  - `appendMessage`, `ensureAssistant`, `ensureReasoning`;
  - history hydration;
  - run snapshot recovery and event polling;
  - approval, validation, error, retry, and session-switch paths.
- `apps/desktop/public/styles.css`
  - conversation stream containment;
  - turn containers;
  - queue rows and paused/error states;
  - narrow viewport behavior.
- `apps/desktop/src/server.ts`
  - `/api/chat` single-flight guard;
  - stream lifecycle and terminal responses;
  - request-body and session limits.
- `apps/desktop/src/run-state.ts`
  - run identity, sequence, replay truncation, and live fragments.
- `apps/desktop/src/chat-session.ts`
  - persisted history timing and terminal event ordering.
- `apps/desktop/tests/session-isolation.test.ts`
- `apps/desktop/tests/run-replay-ui.test.ts`
- `apps/desktop/tests/run-replay.test.ts`
- `apps/desktop/tests/scroll-follow.test.ts`
- `apps/desktop/tests/server.test.ts`
- `apps/desktop/tests/chat-session-e2e.test.ts`
- `apps/desktop/package.json`
  - preserve the existing deterministic Desktop test command.
- `task_plan.md`, `progress.md`, and `findings.md`
  - update only with verified evidence.

## Global Constraints

- Do not change the existing SSE event names or persisted memory format.
- Do not allow concurrent model runs for one session.
- Do not lose a prompt because the current run is active, the page is
  manually scrolled, or a session is switched.
- Do not let a queued prompt bypass approval, validation, executor, MCP, or
  cancellation policy.
- Do not expose credentials, raw provider errors, unbounded prompt previews,
  absolute paths, or raw tool input in queue metadata.
- Keep queue messages bounded and render them as text, never HTML.
- Preserve the current Desktop background-run reconnect behavior.
- Preserve the Rich TUI, ANSI, JSON, ACP, and A2A contracts.
- Do not redesign the Desktop shell, add message virtualization, or add
  server-side queue persistence in this phase.
- Do not publish packages, create tags, push, or make a network release.
- Never reset, clean, or overwrite unrelated dirty worktree changes.

## Implementation Tasks

### Task 1: Lock the queue and turn contracts with RED tests

Create the smallest deterministic state contract before changing the client:

- FIFO enqueue/dequeue behavior.
- queue capacity and message-size rejection.
- queue preservation across session switches.
- normal completion drains exactly one next item.
- failure and explicit abort pause without losing waiting prompts.
- a turn cannot accept events after it reaches a terminal state.
- replay ignores duplicate or out-of-order sequences for the same run.

Add focused tests in the existing Desktop test style. The first run must fail
for the missing queue and turn-local behavior, and the failure must be
recorded in this plan before implementation continues.

### Task 2: Add bounded queue state and visible waiting rows

Implement browser-owned queue state at the current static client boundary:

- create a stable queue item and turn id on submit;
- render queued prompts immediately below the active conversation;
- show queue position and state in English and Chinese;
- allow removing one waiting item without affecting the active run;
- add a bounded “clear waiting” action;
- keep the composer focused and editable after enqueue;
- keep send enabled while capacity remains and disable only when the queue is
  full or the active action cannot safely be changed.

Add narrow-width CSS and accessible names without introducing nested card
decoration or changing the existing Signal Loom visual language.

### Task 3: Replace the discard path with FIFO draining

Refactor the current submit path:

- replace the early `activeChatSessionId !== null` return with enqueue logic;
- keep exactly one active `fetch("/api/chat")` per session;
- start the head item only when the session is idle;
- keep later items queued while the current run streams or waits for
  approval;
- after a normal `done`, finalize the current turn and schedule the next item
  on the next event loop turn;
- pause on failure or explicit abort and expose a resume action;
- if the server still returns `409`, return the item to the queue with a
  visible, bounded conflict status instead of losing it or recursively
  retrying forever.

Add stale request guards so an old `finally` block cannot unlock, drain, or
clear a newer turn.

### Task 4: Make every streamed event turn-local

Refactor event rendering so all output is scoped to the active turn:

- assistant tokens update only that turn's assistant node;
- reasoning updates only that turn's reasoning node;
- tool calls and progress cards stay inside that turn;
- approval and validation actions retain the turn/session id that created
  them;
- errors and retry buttons target the original prompt;
- terminal usage and status summaries close only their own turn;
- the next turn starts with fresh response nodes and never reuses the
  previous turn's DOM references.

Keep the current scroll-follow and “new output below” behavior, but pass the
turn-owned append operation through it so a queued turn cannot move an
unrelated session's scroll position.

### Task 5: Rebuild history and background recovery idempotently

Update history and replay paths:

- group persisted user/assistant/tool entries into stable turn containers;
- preserve the current message order and empty-session state;
- bind a recovered run to the correct active turn;
- apply `runId` and `sequence` as an idempotency guard;
- update live fragments in place during polling;
- do not append a second assistant/reasoning/tool block when the same snapshot
  is loaded twice;
- close the recovered turn once the terminal event is observed;
- drain a preserved queue only when the visible session is eligible.

Extend the existing session-switch and run-replay tests with a sequence:

```text
first prompt running
second prompt queued
switch session
return to first session
replay the same run snapshot twice
finish first prompt
automatically run second prompt
```

The expected result is two complete, isolated turns with no duplicate
assistant output.

### Task 6: Cover approval, stop, retry, and failure edges

Add focused regressions for:

- approval waiting does not start the next queue item;
- approval resolution resumes the same turn;
- Stop aborts only the active request and leaves queued prompts paused;
- retry targets the failed prompt and does not duplicate its turn;
- a provider error pauses the queue without dropping later prompts;
- removing a queued item never changes persisted conversation history;
- switching sessions cannot send a prompt to the wrong session;
- queue state resets correctly for a new session and after deletion.

Keep the server's concurrent-request `409` test as a backend invariant.

### Task 7: Verify visual and responsive behavior

Run a real local Desktop smoke at the fixed URL and inspect:

- one active turn plus at least two queued prompts;
- current response streaming inside the first turn;
- automatic start of the next turn after `done`;
- approval card staying in its original turn;
- failure-paused queue and resume action;
- manual scroll plus “new output below” behavior;
- session switch and return during an active run;
- narrow browser width and keyboard focus;
- no duplicated footer, status, response, queue row, or prompt.

Record browser console errors and warnings. Keep the smoke local and
provider-stubbed where possible.

### Task 8: Run the final gates and update project records

Run in this order:

```bash
pnpm --filter @dev-agent/desktop test
pnpm --filter @agent_cli/cli test
pnpm test:evals
pnpm verify:typescript
git diff --check
```

If the Desktop client state is extracted into a separately testable static
module, include its focused test in the Desktop package gate and keep the
served `/public/` path covered by the static asset contract.

Update:

- this plan with exact test counts and the implementation closure;
- `task_plan.md` with Phase 29 status;
- `progress.md` with the verified milestone;
- `findings.md` with any remaining queue/replay limitation;
- `apps/desktop/README.md` and the root README only if the user-visible
  Desktop queue behavior or run-control semantics changed.

## Implementation Closure

Completed on 2026-09-22:

- Added a bounded per-session FIFO prompt queue with visible queued turns,
  remove/clear/resume controls, and terminal-state handling.
- Scoped streaming reasoning, assistant output, tool progress, approvals,
  validation, errors, and retry actions to their owning turn.
- Added replay sequence guards and session-specific background-run recovery.
- Rebuilt a completed background run from its bounded event snapshot when
  history had not yet been persisted, fixing the empty transcript after
  switching away and back.
- Added a turn ledger that closes immediately on `done`/`error` and rejects
  late stream frames, so a terminal run cannot be reopened or append output
  after the next queued turn has started.
- Preserved the fixed-port lifecycle, server-side single-flight `409` guard,
  bilingual UI, manual scroll position, and existing session isolation.

Verification performed:

- Browser smoke with a provider-stubbed local server on an ephemeral port:
  FIFO queue, turn isolation, switch-away/switch-back recovery, and
  post-terminal late-frame rejection passed.
- Desktop suite: **161/161**.
- CLI suite: **543/543**.
- Rich TUI evaluations: **8/8**.
- `run-replay-ui` focused regression: **1/1**.
- `pnpm verify:typescript`: all selected gates passed.
- `git diff --check`: passed.
- No package release, tag, or network publication was performed.

## Acceptance Criteria

- Submitting a second prompt during an active run creates a visible queued
  item; it is never discarded and never starts concurrently.
- Queued prompts drain FIFO after a normal completed answer.
- Each prompt has exactly one turn container and its assistant/tool/approval/
  validation output stays inside that container.
- Duplicate run snapshots and replay polls do not duplicate visible output.
- Session switches preserve queue isolation and cannot cross-wire messages.
- Approval, Stop, retry, failure, scroll-follow, and new-output behavior
  remain correct.
- Queue limits and prompt rendering are bounded and safe.
- Desktop, CLI, Rich TUI evaluations, workspace TypeScript gates, and
  `git diff --check` pass.
- No package release or network publication occurs.

## Explicit Follow-up, Not This Phase

- Persisting unsent browser prompts across a full page reload.
- A server-side durable queue shared by multiple browser tabs.
- Cross-device queue synchronization.
- Message virtualization for very large transcripts.
- A full Desktop visual redesign or another logo/startup-screen pass.
