
## Current findings

- Desktop `/api/status` exposes executor mode, Node runtime, provider/model,
  approval, validation metadata, and a managed Rust runtime summary.
- The managed runtime summary is metadata-only: it accepts only allowlisted
  states/targets, exposes `version` only for verified installs, and reduces
  failure detail to a stable reason or stable error code.
- Runtime status is read offline through `@dev-agent/runtime-manager`; it does
  not start providers, MCP servers, or runtime binaries.
- Every CLI `:team` execution requires a bounded task-scope review. The legacy
  `collaboration.reviewTaskToolScopes` boolean is accepted but ignored. Scopes
  are bound to ordered task slots and a SHA-256 fingerprint of the complete
  normalized graph; Agent Core revalidates the fingerprint, slot coverage,
  available tool names, and optional global ceiling before workspace creation.
  Planner task IDs are display labels, not authorization keys.
- Task scopes restrict MCP tool visibility, not MCP process or resource access:
  the CLI starts configured MCP sessions at the project root and workers reuse
  those wrappers. MCP servers are not run in task worktrees or inside the Rust
  tool sandbox; a server's own args, environment, and remote integrations govern
  its resource access.

## 2026-09-20 Eight-hour slice

- The native macOS shell is complete and verified; the next work should stay
  in the shared CLI/tooling surface instead of adding another desktop client.
- The authoritative audit listed five reproducible `FIX` findings. The current
  worktree now closes them in `packages/mcp/src/server.ts`,
  `apps/cli/src/index.ts` session listing, `apps/cli/src/doctor.ts` subprocess
  readers, and `packages/tools/src/filesystem.ts` write/postimage handling.
- The current MCP source/test diff is already present in the worktree and must
  be treated as concurrent work until its focused tests are read and passed.
- Four audit entries remain `NEEDS-EVIDENCE`; they are not part of this
  implementation slice and must not be silently changed.

## 2026-09-21 Gemini CLI architecture alignment

- The Gemini CLI study treats Ink/React as a terminal presentation layer only;
  Agent Runtime remains responsible for model orchestration, context, tools,
  policy, lifecycle, and session behavior.
- The current worktree already covers several study-aligned boundaries:
  versioned runtime events, a bounded Tool Registry, Scheduler, Skills,
  Hooks/Trace, checkpoint rewind, extensions, shared Prompt modules, and the
  Rich Ink composer.
- The next architecture gaps to audit against the current source are the
  unified Policy/Permission decision path, MCP discovery/resources/transports,
  sandbox-backed execution, context compression/session restoration, and
  external protocol adapters. These must be added without moving input
  ownership back into the UI or weakening the metadata-only safety contracts.
- The current approval implementation already provides important safety
  behavior in `packages/agent-core/src/approval.ts`, including dangerous-command
  checks, workspace containment, reviewed writes, and symlink handling. The
  remaining design issue is boundary consistency: `AgentLoop` accepts an
  optional policy, CLI compiles policy modes separately, and the core/tool
  packages expose parallel registry shapes. The next phase should unify the
  contract and add adapters without duplicating or weakening those checks.
- The MCP package already implements bounded stdio tools, resources, prompts,
  list-change notifications, resource watchers, reconnect, and session
  snapshots. CLI registers all three capability types into its prompt/tool
  surface, while Desktop's `ChatSession.connectMcpTools()` currently registers
  only tools. Desktop therefore has a concrete MCP capability-parity gap:
  resource and prompt metadata is discovered but not made available to the
  model or session status.
- The Executor package already separates `LocalExecutor` and `RustExecutor`
  behind `Executor`/`SandboxExecutor` and carries `SandboxProfile` metadata.
  A new sandbox abstraction would be premature for this slice; the next work
  should build on that existing boundary rather than introduce a second one.

## 2026-09-21 A2A protocol baseline

- The official `@a2a-js/sdk` package is at version **1.2.0** and documents
  A2A protocol **v1.0** support for JSON-RPC, HTTP+JSON/REST, and gRPC.
- The reusable server path is
  `DefaultRequestHandler` + `AgentExecutor` + task/event-bus implementations;
  `JsonRpcTransportHandler` is usable without Express.
- The v1 agent-card discovery path is
  `/.well-known/agent-card.json`, and the SDK exports the v1.0 protocol/content
  constants.
- The repository's Desktop server already owns bounded Node HTTP body parsing,
  SSE headers, stream caps, abort controllers, and lifecycle cleanup patterns.
- The first implementation should therefore use a reusable `packages/a2a`
  adapter with a Node HTTP transport and a CLI edge, while leaving Express,
  gRPC, push notifications, authentication, signed cards, and multi-agent
  orchestration deferred.
## 2026-09-21 Next-phase audit: Rich TUI viewport navigation

- The current A2A boundary is already implemented and verified; it is not the next work item.
- The completed scrollback hardening phase keeps committed output in terminal scrollback and prevents prompt/footer duplication, but it does not provide an in-app viewport controller.
- `apps/cli/src/ink/app.tsx` currently renders committed transcript with `Static` and keeps the active transcript/composer in the dynamic frame. Its input handling reserves arrow keys for completion and prompt history, but it has no scroll offset, follow-output mode, PageUp/PageDown behavior, or mouse-wheel path.
- `apps/cli/src/ink/runtime-store.ts`, `apps/cli/src/ink-ui.ts`, and `apps/cli/src/tui-session.ts` do not expose viewport state. This makes the user-visible complaint “空白区域太高，而且我往上滑动不了” a real missing interaction rather than only a spacing regression.
- Existing Ink tests cover compact/tall terminal layout, no-clear startup, committed scrollback, and duplicate-frame prevention. They do not cover interactive upward navigation, returning to the live bottom, new output while scrolled, or bounded transcript rendering across narrow terminal sizes.
- The Gemini CLI architecture study still supports keeping this in the presentation/controller boundary: runtime events remain the source of truth, while the Rich TUI owns viewport navigation and rendering policy.
- The next phase should therefore introduce a bounded Rich TUI viewport with explicit scroll controls, preserve the fixed composer/footer, define follow-output behavior, and add PTY/regression coverage before any further visual polish.
- The current worktree contains broad uncommitted implementation from prior phases and concurrent work. The next implementation must be additive and scoped to the Rich TUI/controller/tests/docs touched by this phase; it must not reset, clean, or overwrite unrelated changes.
- The root plan currently ends at the completed A2A phase, so the next plan must be recorded as a new Phase 24 rather than modifying historical phase status.

## 2026-09-21 Phase 24 implementation start

- Re-read the Phase 24 plan, progress log, and current worktree before
  implementation. The phase is still planned and no viewport code exists.
- TDD and verification-before-completion rules are active for this phase:
  viewport behavior will be specified by failing tests before production code
  is added, and no completion claim will be made without fresh verification.
- The first implementation slice will be a pure viewport model so wrapping,
  bounds, page movement, follow-output behavior, and resize clamping can be
  verified independently of Ink rendering.
- The current Ink app confirms the intended integration seam: `Static` owns
  committed transcript output, while the dynamic frame owns the active
  transcript/composer. Existing arrow-key handling is already used by path
  completion and prompt history, so the new viewport contract must use
  unambiguous page/home/end keys and must not repurpose arrows.
- The existing completed-transcript regression explicitly asserts that old
  answers are absent from later dynamic frames because `Static` owns them.
  True in-app scrolling requires changing that rendering contract: keep the
  launch welcome static, but render the complete transcript through one
  bounded dynamic viewport so the app can select older rows without emitting
  a second copy after the scroll request.
- The installed Ink runtime exposes `key.pageUp` and `key.pageDown` in
  `useInput`, and its `Box` supports `height` plus `overflow: hidden`. The
  first integration can therefore remain keyboard-only and avoid enabling
  terminal-wide mouse tracking.
- The PageUp PTY regression initially appeared broken only because the test
  pressed PageUp after Home; from the oldest offset there is nothing further
  above. The correct interaction order is bottom -> PageUp -> Home -> append
  while scrolled -> End.
- The repository PTY harness currently has no long-session viewport case. It
  already provides local OpenAI-compatible stubs and `expect` helpers, so the
  new evaluation can stay provider-free from the network while exercising the
  built CLI process.

## 2026-09-22 Eight-hour continuation baseline

- The current Rich TUI implementation has a bounded viewport model and focused
  Ink coverage, but
  `docs/superpowers/plans/2026-09-21-rich-tui-viewport-navigation.md` still
  has unchecked resize, interaction-regression, full-suite, and handoff items.
- The first full `pnpm test:evals` run reached the queue assertions but failed
  the no-clear invariant because the live PTY output contained one
  `\u001b[2J\u001b[3J\u001b[H` sequence before the queue scenario's
  `PRE_EXIT_MARKER`.
- The assertion lives in `evals/cli-rich-tui.evals.mjs` and intentionally
  protects terminal scrollback. It must not be weakened or removed.
- `apps/cli/src/ink/terminal-size.ts` already normalizes missing or zero-size
  output fields to positive defaults, while `apps/cli/src/ink/app.tsx` reads
  `stdout.columns` and `stdout.rows` directly for layout. The root-cause
  question is whether Ink's own first render observes the PTY's transient
  zero dimensions before the normalized layout boundary takes effect, or
  whether the PTY fixture reports a later resize as a startup clear.
- The next safe action is a direct reproduction with raw PTY capture and
  dimension tracing. No production fix has been attempted for this regression
  in the current 8-hour slice.

## 2026-09-22 PTY reproduction result

- A fresh exact run of `pnpm test:evals` completed successfully with all
  **8/8** Rich TUI evaluations: queue, viewport navigation, viewport resize,
  idle Ctrl-C, approval, ANSI resize/commands, EOF, and Skills activation.
- The prior startup-clear failure is therefore not deterministic under the
  same command. It remains an unexplained timing-sensitive regression until
  repeated runs or raw PTY capture establish whether the clear sequence is
  emitted by Ink, the PTY fixture, or the terminal resize transition.
- No production code was changed in response to the prior failure.

## 2026-09-22 Terminal guard verification

- The current `createInkRenderOutput()` implementation already provides the
  intended one-row virtual height guard; the missing evidence was a direct
  unit contract, not a second clear-screen workaround.
- Added two regression tests to
  `apps/cli/tests/ink-terminal-size.test.ts`: positive terminal sizes expose
  one guarded row, and zero-size startup is normalized before the guard is
  observed.
- The focused Ink and terminal-size batch now passes **34/34**. The three
  repeated PTY evaluation runs also passed **8/8** each.
- Because the original failure did not reproduce and the existing guard now has
  direct coverage, no production rendering code was changed in this slice.

## 2026-09-22 Full-frame clear root cause and fix

- Raw PTY capture showed `\u001b[2J\u001b[3J\u001b[H` after the dynamic Ink
  frame grew to the terminal height. Ink 6's renderer clears the screen when
  `lastOutputHeight >= stdout.rows`, even when incremental rendering is
  enabled; replaying `Static` output then made the welcome panel appear twice.
- The application now passes Ink a proxy output whose reported row count is one
  row larger for fullscreen detection, while `InkCliApp` subtracts that guard
  before calculating its actual layout. This preserves terminal geometry and
  prevents the clear/replay path.
- The direct Ink regression, terminal-size contracts, queue PTY case, and
  resized long-session PTY case all pass after the fix.
- The full CLI suite has one unrelated failure:
  `index-refresh-cli.test.js` expects the child to exit after SIGINT with
  `signal === null`, but the observed result is `signal === "SIGINT"`.

## 2026-09-22 Eight-hour continuation closure

- Three isolated runs of
  `DEV_AGENT_EVAL_ONLY='Ink queue and streaming' node
  evals/cli-rich-tui.evals.mjs` passed **1/1** each, and the complete Rich TUI
  evaluation passed **8/8** after the resize case was added.
- The raw-output diagnostic placed `PRE_EXIT_MARKER` immediately before the
  explicit `exit` input. The `ESC[2J ESC[3J ESC[H` sequence was observed only
  after the process began teardown; no live queue frame before the marker
  contained it. This distinguishes terminal unmount cleanup from a startup
  scrollback clear.
- Added a direct Ink integration regression for zero-dimension startup in
  `apps/cli/tests/ink-app.test.ts`; focused Ink/viewport/terminal-size
  coverage passes.
- The repeat full CLI run completed **536/536** and the Desktop suite completed
  **150/150**. The earlier single index-refresh SIGINT mismatch was a timing
  flake under the long suite, not a Rich TUI regression.
- Audited the Desktop UI and recorded the next bounded slice at
  `docs/superpowers/plans/2026-09-22-desktop-next-slice.md`: a localized,
  accessible “new output below / jump to latest” affordance that preserves the
  existing manual-scroll contract.

## 2026-09-22 Desktop live-scroll recovery closure

- Completed the bounded Desktop slice without changing the server, SSE event
  schema, session memory, or message ordering.
- A flex-contained conversation stream now owns the scrollable region. A
  localized `#jump-to-latest` button stays hidden at the live bottom, appears
  when output arrives below a manually scrolled reader, and clears on click or
  manual return to the bottom.
- History and session transitions reset the pending state, preventing stale
  “new output” indicators from leaking across sessions.
- The full Desktop suite passes **150/150**; the Rich TUI evaluations pass
  **8/8**; the CLI suite passes **536/536**; the TypeScript release gate and
  `git diff --check` also pass.

## 2026-09-22 Desktop port lifecycle root cause and fix

- `apps/desktop/src/index.ts` previously bound the configured port directly and
  exposed raw `EADDRINUSE`; no Desktop code selected 4318, so any observed port
  drift came from an external launcher or manual fallback.
- The new launcher probes `/health` and `/` before binding. A healthy
  dev-agent workbench is reused on the exact requested port.
- An unrelated owner is rejected with a clear message that asks for an
  explicit free `DEV_AGENT_DESKTOP_PORT`; automatic port increments are
  forbidden.
- The native macOS launcher already terminates only its marked app/server
  processes before launch and remains unchanged.
- Process-level port tests pass **2/2** and the Desktop suite passes **152/152**.

## 2026-09-22 Desktop queue and turn-isolation audit

- `apps/desktop/public/index.html` currently returns from form submission when
  `activeChatSessionId` is non-null. A prompt typed while a request is active
  is therefore discarded rather than placed in a waiting sequence.
- The server's `inFlight` map correctly prevents concurrent runs for one
  session and returns `409`, but it is a safety boundary, not a user-visible
  queue. The next phase must keep this guard and move normal queue behavior to
  the browser.
- `currentAssistant`, `currentReasoning`, and `currentToolProgress` are
  shared page-level references. History hydration and background replay also
  write through those references, which leaves a real path for a later turn or
  replayed event to update the wrong response region.
- `DesktopRunState` already exposes bounded `runId`, monotonic `sequence`, and
  sanitized replay events. The missing client contract is sequence-based
  idempotency and turn ownership, not another server event transport.
- The safe next slice is a per-session, bounded in-memory FIFO queue plus
  turn-owned DOM rendering. Normal completion may drain automatically; explicit
  abort and terminal failure should pause the queue so a transient problem
  cannot trigger repeated requests.
- Queue contents should not be persisted across a full page reload in this
  slice, because unsent prompts may contain sensitive project context. A
  durable multi-tab queue remains a separate design decision.

## 2026-09-22 Desktop queue and background-recovery closure

- The browser-owned queue and turn renderer are now implemented and verified
  with **161/161** Desktop tests plus a provider-stubbed browser smoke.
- A completed hidden run can be reconstructed from the bounded run event list
  when history persistence is still in flight, preventing an empty transcript
  after returning to the session.
- Terminal events now close the client turn before the underlying stream is
  fully torn down; late tokens are rejected by the turn ledger instead of
  reopening a completed turn or contaminating the next queued turn.
- The remaining intentional limitation is that unsent queue items live only
  in the current browser page. A full reload or a second browser tab does not
  restore them; durable queue persistence remains a separate design phase.

## 2026-09-22 CLI startup interrupt race resolved

- The earlier `index-refresh-cli.test.js` mismatch was a real startup race, not
  a test-only timing issue: SIGINT could arrive while the statically imported
  CLI modules were still loading.
- `apps/cli/src/cli-entry.ts` now installs a minimal early handler and passes
  its abort signal into `index refresh`; the command returns the bounded
  cancellation document and exit code 130 without replacing the prior index.
- The regression passes alone and while the full Desktop suite runs in
  parallel. The remaining intentional Desktop queue limitation is unchanged.
- The final aggregate TypeScript gate also passes all selected checks, including
  Desktop **161/161**, CLI **543/543**, package installation smoke, release
  contracts, documentation contracts, and native bundle contracts. No publish
  or release side effect was performed.

## 2026-09-22 Desktop queue recovery boundary

- Waiting prompts can now survive a page reload within the same browser tab
  through a versioned, bounded `sessionStorage` snapshot.
- The snapshot never contains the active request, transcript, reasoning, tool
  output, or cross-tab state; malformed, expired, oversized, and unavailable
  storage paths fail closed.
- Rename migrates the snapshot and delete clears it. Browser smoke and the
  Desktop **165/165** suite confirm the boundary.

## 2026-09-22 Desktop session discovery filter boundary

- `GET /api/sessions` already exposes bounded summaries with `sessionId` and
  run status, so session search and status filtering can stay entirely in the
  browser without a new server contract.
- The filter applies only to the session picker. Transcript history, active
  runs, background recovery, and queue persistence remain unchanged.
- The current session is deliberately retained as an option when it does not
  match the active filter; this avoids making the conversation appear to
  switch or vanish while the user is searching.
- Empty feedback is shown only for an active query/status filter with no
  matching summaries; an unfiltered session rail stays quiet.

## 2026-09-22 Desktop run activity boundary

- The visible activity indicator is derived from existing `reasoning`, `tool`,
  `tool-progress`, `token`, `approval-request`, `done`, and `error` events.
  The server and provider event schema remain unchanged.
- The indicator is intentionally a safe runtime stage such as “Thinking” or
  “Calling a tool”; it is not a promise to expose hidden model chain-of-thought.
- Activity is stored on the turn record and restored through the same bounded
  run replay path as assistant, reasoning, and tool fragments, so a session
  switch cannot update another session's status line.
- Terminal state is authoritative: complete, failed, and aborted turns do not
  keep showing a stale transient stage after replay or live-fragment restore.

## Desktop assistant response copy boundary

- Copy actions are attached to the concrete assistant DOM node rather than
  reading the latest turn globally; this preserves correctness when one turn
  contains multiple assistant segments around tool calls.
- Clipboard writes prefer `navigator.clipboard.writeText` and fail over to a
  temporary readonly textarea. Empty text and unavailable browser APIs return
  a stable failure without throwing into the stream loop.
- Copy labels are ordinary localized DOM nodes, so the existing English/Chinese
  toggle updates copied and failure states without rebuilding the transcript.
- Author `display` rules can override the browser's default `hidden` behavior;
  the global `[hidden] { display: none !important; }` rule keeps completed
  queue controls out of the transcript.

## Desktop approval test isolation

- Provider-stubbed approval tests must override `DEV_AGENT_MCP_SERVERS` with an
  empty array. Without that boundary, the user's `~/.dev-agent/config.json`
  can start unrelated MCP servers and delay or suppress the approval event.
- The isolation is limited to test setup; production Desktop sessions continue
  to load MCP servers from the configured environment or user config.

## Desktop assistant Markdown boundary

- Assistant transcript rendering is intentionally implemented as a small
  dependency-free subset instead of trusting raw HTML or adding a browser
  sanitizer dependency to the static Desktop surface.
- The renderer escapes every text and attribute value, permits only HTTP(S)
  links, and preserves unsupported syntax as visible text.
- The exact source remains in `data-raw-markdown`, so rendering does not change
  the copy contract or the persisted session content.

## Desktop code-block copy boundary

- Code-block copy is scoped to the rendered block's own `code` element, so
  multiple blocks and multiple assistant segments cannot cross-copy content.
- The action copies plain text rather than serialized HTML and uses the same
  bounded clipboard helper as whole-response copy.
- The control is created only around a fenced code block and is skipped when a
  block has already been decorated, keeping repeated stream renders idempotent.
- Localized status labels are dynamic DOM nodes, so switching languages updates
  both idle and completed copy states without changing the transcript source.

## Desktop plan workflow scope boundary

The Desktop Plan/Review/Apply/Validate/Undo workflow was already implemented in
the current working tree; the remaining work was documentation and evidence
closure rather than a fresh implementation.

The safe path is to apply only the session-owned reviewed change set and keep
plan review, mutation application, validation, evidence, and undo bound to the
existing turn ownership model. Adding an independent model-generated mutation
would have violated the reviewed-diff contract.

## Desktop conversation checkpoint boundary

Desktop checkpoint creation and rewind now share the existing FileMemory
history authority rather than introducing a separate transcript store. A
checkpoint stores bounded metadata: session id, creation time, history anchor,
entry count, and change-set ids.

Rewind validates the owning session and exact history anchor before truncating
later conversation entries. It intentionally does not touch workspace files,
applied change sets, postimage guards, validation evidence, or undo
records; those remain under the existing Desktop evidence workflow. Unknown,
stale, cross-session, or malformed checkpoints fail closed.

The Desktop UI requires an explicit confirmation before rewind and reloads the
transcript only after a successful response. Active chat, validation, cleanup,
rollback, and checkpoint operations continue to use the stable active-session
guard.

## Desktop trace panel boundary

The Desktop trace view is intentionally a projection of the existing server
trace contract, not a new telemetry surface. It shows only timing, status,
counts, and bounded identifiers for runs and model/tool spans; request content
and raw tool results stay outside the UI.

Fail-closed payload validation, request cancellation, and session-operation
reset are UI concerns. They prevent stale trace data from appearing after a
session switch or lifecycle change without changing the server endpoint.

## CLI test-product race

One TypeScript-gate run transiently reported six missing
`apps/cli/tests-dist/*.test.js` files while the outer CLI suite was active.
Immediately rerunning the CLI suite and the full TypeScript gate produced
**561/561** and all selected contracts with no production change. Treat the
missing-files failure as a build-product race until a deterministic isolation
fix is added; do not diagnose unrelated tests from that first transient result.

## CLI package build isolation boundary

The Phase 43 deterministic boundary is to complete the package bundle before
the CLI test runner starts. The CLI test lifecycle remains sequential: clean
`tests-dist`, compile, bundle, then test. In-suite package-install coverage
uses `--skip-build`; only the standalone smoke command owns the fresh-checkout
build path. This prevents a nested workspace build from racing the active test
process without changing product code, CLI behavior, or release authority.

## Desktop validation MCP isolation boundary

Provider-stubbed Desktop validation tests must set `DEV_AGENT_MCP_SERVERS=[]`
through the shared test helper. Otherwise a host-level MCP configuration can
start unrelated servers during a run that is not exercising MCP, causing an
unrelated assertion to fail behind a 30-second `initialize` timeout. The helper
default remains overridable, so tests that intentionally exercise MCP can
supply their own servers; production Desktop MCP behavior is unchanged.

## CLI scheduler approval-status boundary

The task scheduler already accepts `waiting-for-confirmation`, but AgentLoop's
approval lifecycle was not connected to the active interactive task. The
observer now covers both tool approval decisions and sandbox-expansion
confirmation callbacks; it returns the task to `running` after the decision.
Calls without an approval policy do not produce this status. The bridge exists
only while the scheduled task is running, and its detail remains generic so
prompt text, tool arguments, and paths are not added to scheduler snapshots.
The shared scheduler retains prior detail when callers omit a new value, so
the CLI bridge explicitly changes the detail to `confirmation resolved` when
returning to `running`; this avoids expanding the scheduler's shared API.


## 2026-09-23 Gemini CLI architecture alignment research

The current official `google-gemini/gemini-cli` repository snapshot was checked
on 2026-09-23. Its root manifest identifies an npm-workspaces, ESM monorepo
with Node.js >=20; the CLI and core are separate packages. The CLI manifest
uses TypeScript, React 19, Ink, esbuild-based bundling, and Vitest. The fetched
main-branch package version is a dated nightly identifier, so it is evidence
about that source snapshot, not a claim about the latest stable release.

Official references consulted:

- [Gemini CLI root package manifest](https://github.com/google-gemini/gemini-cli/blob/main/package.json)
- [Gemini CLI frontend package manifest](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/package.json)
- [Gemini CLI core package manifest](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/package.json)
- [Architecture overview](https://google-gemini.github.io/gemini-cli/docs/architecture.html)
- [Policy Engine reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md)
- [Subagents reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md)
- [Agent Skills reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/using-agent-skills.md)
- [Extension reference](https://geminicli.com/docs/extensions/reference/)

Design observations to validate against dev-agent source before proposing work:

- Gemini CLI explicitly separates user-facing CLI responsibilities from a
  backend core that owns prompts, API calls, tools, and session state.
- Its Policy Engine models decisions (`allow`, `deny`, `ask_user`) as rules with
  matching conditions, priorities, and policy tiers. The current docs note that
  the workspace-policy tier is disabled; do not treat every documented tier as
  operational.
- Its subagent design emphasizes independent conversation history, explicit
  tool allowlists, isolated MCP configuration, policy by agent identity, and
  recursion protection. The extension reference marks subagents as preview, so
  these concepts are design evidence, not a maturity guarantee.
- Skills and extensions are layered and discoverable. The Skills reference
  describes built-in, extension, user, and workspace tiers with precedence and
  in-session management; extension packages may contribute skills and policy.

This is a research baseline only. The next step is to compare these ideas with
current dev-agent implementations (especially approval policy compilation,
collaborative execution isolation, Skills/Extensions lifecycle, and runtime
boundary ownership) before selecting an implementation slice.


### Stack comparison snapshot

- The Gemini CLI `main` manifests fetched on September 23 identify version
  `0.62.0-nightly.20260918.g9450ade79` (a source-tree nightly, not the latest
  stable-release claim), Node.js >=20, ESM, npm workspaces, TypeScript 5.8.3,
  React 19.2.4, an Ink 6.6.9 npm override, esbuild bundling, and Vitest 3.2.4.
- This repository is also Node/TypeScript ESM with Node >=20 and a CLI/Core
  split. It uses pnpm 12.3.4, TypeScript 5.9, React 19, Ink 6, esbuild for the
  CLI package, and Node's built-in test runner. The stack is already closely
  aligned; replacing package manager or test runner solely for parity would not
  be justified.
- The strongest current design comparison is therefore behavioral, not a
  wholesale technology migration: Gemini's policy rules have explicit
  matching, decisions, priority, and trust tiers; skills are dynamically
  manageable; and subagents have independent history, explicit tool scopes,
  optional isolated MCP servers, and recursion guards. The current dev-agent
  implementation must be audited in source before treating any of these as a
  gap. The workspace policy tier is explicitly disabled in Gemini's current
  policy documentation. The current subagent reference documents independent
  contexts and tool/MCP scopes, with an `experimental.enableAgents` opt-out;
  avoid treating a prior preview label as a current maturity guarantee.

Additional official references:

- [Gemini CLI policy engine reference](https://geminicli.com/docs/reference/policy-engine/)
- [Gemini CLI Agent Skills management](https://geminicli.com/docs/cli/using-agent-skills/)
- [Gemini CLI hooks reference](https://geminicli.com/docs/hooks/reference/)
- [Gemini CLI configuration reference](https://geminicli.com/docs/reference/configuration/)

### Current dev-agent source audit for the Gemini comparison

- The earlier September 21 note that CLI/Desktop compiled approval policies
  independently is no longer current: `createApprovalPolicy()` now owns the
  shared `allow`, `deny-dangerous`, `ask`, and `review-writes` mode behavior in
  Agent Core, and CLI/Desktop/MCP call that factory. Custom deny regexes and
  allowlist entries remain a smaller config model than Gemini's priority-rule
  engine; whether a richer policy model is needed is a separate product choice.
- Collaborative execution creates a fresh `AgentLoop`, context, and memory per
  task and uses a workspace provider. Agent Core now supports an optional
  caller-owned per-task tool allowlist. The CLI also supports the bounded,
  user-owned `collaboration.toolAllowlist` ceiling shared by every `:team`
  worker; it does not map planner-generated task data to per-task grants. The
  CLI's selected `toolSandboxProfile` resolver and bounded `onSandboxExpansion`
  callback reach each worker AgentLoop. Focused tests verify the restricted
  profile, approved retry, and tool ceiling.
- Skills are bounded and explicitly activated, but the CLI loads its
  `SkillRegistry` once for an interactive session; there is no reload command.
  Extensions are intentionally metadata-only and do not execute extension
  code or start declared MCP processes, a trust boundary rather than an
  accidental missing implementation.


### Collaborative worker sandbox parity (verified in the active tree)

The CLI passes its selected Rust-backed `toolSandboxProfile` resolver and
bounded sandbox-expansion callback into `createCollaborativeExecution()`. That
API supplies both to each worker `AgentLoop`; `runExecutorCommand()` then uses
the resolved profile from the worker's `ToolExecutionContext`. The focused
collaboration test observes the restricted first attempt, the bounded
expansion request, and the approved retry profile. All CLI workers may also be
bounded by the user-configured `collaboration.toolAllowlist`; individually
mapped task scopes remain deferred until the CLI has an explicit user-reviewed
task-to-scope binding.

### Gemini source links and caveats

The comparison document `docs/gemini-cli-architecture-alignment.md` records
source-linked findings from the official Gemini CLI repository and docs. On
2026-09-23 the upstream references confirmed the CLI/Core package split,
Node/TypeScript/React/Ink/Vitest stack, policy rule priorities and decisions,
and subagent tool/context/MCP isolation. The policy reference itself warns that
the workspace policy tier is currently non-functional; treat capability maturity
as part of the comparison, not just feature names.


### Collaboration sandbox propagation and verification evidence (2026-09-23)

- `apps/cli/src/index.ts` now gives `createCollaborativeExecution()` the same
  `toolSandboxProfile` and `onSandboxExpansion` callbacks used by the primary
  CLI `AgentLoop`. `packages/agent-core/src/collaboration-execution.ts` passes
  them to every worker loop. The profile resolver sees the worker's isolated
  worktree through `AgentContext.workingDirectory`.
- Focused collaboration coverage verifies a denied network call triggers the
  bounded approval callback, retries with the returned profile, and remains
  scoped to the worker workspace. At that point, the sandbox change did not add
  a tool allowlist; the later CLI ceiling is recorded below.
- A clean, repository-wide gate is not established: full workspace test runs
  intermittently fail tight executor/MCP startup timeout assertions, while the
  corresponding executor cancellation test and full MCP package pass in
  isolation. Keep this distinct from the sandbox-propagation feature result.


### Caller-owned collaborative tool scopes (2026-09-23)

- `toolAllowlistForTask` is an execution option on `CollaborativeExecutionOptions`,
  not a `CollaborationTask` field. Planning output therefore cannot directly
  choose or expand a worker's capabilities. The callback is resolved for every
  normalized task before any workspace side effect.
- The returned names are validated (maximum 256, exact non-empty unique names,
  all present in the caller's `ToolCollection`) and converted to a snapshot
  collection. Both `AgentLoop.buildToolSchemas()` and `runTool()` consume this
  same narrowed collection; a hidden/hallucinated tool name cannot execute.
- The option is opt-in for backward compatibility. When configured, the CLI
  supplies the same `collaboration.toolAllowlist` ceiling through a constant
  resolver for every team task; with no ceiling, it omits the resolver and keeps
  the historical full worker tool set. Both paths remain bounded by the caller's
  tool collection.
- The callback can receive task fields originating in planner output, so an
  application must not infer different grants from task id, role, title, or
  instructions without independent user authorization. The CLI's constant
  resolver does not inspect these fields; individually bound task scopes remain
  deferred until an explicit post-plan confirmation flow exists.
- Verification: Agent Core 195/195; CLI collaborative integration 6/6; prior
  focused CLI interactive tests 3/3. At the time of this entry, the aggregate
  gate still had load-sensitive failures; see the later final gate record.

## 2026-09-23 Earlier TypeScript gate failure (superseded)

- At this stage, `pnpm verify:typescript` passed structure, build, and typecheck. Its recursive
  test phase failed one Desktop cancellation end-to-end case because the shell
  command's start marker was not observed within 10 seconds while package tests
  were running concurrently.
- The identical compiled test passed when run alone (**1/1**, 5.6 seconds), and
  the Desktop task-workspace tests passed (**5/5**) in the aggregate attempt.
- This was a load-sensitive aggregate failure, not evidence that cancellation
  behavior itself was broken. It was resolved by serializing workspace test
  execution; the final gate below passed without skipping or weakening tests.

## 2026-09-23 Final CLI collaboration and TypeScript gate verification

- CLI config now accepts a user-owned `collaboration.toolAllowlist` of at most
  256 exact, unique tool names. The same ceiling applies to every `:team`
  worker; planner IDs, roles, titles, and instructions cannot grant tools.
- Agent Core's separate per-task resolver remains caller-owned and narrows both
  model-visible tool schemas and runtime lookup. The CLI leaves this resolver
  unset until a post-plan, user-reviewed binding flow exists.
- Workspace package tests run serially through
  `pnpm -r --workspace-concurrency=1 run test`; `tests/release-gate.test.mjs`
  asserts this contract.
- Final `pnpm verify:typescript` passed all selected steps: Agent Core **196/196**,
  Tools **159/159**, CLI **566/566**, Desktop **208/208**, CLI package-install
  smoke, release/preview/CI contracts, documentation contracts **57/57**, and
  native Desktop bundle contracts **2/2**.
- `git diff --check` passed. No publish, tag, push, signing, GitHub Release,
  notarization, or package upload was performed.


## 2026-09-23 Collaboration ceiling config fail-closed check

- `validateCollaborationConfig()` is shared by the config validator and the
  interactive CLI's runtime resolver, so malformed collaboration objects,
  allowlist types, duplicate entries, oversized lists, and whitespace names are
  rejected consistently.
- The runtime checks the raw parsed config before provider or worker setup. A
  malformed `collaboration` value cannot become `undefined` through optional
  chaining and silently restore all worker tools. Missing `collaboration` and
  `collaboration: {}` still mean no configured ceiling; an explicit empty list
  deliberately exposes no worker tools.
- Focused CLI config, config-validation, and collaboration tests pass **48/48**.
  A subsequent full gate passed structure/build/typecheck but its CLI test stage
  overlapped a separate long-running `pnpm --filter @agent_cli/cli test` process
  in the same checkout; this caused test-directory races and load-sensitive CLI
  failures. Both stale test processes were stopped. A clean full gate after the
  overlap remains pending; do not describe the latest gate attempt as green.


## 2026-09-23 Collaboration task-scope review gap (resolved later the same day)

- Agent Core already normalizes the task graph and synchronously resolves all
  `toolAllowlistForTask` scopes before creating any workspaces. This is a strong
  enforcement boundary for a user-reviewed map, but the CLI's current constant
  resolver applies only the same global ceiling to every worker.
- `startCollaborativeExecution` currently plans and immediately calls
  `createCollaborativeExecution`; both readline and Ink run this callback from a
  scheduled team task. The shared `QuestionBox.ask` prompt is available in this
  closure once the interactive loop starts, so a post-plan preflight can collect
  per-task scopes before the core execution call without moving tool policy into
  planner output or creating workspaces early.
- The proposed opt-in config is `collaboration.reviewTaskToolScopes: true`. For
  each normalized task, display bounded/sanitized task details and the exact
  effective tool ceiling; require the user to choose `all`, `none`, or exact
  comma-separated names, then confirm the complete mapping. Bind selections to
  the just-reviewed task IDs and pass a caller-owned resolver over that immutable
  map. The global `collaboration.toolAllowlist`, if present, remains a hard upper
  bound; the feature must not derive authorization from task ID, role, title, or
  instructions. Decline/cancel must occur before any workspace creation.
- At this checkpoint this remained the next in-scope Gemini-aligned capability;
  it was resolved later the same day by the implementation and verification in
  “Hardened post-plan collaboration scope review” below.


## 2026-09-23 Hardened post-plan collaboration scope review

- The CLI normalizes and freezes the planner task graph, shows each task's instruction text during scope selection after terminal
  sanitization and credential-shaped value redaction, then confirms the complete ordered graph,
  dependency slots, selected tools, and plan fingerprint before starting workers.
- User grants are stored by ordered task index, never keyed by planner IDs. The
  SHA-256 fingerprint covers normalized order, IDs, titles, roles, instructions,
  dependencies, and retry overrides. Agent Core re-normalizes the execution
  graph and checks the fingerprint and complete scope-slot coverage before any
  workspace creation.
- The optional `collaboration.toolAllowlist` remains a hard ceiling. Unknown,
  duplicate, malformed, or unavailable tool names are rejected before side
  effects. Review prompts and choices are bounded; terminal control content is
  sanitized, sensitive text is redacted, invalid choices are capped, and
  cancellation/interruption/declined confirmation fail closed.
- Focused verification after implementation and prompt-budget hardening: CLI
  scope-review tests **9/9**, CLI collaboration integration tests **11/11**, Ink
  prompt-controller tests **4/4**, Agent Core tests **200/200**. The final
  `pnpm verify:typescript --report` gate passed, including workspace build,
  typecheck/tests, package-install smoke, release/preview/CI contracts,
  documentation contracts **57/57**, and native Desktop contracts **2/2**.
  Key package totals were CLI **618/618**, Desktop **211/211**, Agent Core
  **200/200**, and Tools **159/159**. `git diff --check` passed.


## 2026-09-23 Documentation index status audit

- `docs/README.md` incorrectly described the fully checked v0.1.5–v0.4.0 plan as
  the active execution checklist and called formal v0.1.8 release preparation
  still gated, despite `docs/next-roadmap-plans-v62-plus.md` recording the
  release as complete. Corrected both claims and kept current workspace status
  sourced from root `task_plan.md`, `progress.md`, and `findings.md`.
- Two separate plans reuse the v65 label: `day-plan-v65.md` records completed
  Scheme A workbench polish, while the next-roadmap's executor-capability /
  execution-state UX candidate remains deferred. Added an explicit scope note so
  completion of one is not mistaken for delivery or activation of the other.
- Added documentation contracts for the completed historical checklist and
  distinct v65 scopes. `node --test tests/documentation-contract.test.mjs` passes
  **59/59**; `git diff --check` passes.


### Cross-runtime verification evidence (2026-09-23)

- `pnpm verify:rust --report` passed `cargo fmt --check`, Clippy with warnings
  denied, **48** Rust library tests, **6** binary tests, and doc tests.
- `pnpm verify:integration --report` passed **11/11** real Rust executor tests
  for policy enforcement, filesystem/network boundaries, timeout, resource
  limits, output quotas, cancellation, and concurrency.
- Together with the TypeScript gate and the final 59/59 documentation rerun,
  this provides passing evidence for all three repository gate modes. It does
  not substitute local macOS results for the separate Linux hosted `bwrap` CI job.

## 2026-09-23 Generic tool risk classification audit — resolved

- `AgentToolRegistry` now defaults tools without explicit trusted metadata to
  `risk: "dangerous"` / `confirmation: "always"`; explicit built-in metadata
  remains unchanged. Plan mode denies tools that are mutating or lack an
  explicit read-only classification, while preserving the documented
  read-only inspection exceptions.
- Generic approval requests receive the normalized risk and confirmation
  values from the registry. Approval policy decisions therefore use trusted
  registration metadata rather than guessing from tool-name prefixes.
- CLI and Desktop MCP action wrappers are explicitly dangerous and always
  confirmed. Their host-side resource and prompt wrappers are explicitly
  read-only. Server-provided annotations do not override these classifications;
  the fake MCP server advertises a read-only hint on an action as a regression
  against trusting untrusted server metadata.
- Regression coverage verifies fail-closed defaults, trusted metadata at the
  approval callback, plan-mode denial, and CLI/Desktop MCP action gating. The
  Agent Core suite passes **211/211**, focused plan-mode tests **8/8**, and the
  CLI and Desktop MCP integration tests **2/2** each.
- The first release-gate attempts exposed an npm registry timeout while fetching
  `widest-line-6.0.0.tgz`; this affected only package installation, not risk
  classification behavior. The package smoke now accepts an explicit trusted
  npm cache through `DEV_AGENT_PACKAGE_SMOKE_NPM_CACHE`, while keeping its
  temporary HOME and proxy isolation unchanged.
- Reusing the populated local npm cache made the CLI package smoke pass and
  allowed `pnpm verify:typescript --report` to complete successfully. The latest
  full gate passed structure, build, typecheck, serial workspace tests (CLI
  **629/629**), package smoke, release/preview/CI contracts, documentation
  contracts **60/60**, and native Desktop contracts **2/2**.

## 2026-09-23 Anthropic SDK adoption finding

- `@anthropic-ai/sdk@0.126.0` is now a used runtime dependency of
  `@dev-agent/model`, not a manifest-only addition. The official client is
  wrapped at the provider boundary rather than exposed to CLI/Desktop callers.
- The SDK's own retry loop is disabled (`maxRetries: 0`) so the repository's
  `withRetry` contract remains authoritative. API errors are normalized back to
  the existing `ModelRequestError` shape, preserving status, bounded/redacted
  detail, Retry-After, and network-error retry behavior.
- The SDK consumes response bodies internally, so the injected fetch seam now
  bounds successful JSON and error bodies before returning SDK-visible
  responses. Streaming responses are transformed through a bounded SSE body to
  preserve line-size and cancellation guarantees.
- The official SDK expects SSE `event:` names. The adapter supports the official
  event envelope and retains structural compatibility for existing bounded
  data-only fixtures/proxies, including legacy payloads that omit `type`; no
  provider API shape changed.
- Claude Agent SDK adoption is now available as an optional package. Its native
  host-capability surface remains disabled; the adapter routes allowlisted
  project tools through the existing approval/sandbox contracts, and the
  platform-native runtime is kept out of the default CLI bundle.


## 2026-09-23 Claude Agent SDK adapter

- Added optional `@dev-agent/claude-agent-sdk` integration. It disables native
  tools, uses an allowlisted `mcp__dev_agent__*` in-process MCP server, sets
  `settingSources: []` and `strictMcpConfig: true`, and routes every call
  through the existing `ApprovalPolicy` and `ToolExecutionContext`.
- The adapter is not imported by the default single-file CLI bundle because
  the SDK carries a platform native runtime and is an explicit backend choice.


## 2026-09-24 final adapter verification

- The optional Claude Agent SDK package builds and typechecks with the workspace
  and its focused suite passes **7/7**. The full TypeScript release gate passed
  with the default CLI bundle still excluding the platform-native Agent SDK
  runtime.

## 2026-09-24 Claude Agent SDK MCP execution-boundary hardening

- The installed Claude Agent SDK types document `canUseTool` as a callback
  before tool execution, but its in-process MCP handler is an independent
  Model Context Protocol execution seam and does not receive the SDK
  `toolUseID`. The adapter therefore no longer treats the callback as its only
  permission boundary.
- The MCP handler now enforces the existing `ApprovalPolicy` itself when no
  matching preflight result exists. A bounded one-use canonical-input binding
  carries an allow/deny result from `canUseTool` into the handler, preserves a
  reviewed `updatedInput`, and keeps a cached denial from being replaced by a
  second policy decision.
- Pending bindings are capped at 256, expire after five minutes, and only use
  canonical JSON inputs up to 1 MiB before SHA-256 fingerprinting. Unbindable
  input or capacity exhaustion fails closed. Real MCP `Client`/`InMemoryTransport`
  tests cover approval denial/allow, reviewed input, direct handler execution,
  bounded failures, allowlist isolation, and cancellation context forwarding.
- Focused adapter verification is now **12/12**. Serial workspace build,
  typecheck, and tests pass; the full release gate must be rerun after the
  documentation update.

## 2026-09-24 Claude Agent SDK post-hardening verification

- The full TypeScript release gate passed after the MCP handler enforcement,
  bounded authorization binding, real transport regressions, and documentation
  sync. The optional package participates in workspace build/typecheck/tests,
  while the default CLI bundle still excludes the platform-native Agent SDK
  runtime.
- Current evidence: Claude adapter **12/12**, CLI **629/629**, Desktop
  **222/222**, documentation **60/60**, native Desktop **2/2**, CLI tarball
  package smoke, and `git diff --check` all pass.

## 2026-09-24 Claude Agent SDK lifecycle cleanup

- Pending preflight approvals are now explicitly cleared from the bridge at
  the end of `runClaudeAgentSdk()` and can be cleared by an embedding host.
  This prevents an approved-but-never-executed input from being reused after a
  query has ended. Focused adapter evidence is **13/13**.

## 2026-09-24 Next-nine Desktop browser findings

- The initial Desktop bootstrap invoked workspace/terminal/capability refreshes
  before `loadSessions()` had selected the active session. A reload could
  therefore show an empty terminal selector and capabilities stuck in loading
  even though the APIs were healthy. The bootstrap now serializes session load,
  session view restoration, workspace refresh, terminal refresh, and the final
  capabilities request.
- The external stylesheet did not define `--assistant-bg`; the legacy inline
  fallback stayed light in dark mode, producing a low-contrast capability and
  runtime panel. Theme-scoped tokens now define readable dark/light values.
- Preview acceptance used a tiny loopback static page on an explicit port. The
  iframe deliberately keeps an opaque sandbox origin (`allow-scripts
  allow-forms`, no `allow-same-origin`); loading the Desktop app itself inside
  that frame emits expected module CORS errors, so the QA evidence uses a plain
  local preview fixture and preserves the isolation boundary.

## 2026-09-24 Claude Agent SDK lifecycle-cleanup final finding

- The final green gate confirms that explicit cleanup of unused preflight
  authorizations does not regress the optional adapter, default CLI bundle,
  Desktop, packaging, or documentation contracts.
- Current verified counts are Claude adapter **13/13**, CLI **629/629**,
  Desktop **222/222**, documentation **60/60**, and native Desktop **2/2**;
  package smoke and `git diff --check` also pass.
- The working tree remains intentionally uncommitted and unpublished.
