# Progress

## 2026-09-17

- Restored context from repository docs and confirmed `@agent_cli/cli@0.1.6`
  has a GitHub Release while npm `latest` remains `0.1.5`.
- Selected Desktop managed-runtime visibility as the first non-CLI project slice.
- Implemented the safe managed-runtime status snapshot, API merge, and Desktop
  panel row.
- Desktop focused tests passed **86/86**.

## 2026-09-18

- Re-inspected the worktree and confirmed the missing type import noted in the
  handoff had already been fixed.
- Rebuilt all workspace packages successfully.
- Desktop focused tests passed **88/88**.
- Runtime-manager focused tests passed **14/14**.
- Full `pnpm verify:typescript` passed, including all workspace tests, CLI
  package smoke, preview contracts, and TypeScript documentation contracts.
- Marked both current task-plan phases complete without publishing, tagging,
  pushing, or starting the next release.

## 2026-09-20

- Started the next eight-hour development slice from the completed native
  desktop milestone.
- Re-read the current input-boundary audit and identified five active `FIX`
  findings: MCP error frames, CLI session listing, doctor subprocess output,
  Rust probe framing, and FilesystemTool writes/postimages.
- Confirmed the worktree already contains an in-flight MCP error-response
  change; it remains preserved while the next tasks use disjoint files.
- Saved the executable plan in
  `docs/superpowers/plans/2026-09-20-eight-hour-hardening.md`.

## 2026-09-20 hardening progress

- Closed the five reproducible input-boundary findings with RED/GREEN tests:
  bounded MCP error responses, newest-256 CLI session JSON, capped doctor
  subprocess output/Rust probe frames, and 16 MiB FilesystemTool writes and
  postimages.
- Updated the CLI session-list contract to
  `{ sessions, truncated, total }` and documented the 64 KiB/8 MiB/16 KiB
  doctor limits and 16 MiB filesystem write limit.
- Focused evidence is green for MCP (66/66), tools (145/145), Agent Core
  (134/134), Desktop (138/138), Model (66/66), Runtime Manager (23/23), and
  Rust (54/54 unit tests plus doc tests).
- The full CLI suite passed **383/383**, including the bounded session-list
  envelope and doctor overflow cases. The workspace `pnpm verify` gate passed,
  including documentation contracts **57/57**, CLI package smoke, preview
  contracts, and real Rust integration **11/11**.
- Native macOS verification passed: Swift package tests **8/8**, launcher
  verification succeeded without a residual app process, and `Info.plist`
  lint passed.
- The five reproducible audit findings are closed. The four
  `NEEDS-EVIDENCE` rows remain open; this is a verified development state,
  not a release authorization.

## 2026-09-20 input-boundary closure

- Implemented the shared 16 MiB UTF-8 cumulative stream budget across OpenAI,
  Anthropic, Gemini, and Ollama, including reader cancellation and tool-call
  fragment accounting.
- Added code-search and CLI index discovery limits of 100,000 eligible files
  and 256 MiB of eligible source bytes, with no partial cache/index install.
  Oversized 16 MiB serialized write-back preserves the previous valid index.
- Replaced rollback directory materialization with early-exit `opendir()`
  iteration and preserved the existing conflict behavior.
- Added a 4 KiB UTF-8 CLI approval boundary. Overflow denies safely, cleans up
  listeners, and closes non-TTY input so a one-shot producer without EOF does
  not hang.
- Focused evidence is green: model 72/72, Agent Core 134/134, tools 151/151,
  and CLI 392/392. Task-level reviews are clean; the documented
  normal-newline/open-non-TTY compatibility observation remains parked.

## 2026-09-20 final verification

- Rebuilt the full TypeScript workspace and passed `pnpm verify`.
- Final counts: CLI 392/392, Desktop 138/138, model 72/72, tools 151/151,
  documentation contracts 57/57, Rust unit/bin/doc tests 54/54, and real Rust
  integration 11/11.
- Swift package tests passed 8/8. Native launcher verification passed without
  leaving an app process behind; `Info.plist` lint and `git diff --check`
  passed.
- Pushed `codex/desktop-cli-workbench` to GitHub at `7c35d79`. No npm
  publish, tag, or GitHub Release was performed.
- Final whole-branch review of `e1ebee8..b92eb7a` was clean with no Critical
  or Important findings. The two Minor observations were addressed before
  delivery.

## 2026-09-20 native macOS local bundle polish

- Saved and executed
  `docs/superpowers/plans/2026-09-20-native-macos-local-bundle-polish.md`.
- The native launcher now generates `SignalLoom.icns` from
  `apps/desktop/public/signal-loom.svg` and records it in the staged
  `Info.plist`.
- Added `./script/build_and_run.sh --package`, which creates the
  checkout-bound `dist/Signal Loom Desktop-local.zip` and
  `dist/Signal Loom Desktop-local.zip.sha256` without launching the app.
- Native bundle contract tests passed **2/2**; Swift package tests passed
  **8/8**; the staged app passed `/health` launch verification and left no
  residual native app or child Desktop server process.
- `pnpm build` passed and the complete `pnpm verify` gate passed with CLI
  **392/392**, Desktop **138/138**, model **72/72**, tools **151/151**,
  documentation **57/57**, native bundle contract **2/2**, Rust
  unit/bin/doc tests **54/54**, and real Rust integration **11/11**.
- Archive contents and the SHA-256 sidecar were verified from `dist/`.
- No npm publish, tag, GitHub Release, signing, notarization, or package
  upload was performed.

## 2026-09-20 runtime events and Ink CLI

- Added the versioned `@dev-agent/runtime-events` contract and projected
  AgentLoop events into the CLI and Desktop adapters.
- Added FileMemory-backed metadata checkpoints, bounded Skills and Hooks
  registries, and explicit tool risk, confirmation, result-format, and
  progress metadata.
- Made Ink 6/React 19 the default rich TTY renderer while preserving the ANSI
  compatibility renderer behind `DEV_AGENT_TUI=ansi`. The composer now keeps
  active input separate from queued prompts, preserves prompt/answer ownership,
  and ignores replayed runtime sequences so redraws do not duplicate visible
  frames.
- Added PTY behavior evaluations for queueing, streaming, approval/tool loops,
  idle Ctrl-C, ANSI resize/commands, and EOF.
- Focused evidence passed: CLI **406/406**, Agent Core **143/143**, tools
  **152/152**, runtime-events **3/3**, and behavior evals **5/5**. CLI package
  smoke also passed. No npm publish or release was performed.

## 2026-09-20 on-demand Skills and modular Prompt

- Saved the executable plan in
  `docs/superpowers/plans/2026-09-20-skill-activation-and-prompt-modules.md`
  based on the Gemini CLI architecture study.
- Connected the bounded `SkillRegistry` to the interactive CLI. `:skills` and
  `:skill <name>` (or `/skills` and `/skill <name>`) now work in both ANSI and
  Ink sessions; `:skill off` removes the session activation.
- Added explicit Prompt wrapping so only the selected skill instructions reach
  later model requests. Terminal output shows names, descriptions, and scope,
  never skill paths or raw instruction bodies.
- Focused Skill adapter, ANSI integration, Ink command, and renderer hint tests
  are green. The full CLI suite passed **419/419** and the PTY behavior
  evaluations passed **6/6**. `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 sandbox expansion approval

- Saved and completed
  `docs/superpowers/plans/2026-09-21-sandbox-expansion.md`.
- Rust executor policy denials now become typed `SandboxDeniedError` values
  while preserving the existing `POLICY_DENIED` compatibility code.
- Agent Core now emits separate sandbox expansion request/resolution events,
  asks the application edge for a decision, and retries the original tool call
  at most once with the approved profile.
- Built-in profile expansion is deliberately narrow: it can enable network
  access while preserving all workspace paths, environment, timeout, and
  other restrictions. Path expansion and arbitrary policy scripts are denied.
- CLI and Desktop reuse their existing approval channels. Non-interactive CLI
  and MCP server paths fail closed without waiting for stdin or an unavailable
  client.
- TUI approval cards now resolve by identity, so ordinary approvals and
  sandbox expansion prompts cannot close each other's cards.
- Final verification passed: Agent Core **176/176**, Executor **57/57**,
  Tools **159/159**, CLI **450/450**, Desktop **144/144**,
  `pnpm verify:typescript`, and `git diff --check`.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 tool-level sandbox execution

- Added a provider-neutral `ToolSandboxProfile` to Agent Core and an optional
  per-tool resolver on `AgentLoopOptions`.
- Added one executor adapter for Shell, Git, and Search. Profiles now require
  `runSandboxed()` and fail closed when an executor cannot enforce them.
- Added fixed workspace profiles: Search is read-only with network disabled;
  Shell and Git can write only inside the current working directory.
- Wired profiles into CLI, Desktop, and direct CLI MCP tool calls when the
  selected executor supports Rust sandboxing. Local execution remains the
  default.
- Added deterministic Rust executor cleanup at CLI, Desktop, and MCP session
  boundaries after the integration test exposed a lingering child process.
- Updated the Gemini CLI architecture alignment plan and package/architecture
  docs.
- Final verification passed: Agent Core **174/174**, Tools **158/158**,
  Executor **56/56**, CLI **444/444**, Desktop **144/144**, MCP **69/69**,
  rich CLI behavior evaluations **6/6**, `pnpm verify:typescript`, and
  `git diff --check`.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 local Scheduler and background-task lifecycle

- Saved the executable plan in
  `docs/superpowers/plans/2026-09-21-scheduler-background-tasks.md`.
- Added the bounded Agent Core `AgentTaskScheduler`: FIFO queueing,
  concurrency-one defaults, `queued`/`running`/
  `waiting-for-confirmation`/terminal states, cooperative cancellation, and
  at-most-64 terminal snapshots. Task snapshots reject unsafe ids, redact
  absolute paths from details, and never include prompts, model output, tool
  arguments, or raw runner errors.
- Added `:tasks` and `:task <id>` plus slash aliases to ANSI and Ink. Each
  consumed interactive prompt is wrapped in one local task while the existing
  prompt queue remains authoritative for ordering.
- Scheduler tests passed **7/7**, the CLI task-command tests passed **4/4**,
  and the full CLI suite passed **439/439**. The final gate also caught and
  closed three adjacent regressions: attachment metadata assertions now match
  the bounded contract, directory traversal no longer double-closes its
  handle at the file limit, and Ink command suggestions are exercised through
  the real default command set.
- Agent Core passed **167/167**, Desktop passed **143/143**, and Tools passed
  **152/152**. Rich behavior evaluations passed **6/6**. The fixed
  `pnpm verify:typescript` gate passed, including package-install smoke,
  documentation and release-boundary contracts; `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-20 metadata-only Extension Registry

- Saved the executable plan in
  `docs/superpowers/plans/2026-09-20-extension-registry.md`.
- Added bounded `ExtensionRegistry` discovery for project
  `.dev-agent/extensions/<id>/extension.json` and user
  `~/.dev-agent/extensions/<id>/extension.json` manifests. Project scope
  shadows user scope by id, malformed or oversized manifests are ignored, and
  public metadata contains no filesystem paths.
- Added `:extensions` and `:extension <id>` plus slash aliases to the ANSI and
  Ink interactive command paths. The commands report only name, version,
  scope, description, and bounded surface counts; they never execute
  extension-declared code or start MCP.
- Core registry tests and CLI command tests are green. Final verification
  passed: Agent Core **158/158**, CLI **429/429**, Desktop **143/143**,
  Tools **152/152**, rich CLI behavior evaluations **6/6**, the fixed
  `pnpm verify:typescript` gate, and `git diff --check`.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-20 shared Prompt composition

- Saved the executable plan in
  `docs/superpowers/plans/2026-09-20-shared-prompt-composition.md`.
- Added the shared Agent Core `PromptModule` and deterministic
  `composePrompt` contract. Empty and disabled sections are omitted and
  duplicate active IDs fail closed.
- Extracted the CLI's existing evidence, audit, language-specific, guardrail,
  and response-contract guidance into named modules without removing the
  existing requirements.
- Composed the active Skill and MCP sections as optional runtime modules.
- Updated Desktop to use the shared default Prompt composer while preserving
  caller-provided Prompt text before AgentLoop's existing runtime metadata.
- Agent Core Prompt tests, CLI build/typecheck/full suite, Desktop build, and
  the Desktop Prompt contract test are green.
- Final evidence is green: Agent Core **148/148**, CLI **419/419**, Desktop
  **140/140**, Tools **152/152**, CLI behavior evaluations **6/6**,
  documentation contracts **57/57**, and the fixed
  `pnpm verify:typescript` gate.
- `git diff --check` passed. No npm publish, tag, release, or network package
  operation was performed.

## 2026-09-20 Hooks and metadata-only run observability

- Activated timestamped Agent Core lifecycle Hooks for model and tool
  operations, including stable operation correlation and provider usage
  metadata.
- Added bounded `AgentRunTrace` snapshots that retain only run/span status,
  timing, turn counts, sanitized tool names, and token totals. Prompts,
  answers, tool arguments/results, paths, environment values, and credentials
  are excluded.
- Connected one trace collector to each CLI/Desktop session. Interactive CLI
  sessions now support `:trace` and `/trace`; Desktop exposes the additive
  `GET /api/sessions/<sessionId>/trace` endpoint.
- Added the implementation plan and
  [`docs/trace-observability.md`](trace-observability.md), including the
  retention and local-only release boundary.
- Agent Core passed **153/153**, CLI **420/420**, and Desktop **143/143**.
  `pnpm verify:typescript`, `pnpm test:evals` (**6/6**), and
  `git diff --check` all passed.
- No npm publish, tag, release, telemetry upload, or network package release
  was performed.

## 2026-09-20 live TTY scrollback hardening

- Reproduced the large blank viewport and missing scrollback in a real Ink
  render using a short terminal height.
- Confirmed the cause was the launch welcome being part of the dynamic frame;
  when that frame reached terminal height, Ink used its clear-terminal path,
  including the scrollback erase sequence.
- Moved the launch welcome into one-time static output and left only the
  active transcript, status, composer, and footer in the dynamic viewport.
- Added a TTY regression covering the clear-terminal sequence. The focused
  regression passed after the fix.
- Merged the welcome and completed transcript into one root-level Ink `Static`
  sequence, then verified the compact-layout, queue, approval, cancellation,
  EOF, resize, and command-panel behavior.
- Final verification passed: CLI **421/421**, Desktop **143/143**, Tools
  **152/152**, behavior evaluations **6/6**, documentation contracts **57/57**,
  `pnpm verify:typescript`, and `git diff --check`.

- Follow-up on 2026-09-21: guarded Ink against PTY startup reports of
  `rows=0`/`columns=0`. Before this fix Ink interpreted every frame as
  full-screen and emitted the clear-terminal sequence, which erased scrollback
  and made the lower composer appear detached by a large blank area.
- Added resize-time normalization and a regression assertion in the real Rich
  TUI queue evaluation. The local PTY now emits zero clear-terminal sequences
  during startup.

## 2026-09-20 session checkpoint rewind

- Added a typed `CheckpointStore.rewind()` operation and memory-level anchor
  validation for `FileMemory` and `InMemoryMemory`.
- Rewind truncates only conversation entries, clears summaries that cover
  discarded entries, retains evidence metadata, removes later invalid
  checkpoints, and never touches workspace files or before-images.
- Added `:checkpoint`, `:checkpoints`, and `:rewind <checkpointId>` with slash
  aliases to both ANSI and Ink command paths. Successful rewind explicitly
  reports `workspace unchanged`.
- Added core persistence/stale-anchor tests, command formatter tests, and a
  real interactive CLI persistence regression.
- Final verification passed: Agent Core **155/155**, CLI **425/425**, rich CLI
  behavior evaluations **6/6**, the fixed `pnpm verify:typescript` gate,
  package install smoke, release-boundary contracts, documentation contracts,
  and `git diff --check`.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 Desktop MCP capability parity

- Audited the Gemini CLI architecture study against the current worktree.
- Confirmed that `@dev-agent/mcp` already owns tools/resources/prompts,
  notifications, resource watchers, reconnect, and bounded session snapshots.
- Confirmed the concrete gap: CLI registers all MCP capability types, while
  Desktop currently registers only MCP tools and owns raw stdio clients.
- Added the shared bounded MCP resource/prompt capability formatter and reused
  it from both CLI and Desktop.
- Changed Desktop to own `McpServerSession` instances, register native tools
  plus resource/prompt adapter tools, refresh its Agent capability set after
  MCP list-change notifications, and close owned sessions deterministically.
- Added a Desktop end-to-end regression proving that MCP resource contents flow
  back into the model and remain attached to the correct tool result.
- Completed the execution plan in
  `docs/superpowers/plans/2026-09-21-desktop-mcp-capability-parity.md`.
- Final verification passed: MCP **70/70**, Agent Core **168/168**, CLI
  **442/442**, Desktop **161/161**, Tools **152/152**, rich CLI behavior
  evaluations **6/6**, `pnpm verify:typescript`, and `git diff --check`.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 Unified Tool Registry and Shared Approval Policy

- Made `@dev-agent/agent-core` the canonical owner of the Agent Tool
  contract, metadata normalization, and registry behavior. The historical
  `@dev-agent/tools` `ToolRegistry` export remains available as a compatibility
  subclass without changing public tool names or execution behavior.
- Added the Agent Core `createApprovalPolicy()` factory for `allow`,
  `deny-dangerous`, `ask`, and `review-writes`. CLI, Desktop, and MCP now keep
  their prompt, review, and session-memory adapters at the application edge
  while sharing the same policy selection and fail-closed behavior.
- Added focused contract tests for registry compatibility and all approval
  modes. Final verification passed: Agent Core **173/173**, Tools **153/153**,
  CLI **442/442**, Desktop **144/144**, MCP **69/69**, rich CLI behavior
  evaluations **6/6**, `pnpm verify:typescript`, and `git diff --check`.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 active prompt scrollback

- Submitted prompts now move into Ink static scrollback as soon as their run
  starts. The live repaint region keeps only the active assistant response,
  status, composer, and footer.
- Added a regression proving that a submitted prompt is rendered exactly once
  before its answer completes, preventing duplicate prompt/answer frames and
  the tall blank viewport seen in earlier TTY screenshots.
- Follow-up verification passed: CLI **443/443**, Agent Core **173/173**,
  Tools **153/153**, rich CLI behavior evaluations **6/6**, and
  `git diff --check`.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 read-only session history

- Added `:history [count]` and `/history [count]` to both ANSI and Ink
  interactive CLI modes. It reads only the current persisted memory and shows
  the newest 10 entries by default, capped at 50.
- Added bounded formatting for user, assistant, tool, and system entries.
  Terminal control sequences are removed and credential-shaped values are
  redacted before display; malformed counts stay local usage errors and are
  never sent to the model.
- Added the shared Ink command-palette hint, ANSI help text, CLI README/root
  README documentation, focused formatter tests, and a real interactive
  persistence regression.
- Final verification passed: CLI **449/449**, Agent Core **176/176**, Tools
  **158/158**, Desktop **144/144**, rich CLI behavior evaluations **6/6**,
  `pnpm verify:typescript`, and `git diff --check`.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 shared Model Routing and streaming-safe fallback

- Added the provider-neutral `ModelRouter` to `@dev-agent/model` with a
  bounded, lazy fallback resolver and metadata-only fallback events.
- Migrated the CLI fallback adapter to the shared router while preserving its
  existing profile, alias, and provider-selection behavior.
- A failed non-streaming call, or a stream that fails before its first answer
  or reasoning token, may use the next explicit fallback. Once visible output
  is delivered, the original error is re-thrown so a partial answer is never
  replayed. Aborts never trigger a fallback.
- Verification passed: Model **80/80**, CLI focused fallback regression
  **3/3**, CLI **451/451**, rich CLI behavior evaluations **6/6**,
  `pnpm verify:typescript`, and `git diff --check`.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 ACP Agent Client Protocol bridge

- Saved the executable plan in
  `docs/superpowers/plans/2026-09-21-acp-agent-client-protocol.md` from the
  Gemini CLI architecture study's ACP integration boundary.
- Added the reusable `@dev-agent/acp` package on the official stable ACP v1
  SDK. The bridge owns NDJSON framing, connection-scoped session lifecycle,
  text prompt validation, cancellation, cleanup, and permission forwarding.
- Added in-process coverage for initialization/session creation, streamed
  updates, permission requests, cancellation, and unsupported prompt content.
- Added `dev-agent --acp --cwd <absolute-project>` and connected it to the
  existing provider, AgentLoop, memory, tools, executor, validation, approval,
  and MCP prompt-context boundaries. ACP mode does not start the Rich TTY
  renderer and keeps stdout protocol-only.
- Added a CLI subprocess smoke test for initialize/session/new and a real
  local Ollama-compatible streaming turn. Final verification is recorded
  below; no npm publish, tag, release, or network package operation is being
  done.

## 2026-09-21 Desktop background-run reconnect

- Added a bounded per-session run registry and
  `GET /api/sessions/<id>/run` replay endpoint with stable run ids,
  monotonic cursors, live fragments, and lifecycle summaries.
- Session switching now detaches the UI from the old stream without aborting
  it, reloads the selected transcript, and restores only that session's
  unfinished assistant/reasoning/tool/approval state.
- Replay data is metadata-safe: tool inputs, raw outputs, review diffs, and raw
  provider errors are omitted; retained events and live text are bounded.
- Added bilingual session run-state labels, cursor-based recovery polling, and
  focused server, UI contract, sanitization, retention, and terminal cleanup
  tests.
- Focused run-replay verification passed **6/6**; the complete Desktop suite
  passed **150/150** after the approval fixtures began closing their HTTP
  connections and MCP-backed sessions.
- Rendered browser smoke confirmed the English/Chinese toggle, bounded
  multiline composer behavior, and recovery of a second streamed fragment
  after switching away and back.
- The final serialized `pnpm verify:typescript` gate passed, including the
  workspace test, package-install smoke, release-boundary contracts, preview
  contracts, documentation contracts, and native Desktop bundle contracts.

## 2026-09-21 ACP and CLI lifecycle verification

- Completed the ACP v1 bridge verification: `@dev-agent/acp` passed **5/5**
  package tests, and the CLI subprocess smoke passed **2/2** with protocol-only
  stdout and a real provider turn.
- Fixed non-rich interactive EOF handling so closing stdin exits cleanly with
  code 0 while Ctrl-C keeps the conventional interrupted result.
- Stabilized the rich CLI behavior evaluation harness by sending the ANSI
  command with Enter and isolating optional user MCP configuration from the
  deterministic eval environment.
- Verified the current CLI test suite at **490/490**, Desktop at **150/150**,
  and rich CLI behavior evaluations at **6/6**.
- `pnpm verify:typescript` and `git diff --check` passed. No npm publish, tag,
  release, or network package operation was performed.

## 2026-09-21 A2A server boundary implementation

- Added the reusable `@dev-agent/a2a` package with a bounded A2A v1 Agent Card,
  JSON-RPC and SSE transport, task lookup/list/cancel handling, active-run
  cancellation, connection cleanup, metadata-safe text limits, optional bearer
  authentication, A2A-Version validation, same-context concurrency protection,
  and reasoning suppression by default.
- Connected `dev-agent --a2a` to the existing provider, AgentLoop, tools,
  memory, MCP prompt context, executor, validation, and approval boundaries.
  The mode binds to loopback by default, keeps stdout protocol-only, and
  reports only its startup line on stderr. Interactive approval is denied
  explicitly because the HTTP boundary has no human prompt channel.
- Added CLI subprocess coverage for Agent Card discovery, a real
  Ollama-compatible streaming turn, distinct context session keys, and live
  cancellation with provider stream closure, plus argument coverage for A2A
  host/port dependencies and incompatible `--json`/`--acp` modes.
- Final verification passes: A2A package **10/10**, CLI A2A subprocess
  **4/4**, CLI argument tests **19/19**, full CLI **513/513**, Desktop
  **150/150**, and rich CLI behavior evaluations **6/6**.
- `pnpm verify:typescript` passed all selected gates, including workspace
  build/typecheck/tests, CLI package install smoke, release/preflight
  contracts, preview contracts, documentation contracts, and native Desktop
  bundle contracts. `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

## 2026-09-21 next-phase plan: Rich TUI viewport navigation

- Audited the current Rich Ink implementation and the Gemini CLI architecture
  study after the A2A phase completed.
- Confirmed that the earlier scrollback hardening protects terminal history and
  duplicate-frame behavior, but does not provide interactive in-app navigation
  for long sessions.
- Created the executable plan at
  `docs/superpowers/plans/2026-09-21-rich-tui-viewport-navigation.md`.
- Registered the work as planned Phase 24 in `task_plan.md`.
- Scope is limited to viewport state, PageUp/PageDown/Home/End behavior,
  fixed composer/footer layout, streaming while scrolled, and focused
  regression coverage. No implementation or test run was performed in this
  planning step.
- The worktree remains broadly dirty from prior phases and concurrent work;
  no unrelated changes were reset, cleaned, or overwritten.

## 2026-09-21 Phase 24 implementation start

- Re-read the Phase 24 plan and current Rich Ink sources before editing.
- Added the first RED test at
  `apps/cli/tests/ink-viewport.test.ts`; it expects an explicit empty
  viewport snapshot at the live bottom.
- The focused contract currently fails because `InkRuntimeSnapshot` has no
  viewport state, confirming the test detects the missing behavior.
- The attempted package-level run executed the full CLI suite because its
  test-name argument was appended after the glob. It reported the intended
  viewport failure plus unrelated concurrent failures in `--resume` argument
  handling and session preview Unicode bounds. Those failures are recorded in
  the Phase 24 plan and are not being changed in this slice.
- The first Rich Ink integration compile found two local wiring errors:
  the narrowed static item type still had the old transcript branch, and the
  viewport hint used unsupported `Text.paddingX`. Both are scoped fixes.
- The viewport model and Rich Ink integration now compile; the four focused
  viewport tests pass.
- The old completed-transcript test failed because it asserted the previous
  Static-only contract. Its missing `finally` cleanup also left Ink mounted
  after the assertion and caused a hung test process. The next test edit will
  assert one visible copy plus explicit Home/PageUp/End navigation instead.
- After updating that contract, `ink-app.test.ts` reached **28/29**. The only
  failure was test sampling: Ink emitted the redraw in multiple ANSI writes,
  and the test inspected only the final cursor-control chunk.
- The pure viewport model now passes **4/4** focused tests, and the Rich Ink
  integration suite passes **29/29**. The transcript is rendered through one
  bounded dynamic viewport while the launch welcome remains static.
- Real Ink input coverage now proves Home reaches the oldest visible turn and
  End returns to the newest turn without leaving the composer or footer
  duplicated. PageUp/PageDown and streaming-while-scrolled remain the next
  focused additions.
- The long-session Ink regression now covers bottom -> PageUp -> Home,
  appending streamed output while manually scrolled, and End back to live
  output. The test passes when PageUp is exercised before Home; the earlier
  failure was an invalid navigation order, not a production defect.
- The current focused verification batch passes: viewport **4/4**, Ink app
  **29/29**, rich input **18/18**, runtime event adapter **4/4**, and both CLI
  source/test TypeScript compilations.
- Added the local `Ink viewport navigation` PTY evaluation. It builds the CLI,
  runs eight provider-stubbed turns, verifies PageUp/Home/End and hidden-row
  prompts in the real process, and passes **1/1** without network access.
- The first full `pnpm test:evals` run stopped in the existing queue case:
  the queue behavior itself reached its assertions, but the no-clear
  invariant found one `ESC[2J ESC[3J ESC[H` sequence at startup. This is now
  an active regression to diagnose; no assertion was weakened.

## 2026-09-22 Eight-hour continuation started

- Created the executable continuation plan at
  `docs/superpowers/plans/2026-09-22-eight-hour-continuation.md`.
- The first target is the unresolved Rich TUI PTY startup-clear regression;
  implementation is intentionally paused until the first-render terminal
  dimensions and raw PTY bytes are traced.
- The remaining target is to complete Phase 24's resize and interaction
  evidence, then leave a separate bounded Desktop next-slice plan based on
  current source and tests.

## 2026-09-22 Rich TUI viewport closure

- Captured the raw PTY clear sequence and confirmed it was emitted by Ink's
  fullscreen threshold when the dynamic frame reached the real terminal row
  count. The welcome replay was a consequence of that clear, not a second
  transcript source.
- Added `createInkRenderOutput()` with a one-row virtual height guard. Ink
  receives the guard for fullscreen detection while `InkCliApp` receives the
  real row count for layout, so the composer/footer do not gain an artificial
  blank region.
- Added the full-frame no-clear Ink regression and terminal-size guard tests.
- Added a positive PTY resize assertion to the long-session viewport case.
- Verification completed:
  - Ink app: **30/30**
  - viewport, input, runtime adapter focused batch: **26/26**
  - Rich PTY evaluations: **8/8**
  - CLI full suite: **534/535**, with one existing
    `index-refresh SIGINT` signal assertion failure
- `pnpm verify:typescript` and final `git diff --check` remain outstanding.

## 2026-09-22 Eight-hour continuation closed

- Re-ran the isolated queue evaluation three times; all **3/3** runs passed.
- The complete Rich TUI evaluation passed **8/8**, including the new positive
  resize case at 12x52 and 30x100.
- Added an Ink integration regression that normalizes a zero-dimension
  terminal before mounting the incremental renderer and asserts no live
  terminal-wide clear.
- Focused Ink/viewport/terminal-size coverage passed **35/35**; Desktop passed
  **150/150**; the repeat full CLI suite passed **536/536**.
- The final `pnpm verify:typescript` workspace gate and `git diff --check` both
  passed. The next executable Desktop plan is
  `docs/superpowers/plans/2026-09-22-desktop-next-slice.md`, scoped to a
  localized “new output below / jump to latest” affordance.

## 2026-09-22 Desktop live-scroll recovery affordance completed

- Completed the Desktop slice from
  `docs/superpowers/plans/2026-09-22-desktop-next-slice.md`.
- The conversation stream now has a localized `#jump-to-latest` control and
  one pending-output state that preserves manual scroll position during live
  reasoning, token, tool, approval, validation, and error updates.
- Pending output clears at the bottom or on jump, and resets during history
  loads, session switches, new sessions, and deletion.
- Desktop suite: **150/150**.
- Rich TUI evaluations: **8/8**.
- CLI suite: **536/536**.
- `pnpm verify:typescript`: all selected gates passed.
- `git diff --check`: passed.

## 2026-09-22 Desktop fixed-port lifecycle completed

- Added a bounded Desktop launcher probe for the configured endpoint.
- A healthy existing dev-agent workbench on `127.0.0.1:4317` is reused; the
  entrypoint never silently advances to `4318` or `4319`.
- An unrelated process occupying the requested port now produces an explicit
  fixed-port error and leaves port selection to the user.
- Added process-level coverage for both reuse and unrelated-port refusal.
- Port lifecycle tests: **2/2**.
- Desktop suite: **152/152**.
- Re-ran the final workspace TypeScript gate with the test subprocesses
  isolated from the user-level MCP configuration; all selected gates passed.
- The JSON CLI test harness now supplies an empty MCP override by default, so
  local `~/.dev-agent/config.json` entries cannot turn provider-free tests into
  30-second external MCP probes.
- CLI suite: **538/538**.
- `git diff --check`: passed.

## 2026-09-22 Final workspace gate closure

- Workspace build and TypeScript typecheck passed.
- CLI suite: **538/538**.
- Desktop suite: **152/152**.
- CLI package install smoke passed.
- Preview, release-contract, workflow-contract, documentation-contract, and
  native Desktop bundle checks all passed.
- No npm package was published, tagged, or released.

## 2026-09-22 Phase 29 planning: Desktop message queue and turn isolation

- Audited the current Desktop submit, stream, history, and background-replay
  paths after the Rich TUI queue and viewport phases closed.
- Confirmed the concrete gap: a second prompt submitted during an active
  Desktop run is currently discarded by the browser, while the server only
  provides a `409` single-flight guard.
- Confirmed the rendering risk: assistant, reasoning, and tool-progress
  references are page-global, so replay or a later prompt can update the
  wrong visible response region.
- Created the executable plan at
  `docs/superpowers/plans/2026-09-22-desktop-message-queue-and-turn-isolation.md`.
- Registered the work as planned Phase 29 in `task_plan.md`.
- Scope is limited to a bounded browser-owned FIFO queue, turn-owned
  rendering, replay idempotency, and focused Desktop regressions. No
  server-side queue persistence, SSE schema change, CLI rewrite, package
  publish, or network release is planned.
- No implementation or test run was performed in this planning step.

## 2026-09-22 Phase 29 implementation and recovery closure

- Added a bounded per-session FIFO prompt queue with visible queued turns,
  removal, clear-waiting, resume, and pause behavior for failure or abort.
- Moved reasoning, assistant output, tool progress, approvals, validation,
  errors, retries, and terminal state into turn-owned rendering.
- Added replay sequence guards and session-specific background-run recovery.
- Fixed the observed switch-away/switch-back gap: when a completed background
  run has not reached persisted history yet, its bounded run events rebuild the
  original prompt, reasoning, tools, and assistant output on return.
- Added an explicit per-turn terminal ledger: `done`/`error` closes the turn
  before the stream teardown finishes, and late frames are ignored.
- Provider-stubbed browser smoke passed for FIFO ordering, turn isolation, and
  background completion recovery and post-terminal late-frame rejection on an
  ephemeral local port.
- Desktop suite passes **161/161**; the focused run-replay UI regression passes
  **1/1**. The CLI suite passes **543/543**, Rich TUI evaluations pass
  **8/8**, `pnpm verify:typescript` passes all selected gates, and
  `git diff --check` passes.

## 2026-09-22 Rich TUI sparse viewport and wheel-scroll hardening

- Removed the large sparse active-turn viewport by keeping the launch welcome
  static and routing completed and active turns through one bounded dynamic
  transcript viewport.
- Added terminal mouse-wheel scrolling with SGR and legacy X10 parsing, plus
  symmetric mouse-tracking cleanup when the Rich TUI exits.
- Preserved PageUp/PageDown/Home/End navigation and kept the composer, status,
  and workspace footer outside the transcript viewport.
- Focused Ink/viewport/mouse-wheel coverage: **41/41**.
- CLI suite: **543/543**.
- Rich TUI evaluations: **8/8**.
- Desktop suite: **161/161**.
- Workspace build/typecheck and `git diff --check` passed.
- The aggregate `pnpm verify:typescript` retry was stopped after the existing
  MCP-server test produced no output for an extended period; it is not counted
  as a passing aggregate gate.
- No package publish, tag, release, or network package operation was performed.

## 2026-09-22 CLI startup interrupt race closure

- Reproduced the provider-free `index refresh` SIGINT failure under concurrent
  Desktop and CLI test load: the child could receive SIGINT before the heavy
  command module had installed its handler, so Node reported `signal: "SIGINT"`
  instead of the stable cancelled result.
- Added a lightweight `cli-entry` bootstrap that installs the interrupt handler
  before dynamically loading the command implementation. `index refresh` now
  consumes that early abort signal and still preserves the previous index.
- The CLI suite passes **543/543**, the focused startup-interrupt regression
  passes under concurrent Desktop load, and the npm CLI package smoke passes.
- The final `pnpm verify:typescript` aggregate gate passes all selected
  workspace, package, Desktop, CLI, release-contract, documentation-contract,
  native-bundle, and package-smoke checks; Desktop is **161/161** and CLI is
  **543/543**.
- Final `git diff --check` passes. No package publish, tag, GitHub release, or
  network release operation was performed.

## 2026-09-22 Desktop waiting-queue reload recovery

- Added a versioned `sessionStorage` snapshot for waiting Desktop prompts only.
  Active requests, transcripts, reasoning, tool output, and cross-tab state are
  deliberately excluded.
- Snapshots are bounded to **32** items, **16 KiB** per prompt, **256 KiB**
  serialized bytes, and **24 hours**; malformed, expired, oversized, or
  unavailable storage fails closed.
- Queue state is migrated on session rename and cleared after successful
  deletion.
- Focused persistence/UI coverage passes **5/5**; the full Desktop suite passes
  **165/165**.
- Real-browser smoke confirms valid reload recovery and expired-snapshot
  cleanup. No server, SSE, memory, provider, package, or release behavior
  changed.

## 2026-09-22 Desktop session discovery filters

- Added a client-side session-id search field and run-status selector for
  idle, running, waiting, complete, failed, and aborted sessions.
- The selected session remains available when a search or status filter would
  otherwise hide it, preventing the active conversation from disappearing.
- Added localized English/Chinese labels, placeholders, status options, and
  empty-result feedback without changing the session API.
- Focused session-filter/UI coverage passes **4/4**.
- Full Desktop suite passes **168/168**.
- Browser smoke on an ephemeral local port confirms the controls work,
  language switching updates them, the layout remains usable, and the page
  reports no console errors.

## 2026-09-22 Desktop run activity indicators

- Added safe, turn-owned activity stages for queued, thinking, tool use,
  response generation, approval, complete, failed, aborted, and removed
  states.
- Existing SSE and bounded run-replay events now update the active turn's
  stage without introducing a new server event contract.
- Activity labels refresh with the English/Chinese language toggle and terminal
  lifecycle state hides stale transient labels.
- Focused activity/UI coverage passes **3/3**.
- Full Desktop suite passes **172/172**.
- Delayed-SSE browser smoke confirms stage transitions, bilingual updates,
  terminal cleanup, and no console errors.

## 2026-09-22 Codex-inspired Desktop workspace layout

- Reframed the browser Desktop as a Codex-inspired workspace shell with a
  Signal Loom workspace rail, session discovery area, conversation context bar,
  centered transcript, optional Runtime Inspector drawer, and sticky composer.
- Added the blue composer focus frame and session/workspace metadata footer while
  preserving the existing queue, turn-owned rendering, approvals, replay, and
  SSE contracts.
- Fixed the old `#new-session` rule that overrode the new layout and caused the
  button label to overlap the session heading.
- Fixed persisted-session status recovery: selecting a disk-backed session now
  materializes its metadata status on demand instead of producing `/api/status`
  404.
- Focused layout contract coverage passes **3/3**; status API coverage passes
  **15/15**.
- Full Desktop suite passes **178/178**.
- Browser smoke passes at 1440x900 and 390x844: Inspector toggling, composer
  focus, session switching, no horizontal overflow, and zero console errors.
- Added independent left-rail and Runtime Inspector collapse controls; the
  center canvas expands when either panel is closed, and the choice is saved
  locally for the next page load.
- Desktop screenshot review completed against the supplied Codex reference;
  `git diff --check` passes.

## 2026-09-22 Desktop assistant response copy

- Added `apps/desktop/public/clipboard.js` with the asynchronous clipboard API
  and a temporary-textarea fallback.
- Each assistant response segment now gets its own copy action, so later tool
  turns cannot copy the wrong response.
- Copy, copied, and failure states update in English and Chinese.
- Added a global `[hidden]` rule so completed turns do not show queue-only
  Remove controls.
- Focused copy/UI coverage passes **4/4**.
- Browser smoke confirms clipboard readback, Chinese label refresh, hidden
  completed-turn actions, and zero console errors.

## 2026-09-22 Desktop approval test isolation

- Provider-stubbed Desktop approval tests now force
  `DEV_AGENT_MCP_SERVERS=[]`, so local MCP configuration cannot start unrelated
  servers during approval scenarios.
- This closes a parallel-release-gate race that could suppress approval events
  behind a 30-second MCP initialization timeout.
- Desktop passes **178/178** and the complete `pnpm verify:typescript` gate
  passes, including CLI **559/559**, package install smoke, release contracts,
  documentation contracts, and native Desktop bundle contracts.
- No application runtime behavior changed.

## 2026-09-22 Desktop assistant Markdown rendering

- Added a dependency-free, bounded Markdown renderer for headings, paragraphs,
  emphasis, lists, blockquotes, separators, inline code, fenced code blocks,
  and safe HTTP(S) links.
- Assistant content is escaped before rendering, unsupported HTML remains
  visible text, and unsafe link protocols are rendered without a clickable
  destination.
- Streamed, historical, and recovered assistant segments share the same
  renderer while retaining the original Markdown in `data-raw-markdown` for
  exact copy behavior.
- Focused Markdown and UI coverage passes **8/8**.
- Full Desktop suite passes **182/182**.
- Browser smoke confirms rendered structure, clipboard readback, script
  non-execution, and zero console errors.

## 2026-09-22 Desktop code-block copy actions

- Added one copy action to each rendered fenced code block.
- Block copy reads the selected code element only, while whole-response copy
  continues to return the exact original Markdown source.
- Copied and failure states refresh in English and Chinese without rebuilding
  the transcript.
- Focused Markdown/UI coverage passes **5/5**.
- Full Desktop suite passes **183/183**.
- Browser smoke confirms exact code-block clipboard readback, bilingual state,
  whole-response copy retention, and zero console/page errors.
- Final TypeScript gate passes with Agent Core **188/188**, Desktop **183/183**,
  CLI **562/562**, package install smoke, and all selected contracts.

## 2026-09-22 CLI Ink-only interactive input migration

- Removed the legacy `RichInputController`, `RichPromptQueue`, and
  `apps/cli/src/tui-input.ts` input path.
- Interactive TTY sessions now select Ink unconditionally; the old
  `DEV_AGENT_TUI=ansi` selector is ignored instead of selecting a second
  renderer.
- Ink now owns TTY prompt editing, cursor movement, queueing, approvals,
  redraws, and cancellation. Non-TTY pipes retain their line-oriented
  `readline` contract.
- Removed the obsolete raw-ANSI PTY interaction tests and kept the Ink
  queue, cursor, approval, scroll, and cancellation coverage.
- Full CLI suite passes **549/549**; package-install smoke passes; `git
  diff --check` passes.

## 2026-09-23 MCP config command parity

- Explicit CLI routing now covers `mcp health`, `mcp templates`,
  `mcp enable`, and `mcp disable`.
- `mcp add` accepts built-in templates, managed results have stable human and
  JSON output, and usage/flag validation matches the expanded command surface.
- The MCP empty-summary regression was updated for the disabled-server count;
  disabled entries remain visible in `list` and are never probed by
  `status`/`health`.
- Focused MCP command tests pass **10/10**; focused MCP/config/parser tests
  pass **15/15**.
- Full CLI suite passes **561/561**, full Desktop suite passes **191/191**,
  and the complete `pnpm verify:typescript` gate passes.
- `git diff --check` passes. No npm publish, tag, GitHub Release, signing,
  notarization, or package upload was performed.

## 2026-09-23 Ink TUI duplicate status frame fix

- Reproduced the duplicated "Working · ..." status lines reported during live
  Ink TTY runs with a PTY harness and a terminal-emulator frame replay.
- Root cause: Ink 6.8's experimental incremental renderer misplaces cursor
  rows whenever a dynamic frame grows or shrinks, leaving stale status,
  transcript, and composer lines painted one row below the live frame.
- Switched the interactive Ink render back to Ink's standard log-update
  renderer (`incrementalRendering` omitted, defaulting to false), which erases
  and repaints the bounded dynamic frame without duplicating rows.
- Verified the standard renderer emits no scrollback-clearing escape sequences
  in the PTY scenarios, so the existing welcome-panel scrollback behavior is
  preserved.
- Full CLI suite passes **561/561**, Ink PTY behavior evaluations pass **8/8**,
  and the repository `pnpm verify:typescript` gate passes with Agent Core
  **188/188**, Tools **159/159**, Desktop **196/196**, CLI **561/561**,
  CLI package-install smoke, preview/release/CI contracts, documentation
  contracts, and native Desktop bundle contracts.
- `git diff --check` passes. No npm publish, tag, GitHub Release, signing,
  notarization, or package upload was performed.

## 2026-09-23 CLI provider-free test isolation

- Provider-free review-writes and Rust executor wiring regressions now force an
  empty MCP configuration. Without that override, a local user-level MCP server
  could delay the CLI's provider initialization behind a 30-second
  `initialize` timeout and turn an unrelated assertion into a false failure.
- After isolating that boundary, the focused review-writes and executor-wiring
  regressions pass **5/5**, and the CLI package-install smoke passes. Rich TUI
  behavior evaluations remain **8/8**.

## 2026-09-23 Desktop plan review and guarded apply workflow

- Closed the Desktop plan workflow covering plan mode, exact diff review,
  apply, validation, abort/failure pause, retry, and guarded undo.
- The implementation reuses existing turn ownership, SSE contracts, approvals,
  durable validation, and change-set evidence instead of introducing a second
  mutation path.
- Focused plan/queue/replay/activity tests pass **19/19**, and the full Desktop
  suite passes **191/191**.
- The full `pnpm verify:typescript` gate passes with Agent Core **188/188**,
  Tools **159/159**, CLI **561/561**, Desktop **191/191**, package-install
  smoke, and all selected release, preview, documentation, and native bundle
  contracts.
- `git diff --check` passes.

## 2026-09-23 Desktop conversation checkpoints

- Added FileMemory-backed checkpoint creation, listing, and validated rewind to
  Desktop ChatSession without adding a second history authority.
- Added active-run-protected session-scoped routes for checkpoint creation,
  listing, and rewind. The rewind boundary is conversation-history-only and
  never changes workspace files, change sets, validation evidence, or applied
  guards.
- Added a localized Desktop checkpoint panel with bounded metadata display and
  explicit confirmation before rewind. Successful rewinds reload only the
  selected session transcript.
- Focused checkpoint coverage passes **4/4**, and the focused plan-workflow
  regression passes **5/5**.
- The full Desktop suite passes **195/195**, and the repository
  `pnpm verify:typescript` gate passes with CLI **561/561**, CLI package-install
  smoke, preview/release/CI contracts, documentation contracts, and native
  Desktop bundle contracts.
- `git diff --check` passes. No npm publish, tag, GitHub Release, signing,
  notarization, or package upload was performed.

## 2026-09-23 Desktop runtime trace panel

- Added a localized Desktop Runtime Inspector `Trace` action and compact panel
  for the existing metadata-only session trace endpoint.
- Rendered bounded run/span timing and status metadata, with fail-closed
  payload validation, stale-request cancellation, and reset behavior for new,
  renamed, and deleted sessions.
- Kept prompts, tool inputs, tool output, paths, credentials, and raw errors
  outside the visible trace contract.
- Focused trace UI coverage passes **1/1**, and the full Desktop suite passes
  **196/196**.
- The full CLI suite passes **561/561**, the CLI package-install smoke passes,
  and `pnpm verify:typescript` passes all selected release, preview, CI,
  documentation, and native Desktop bundle contracts.
- `git diff --check` passes. No npm publish, tag, GitHub Release, signing,
  notarization, or package upload was performed.

## 2026-09-23 CLI test build isolation

- CLI test runs now clean `tests-dist`, compile source and tests, complete the
  package bundle, and only then start the Node test runner.
- The in-suite package-install contract invokes the smoke script with
  `--skip-build`, while direct `pnpm package:smoke` retains its fresh-checkout
  build path.
- Added a focused isolation contract covering that lifecycle boundary.
- Focused isolation coverage passes **2/2**, and the full CLI suite passes
  **563/563**.
- The isolated Desktop suite passes **196/196** after one transient MCP
  initialization timeout; the complete `pnpm verify:typescript` gate then
  passes with CLI **563/563**, package-install smoke, and all selected release,
  preview, CI, documentation, and native Desktop bundle contracts.
- `git diff --check` passes. No npm publish, tag, push, signing, GitHub
  Release, notarization, or package upload was performed.

## 2026-09-23 CLI scheduler approval status (complete)

- Added an optional AgentLoop approval-status observer and connected it to the
  active CLI task through a scoped bridge.
- Covered regular approval waits, sandbox-expansion waits, the no-policy path,
  and metadata-only scheduler snapshots.
- Agent Core suite passes **191/191** when run with `HOME=/tmp`; this keeps its
  temporary skill fixture inside the writable test area.
- CLI build, test compilation, and focused scheduler bridge tests pass **2/2**.
- A full CLI test attempt reported **295 passed, 44 failed, 44 cancelled** before
  being stopped after the package-install smoke remained blocked in npm install
  without network access. Earlier child-process cases also emitted Node 26
  native callback-scope assertions. This is not treated as a green full-suite
  result; the focused feature gate remains green while the broader environment
  issue is isolated.
- An elevated rerun restored loopback access and allowed additional integration
  cases to pass, but reported **244 passed, 17 failed, 63 cancelled** before it
  was stopped. `approval.test.js` still missed its expected denial output, and
  a failing interactive PTY assertion left a stub-provider server open, keeping
  the isolated test process alive. The full CLI suite and repository gate remain
  unverified; `pnpm verify:typescript` was not run.
- A final metadata review found that the scheduler preserves prior detail when
  `setStatus("running")` omits one. The bridge now replaces `approval pending`
  with the generic `confirmation resolved` detail. CLI build and test compile
  pass, focused bridge coverage remains **2/2**, the Agent Core approval-status
  tests pass **3/3**, and the existing interactive task-lifecycle integration
  passes **1/1**.
- The final full CLI suite passes **566/566**. The final
  `pnpm verify:typescript` gate passes Agent Core **196/196**, Tools **159/159**,
  Desktop **208/208**, CLI package-install smoke, and all selected release,
  preview, CI, documentation, and native Desktop contracts. `git diff --check`
  passes; this phase is complete.

## 2026-09-23 Desktop stubbed-provider MCP isolation

- Provider-stubbed Desktop validation tests now own `DEV_AGENT_MCP_SERVERS`
  through the shared `applyEnv` helper and default to an empty MCP
  configuration.
- This closes the same 30-second local MCP initialization timeout class that
  affected prior CLI and Desktop approval tests, without changing production
  MCP loading or validation behavior.
- Added focused helper-isolation coverage.
- Focused validation tests pass **12/12**, and the full Desktop suite passes
  **197/197**.
- Full CLI suite passes **563/563**, CLI package-install smoke passes, and the
  complete `pnpm verify:typescript` gate passes all selected contracts.
- `git diff --check` passes. No npm publish, tag, push, signing, GitHub
  Release, notarization, or package upload was performed.


## 2026-09-23 Documentation reconciliation and Gemini CLI alignment (complete)

- Reconciled verified source/documentation mismatches: the Rust stdio executor
  is concurrent (not serial), Starlark policy evaluation is implemented, and
  executor summaries now describe both local and Rust-backed execution.
- Clarified the root/docs distinction between dated release status and current
  local working-tree implementation status; updated package capability labels
  that incorrectly implied the listed surface was still phase-one-only.
- Replaced the stale current task-plan goal with the user's documentation and
  Gemini CLI alignment objective, while preserving the historical phase detail.
- `git diff --check` passes. The first exact-match patch attempt aborted before
  writing because a README tree line had different punctuation; corrected the
  match and applied the changes without partial writes.
- Captured current official Gemini CLI manifest and architecture references in
  `findings.md`; the code-level comparison and aligned implementation slices
  were completed in the later entries below.


## 2026-09-23 TypeScript gate investigation and Gemini alignment (resolved)

- The first `pnpm verify:typescript` run completed structure/build/typecheck,
  then network-listener tests failed with sandbox `EPERM`; rerunning with
  elevated execution permission passed those earlier local-bind boundaries.
- The elevated gate then reported failures in three CLI interactive tests
  (turn/usage accumulation, metadata-only trace, and persisted session history)
  and remained in `interactive.test.js` for over 13 minutes with no CPU activity
  or child process. I interrupted that stalled verifier. This was an
  intermediate failure; later entries document the isolated diagnostics,
  reliability fixes, and final passing gate.
- Source comparison confirmed a separate actionable issue: CLI collaboration
  workers do not inherit the primary CLI's selected Rust sandbox-profile
  resolver or sandbox-expansion callback. That issue was fixed and verified in
  the collaboration sandbox propagation entry below.


## 2026-09-23 Collaboration sandbox propagation and gate diagnosis

- The CLI now shares its selected Rust sandbox-profile resolver and bounded
  expansion decision callback with `createCollaborativeExecution`; Agent Core
  forwards both application-owned options to each worker `AgentLoop`. When no
  sandbox executor is selected, the resolver remains absent and existing local
  execution behavior is preserved.
- Added a collaboration regression test proving profiles are rooted at the
  worker worktree and an approved sandbox expansion retries the same tool once.
  Agent Core build and the collaboration-execution test file pass (**8/8**).
- CLI build and test compilation pass. The three previously failing interactive
  tests (turn/usage accumulation, metadata-only trace, persisted history) pass
  together in isolation (**3/3**).
- Two full `pnpm verify:typescript` attempts remain non-green under the
  workspace-parallel test run. One failed the SIGKILL escalation timing
  assertion at 205 ms; that test passes alone in 2,055 ms. The other failed MCP
  timeout tests during initialization; the complete MCP package suite passes
  alone (**70/70**). These results point to test-load sensitivity, not a proven
  product regression; the repository-wide gate still needs a reliable pass.
- The comparison document now records sandbox propagation as implemented. The
  next Gemini-aligned slice is a trusted, narrowing per-task tool allowlist
  whose policy is supplied outside planner-generated task data.


## 2026-09-23 Trusted collaborative tool scopes

- Added `CollaborativeExecutionOptions.toolAllowlistForTask`, an application-owned
  resolver separate from `CollaborationTask` and planner output. Agent Core
  resolves all task scopes before creating workspaces and rejects non-arrays,
  over-256 lists, invalid/duplicate names, and names not present in the caller's
  tool collection.
- Each worker receives an intersected `ToolCollection` for both model schema
  generation and runtime lookup. With no resolver, existing behavior is
  unchanged. Planner-generated capability-looking fields are ignored.
- Added regressions proving excluded tools are omitted from every model request
  and remain uncallable even if the model fabricates a tool call, and that an
  unavailable name fails before workspace creation.
- Agent Core build and full tests pass (**195/195**); CLI build and test
  compilation pass; the CLI collaboration integration suite passes (**6/6**).
  `git diff --check` passes.
- The public CLI does not yet offer user configuration for these opt-in scopes;
  current `:team` behavior remains backward-compatible. The next product decision
  is how to expose user-owned task scopes without deriving permissions from the
  model-generated plan.

## 2026-09-23 CLI per-task scope decision

- Confirmed `:team` omits `toolAllowlistForTask`; model-generated plans therefore
  cannot select a narrower or broader CLI scope, and workers retain the existing
  shared tool collection.
- Deferred user-facing per-task scope configuration until the CLI can pause for
  plan review and bind each generated task to tools through explicit user
  confirmation. Do not derive grants from planner-controlled task IDs, roles,
  titles, or instructions.
- Clarified Agent Core API documentation that the resolver is caller-owned but
  receives potentially planner-originated task data; it must use independent
  authorization input for any task-specific grants.
- The repository gate passed structure, workspace build, and TypeScript
  typecheck, but its test phase failed. An isolated rerun of
  `apps/desktop/tests/task-workspaces.test.ts` reproduced **5/5** failures;
  `requireWorktree()` compares the real path (`/private/var/...`) to the stored
  resolved alias (`/var/...`), incorrectly classifying valid worktrees as
  missing. This also breaks merge, cleanup, and session restoration. The
  aggregate reported CLI test failure too; its first diagnostic still needs
  isolation.
- Added canonical-root validation that preserves exact task-directory identity
  and rejects final-component symlinks. Follow-up fixes distinguish a task
  branch at its base commit from a merged branch, compare Git's top-level path
  to the canonical directory, and restore sessions backed by validated task
  workspaces even before a memory file exists. The isolated workspace file now
  passes **5/5**.
- The full CLI test suite completed in isolation with no failure markers,
  including its package-install smoke; this isolates the aggregate CLI failure
  to the concurrent release-gate run rather than a reproduced CLI assertion.
- The full Desktop suite now passes **208/208** after the canonical path,
  merge-state, and task-session restoration fixes.
- The second repository gate passed build, typecheck, workspace tests (CLI
  **565/565**, Desktop **208/208**), package installation smoke, release
  contracts, and preview contracts. It stopped at documentation contracts:
  README did not satisfy the expected `v0.1.8` current-GitHub-release notice
  because Markdown split the required phrase across lines. The root README now
  records the current release as of September 23, 2026, and the documentation
  contract suite passes **57/57** after the wording fix.
- A final full `pnpm verify:typescript` rerun is still required because the
  README changed after the aggregate gate.
- At this point in the investigation, repository-wide
  `pnpm verify:typescript` was not green and remained pending; the later
  closure below supersedes this intermediate status.

## 2026-09-23 TypeScript gate concurrency recheck

- Re-ran `pnpm verify:typescript` after the Desktop task-workspace fix. Structure,
  workspace build, and typecheck passed.
- The parallel workspace test phase reported one failure in
  `apps/desktop/tests/chat-session-e2e.test.ts`: the running-shell cancellation
  test did not observe its command-start marker within its 10-second wait.
- Re-ran the exact compiled test alone with Node's test-name filter; it passed
  **1/1** in 5.6 seconds. The Desktop task-workspace tests passed during the
  aggregate run.
- At that point, the repository gate remained non-green and the failure was
  narrowed to a load-sensitive end-to-end startup assertion while package
  suites executed concurrently. The later closure below serialized workspace
  tests without relaxing the contract and passed the full gate.


## 2026-09-23 CLI collaboration ceiling and final gate closure

- Added the bounded `collaboration.toolAllowlist` user configuration as a
  shared ceiling for every `:team` worker. Planner-generated task data cannot
  widen it; explicit per-task CLI bindings remain deferred pending user review.
- Kept Agent Core's independent caller-owned per-task scope API, which validates
  names before workspace creation and uses the same narrowed tool collection
  for model schemas and runtime lookup.
- Changed repository test scheduling to
  `pnpm -r --workspace-concurrency=1 run test` and added a release-gate contract
  asserting that setting, preserving all tests.
- The final `pnpm verify:typescript` gate passed: Agent Core **196/196**, Tools
  **159/159**, CLI **566/566**, Desktop **208/208**, CLI package-install smoke,
  release/preview/CI contracts, documentation contracts **57/57**, and native
  Desktop bundle contracts **2/2**.
- `git diff --check` passed. No release or publishing side effect was performed.
- On resuming, stopped the redundant verification process left from the
  interrupted run; it exited with status 130 and did not alter source files.
- Synchronized `task_plan.md`, `findings.md`, and this progress record with the
  final verified state. Existing unrelated working-tree changes were preserved.


## 2026-09-23 Collaboration ceiling malformed-config guard

- Reused `validateCollaborationConfig()` in the runtime resolver instead of
  trusting `CliConfig`'s static cast of parsed JSON. Invalid collaboration object
  shape or allowlist type/content now produces a safe CLI error before provider,
  MCP, or collaboration workspace setup; absent config and `collaboration: {}`
  preserve the no-ceiling behavior.
- Added unit coverage for omitted/empty/valid scopes and malformed object/list
  shapes, plus a CLI integration test proving malformed configuration exits
  non-zero, emits no model request, and creates no team branch. Focused config,
  config-validation, and collaboration tests pass **48/48**. An initial assertion
  incorrectly expected no default Git branch; it was corrected to compare the
  branch list before and after the run.
- The first full gate attempt after this edit overlapped an older
  `pnpm --filter @agent_cli/cli test` run in the same checkout; shared
  `tests-dist` cleanup/builds caused missing-file failures and CLI startup
  timeouts. After interrupting both stale test runners and confirming no other
  test process was active, `pnpm verify:typescript --report` passed all steps:
  Agent Core **196/196**, Tools **159/159**, CLI **572/572**, Desktop **210/210**,
  documentation **57/57**, native Desktop **2/2**, package-install smoke, and all
  release/preview/CI contracts.
- The CLI test suite now includes the malformed-collaboration regression; the
  latest passing total is **572/572**. After synchronizing plan/findings/progress
  docs, the documentation plus release-gate contract suites pass **74/74**;
  `git diff --check` passes.
- Corrected stale architecture notes that said the CLI never passes the task
  scope resolver: it supplies a constant, planner-independent resolver only when
  the uniform user-configured ceiling exists. Distinct task grants remain
  deferred. Updated CLI config docs with the malformed-ceiling behavior.


## 2026-09-23 Per-task collaboration scope review — design checkpoint

- Re-read the collaboration execution boundary after the full TypeScript gate
  passed. Agent Core validates `toolAllowlistForTask` for the full normalized
  graph before creating workspaces, and model schemas plus runtime lookup use
  the same narrowed tool collection. The CLI currently supplies only a constant
  resolver from its optional global ceiling.
- The planner-to-execution call in `apps/cli/src/index.ts` is a natural preflight
  seam: it has the normalized task plan, registered built-in/MCP tool names, the
  caller-owned ceiling, and the interactive question callback before invoking
  `createCollaborativeExecution()`. An opt-in `reviewTaskToolScopes` setting can
  collect explicit, per-task choices there while leaving legacy `:team` behavior
  unchanged when absent.
- Active implementation requirement: bind each user's post-plan choices to
  that exact plan, constrain them to the global ceiling, present bounded and
  terminal-sanitized task descriptions, and abort before workspace creation on
  decline or invalid input. Do not infer grants from planner-controlled fields.

## 2026-09-23 Task-scope review documentation reconciliation

- Re-audited the live `:team` startup boundary, the scope-review helper, and
  Agent Core's graph normalization/scope-resolution order. The CLI now has an
  opt-in `collaboration.reviewTaskToolScopes` prototype: it collects user input
  after normalizing tasks and before `createCollaborativeExecution()`. Agent
  Core normalizes and validates scopes synchronously before workspace creation.
- The prototype is not complete enough to describe as a hardened permission
  boundary. Scope selections are joined through normalized planner task IDs;
  the final confirmation shows IDs, titles, and scopes but omits the dependency
  graph; and no explicit equality check binds an immutable reviewed plan to the
  graph Agent Core re-normalizes. Do not treat the feature as security-sensitive
  until it presents the complete ordered plan and scopes, uses caller-owned
  exact-plan identity, and revalidates that binding before any workspace starts.
- Updated `apps/cli/README.md`, `docs/architecture.md`, and
  `docs/gemini-cli-architecture-alignment.md` to distinguish the global ceiling,
  the partial prototype, and the remaining hardening requirements. Updated
  `task_plan.md` and `findings.md`; prior full-gate results are explicitly scoped
  to code predating this prototype.
- `node --test tests/documentation-contract.test.mjs` passed **57/57** and
  `git diff --check` passed. No implementation or feature tests were changed or
  run in this documentation-only checkpoint. The already-running `pnpm cli`
  process was left untouched.


## 2026-09-23 Ordered, fingerprint-bound collaboration scope review

- Replaced the planner-ID keyed prototype with a frozen normalized task snapshot
  and a SHA-256 fingerprint over ordered task execution details. Per-task user
  grants are represented by ordered slot index, never as planner-selected task
  properties. Agent Core rejects fingerprint mismatch, incomplete/sparse scope
  coverage, unavailable or invalid names, and scopes above the global ceiling
  before creating a task workspace.
- The CLI now displays the complete normalized task details at scope selection
  and a final ordered graph/dependency/scope confirmation. Review input is
  bounded, terminal-sanitized, and sensitive-text redacted; invalid attempts are
  limited. Cancellation, interruption, or declining confirmation does not
  start workers or create task workspaces.
- Updated CLI, Agent Core, architecture, and Gemini-alignment docs to describe
  the implemented contract instead of the stale prototype. Updated the active
  plan and findings summaries; older progress entries are preserved as history.
- Focused results after prompt-budget hardening: CLI scope review **9/9**, CLI
  collaboration integration **11/11**, Ink UI **4/4**, Agent Core **200/200**.
  Regression tests ensure arbitrary-length unknown names are not echoed into
  retry prompts and worst-case repeated task details fit the aggregate 128 KiB
  review budget or fail before asking for grants.
- The full `pnpm verify:typescript --report` gate passed: workspace build,
  typecheck and serial tests (Agent Core **200/200**, Tools **159/159**, CLI
  **618/618**, Desktop **211/211**), CLI package-install smoke, release,
  preview, CI, documentation (**57/57**) and native Desktop (**2/2**) contracts.
  `git diff --check` passed. Existing `pnpm cli` PID 72505 was left running.


## 2026-09-23 Roadmap and documentation-index status reconciliation

- Audited `docs/README.md` against the completed v0.1.5–v0.4.0 checklist, the
  release-state/next-roadmap records, and the separate v65 plans. Fixed stale
  claims that treated the completed implementation plan as active and v0.1.8
  formal release preparation as still pending.
- Clarified that the completed Scheme A workbench polish in `day-plan-v65.md` is
  a different scope from the still-deferred executor-capability / execution-state
  UX candidate in `next-roadmap-plans-v62-plus.md`; neither phase label is a
  substitute for the other plan's acceptance evidence.
- Added two regression contracts. Documentation contracts pass **59/59** after
  the edit; `git diff --check` passes. The full TypeScript release gate was
  already green immediately before these documentation-only changes (its docs
  suite was **57/57**); no package source or runtime behavior changed afterward.


## 2026-09-23 Rust and real sandbox integration gate verification

- `pnpm verify:rust --report` passed Rust formatting, Clippy (`-D warnings`),
  **48** library unit tests, **6** binary unit tests, and doc tests.
- `pnpm verify:integration --report` passed **11/11** real Rust executor
  integration tests, including Starlark policy enforcement, read-only and
  writable paths, network and loopback behavior, timeout, resource limits,
  output quota, already-aborted and running-command cancellation, and concurrency.
- Together with the passing TypeScript gate and the final documentation-only
  rerun (**59/59**) this covers all repository gate modes on this macOS
  worktree. Linux hosted `bwrap` CI remains the platform-specific evidence and
  is not inferred from these local macOS tests.


## 2026-09-23 Mandatory team review and MCP boundary documentation sync

- A fresh cross-document audit found stale `opt-in` wording in the live
  architecture, Gemini comparison, findings summary, and root task-plan status:
  the implementation now requires per-task scope selection for every `:team`
  execution, while `collaboration.reviewTaskToolScopes` is only a compatibility
  field and cannot disable review.
- Reconciled the live documentation with `apps/cli/src/index.ts`, config
  validation, and the CLI integration tests. Historical dated progress entries
  describing the earlier opt-in prototype remain unchanged as history.
- Traced MCP lifecycle from `registerMcpTools()` through worker tool filtering:
  the CLI starts sessions at the main project root, then workers reuse the same
  MCP tool closures. The MCP wrapper forwards cancellation/progress but not the
  worker worktree path; the stdio child is launched outside the Rust executor.
  Documented that tool allowlists are visibility controls, not MCP process or
  resource isolation, and that advertised roots/cwd do not enforce server-side
  containment.
- Indexed the Gemini comparison in `docs/README.md` and added a documentation
  contract for mandatory review wording plus the shared-MCP boundary.
- `node --test tests/documentation-contract.test.mjs` passes **60/60**;
  `git diff --check` passes. No runtime code changed, and the existing `pnpm
  cli` process (PID 72505) was left running.
