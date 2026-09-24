# dev-agent project completion and Gemini CLI alignment plan

## Active goal

Reconcile project documentation with the current source tree, then use the
current official Gemini CLI architecture and design as a comparative reference
to implement evidence-backed improvements. Preserve existing safety,
compatibility, and verification contracts; do not copy features without checking
fit against the current code and user requirements.

## Current working-tree status — 2026-09-23

- The documentation reconciliation and source-linked Gemini comparison are
  complete for the current audited implementation. The root README separates
  the dated published-release snapshot from local, unpublished work.
- CLI collaboration workers inherit the selected Rust sandbox-profile resolver
  and bounded expansion callback. Agent Core supports caller-owned, validated
  per-task tool scopes, while the CLI exposes a separate bounded
  `collaboration.toolAllowlist` ceiling shared by every `:team` worker. Neither
  scope can be widened by planner-generated task data.
- Every `:team` execution now requires a bounded post-plan review of the
  complete normalized graph. The legacy `collaboration.reviewTaskToolScopes`
  boolean is accepted for compatibility but ignored. User scopes are indexed by
  ordered task slot and bound to a SHA-256 plan fingerprint; Agent Core
  revalidates the fingerprint, complete slot coverage, registered tool names,
  and optional global ceiling before workspace creation. Cancellation,
  interruption, invalid selections, or declined confirmation fail closed.
- The shared CLI ceiling is limited to 256 exact, unique tool names; malformed
  collaboration config is rejected before an interactive agent run rather than
  interpreted as an omitted ceiling. It remains the hard upper bound for every
  user-reviewed per-task scope. MCP tool visibility does not isolate the CLI's
  project-rooted MCP processes or constrain their server-side resources.
- Repository package tests run with
  `pnpm -r --workspace-concurrency=1 run test`; the release-gate contract suite
  protects this scheduling requirement. Separate concurrent test invocations
  still share CLI `tests-dist`, so verification was rerun only after confirming
  no other test process was active.
- At the earlier collaboration-scope checkpoint, `pnpm verify:typescript
  --report` passed structure, workspace build/typecheck/tests, package-install
  smoke, release/preview/CI contracts, documentation contracts, and native
  Desktop contracts. Its historical key suite counts were Agent Core **200/200**,
  Tools **159/159**, CLI **618/618**, Desktop **211/211**, documentation **57/57**,
  and native Desktop **2/2**. After later documentation reconciliations, the
  standalone documentation contract suite passes **60/60**.
- Separate final gate phases passed on the current worktree: `pnpm verify:rust
  --report` (format, Clippy, **54/54** Rust unit tests) and
  `pnpm verify:integration --report` (**11/11** real Rust sandbox integration
  tests). The docs-index reconciliation passed **59/59** at that checkpoint;
  the current mandatory-review/MCP-boundary documentation contracts pass
  **60/60**, with `git diff --check` also passing.
- The checkout contains extensive pre-existing modified and untracked files.
  Continue preserving them; do not reset, clean, or overwrite unrelated work.
- The late Anthropic package/model change is now implemented and focused-verified:
  `@anthropic-ai/sdk@0.126.0` is used by the provider adapter, with the shared
  retry/bounds/cancellation contracts preserved. Model tests pass **94/94**.
  The optional Claude Agent SDK adapter is now implemented safely behind the
  existing tool registry, approval policy, and sandbox; the default CLI remains
  on the existing AgentLoop/provider path.

## Active work

- [x] Close the generic-tool/MCP approval and plan-mode gap: make missing
      tool-risk metadata fail closed, propagate trusted registry metadata into
      approval requests, classify MCP action wrappers separately from resource
      and prompt reads, and cover CLI/Desktop/core behavior with regressions.

- Current closure checks: Agent Core **211/211**; plan-mode focused tests **8/8**;
  CLI and Desktop MCP integration tests **2/2** each; CLI MCP prefix/classification
  regressions pass. Added an optional package-smoke npm-cache override while
  preserving isolated HOME and proxy settings. With the populated local npm
  cache selected, the CLI tarball smoke passed and the full
  `pnpm verify:typescript --report` gate passed all selected phases, including
  workspace tests (**629/629** CLI tests), npm package smoke, documentation
  (**60/60**), and native Desktop contracts (**2/2**). `git diff --check` passes.
  The final gate was rerun after the Anthropic SDK adapter and dependency
  changes settled, so the report covers the current audited TypeScript tree.

- [x] Make the CLI package-install smoke accept an explicit npm-cache path while
      keeping its temporary HOME and proxy isolation. Use the already populated
      local npm cache to rerun the package smoke and full TypeScript gate without
      relying on another registry download.

- [x] Verify and document that team workers share CLI-created, project-rooted
      MCP sessions and that task tool scopes do not isolate MCP processes or
      server-side resource access. Defer worker-scoped MCP startup until
      per-task server selection, external-resource semantics, process/concurrency
      caps, and cleanup are specified.

- [x] Correct verified documentation and source comments that contradicted current behavior.
- [x] Revalidate Gemini CLI's stack and architecture sources and write a
      source-linked, project-specific comparison.
- [x] Propagate sandbox profile selection and bounded expansion into every
      collaborative worker AgentLoop.
- [x] Add caller-owned, validated Agent Core task tool scopes and ensure the
      same narrowed collection governs schemas and runtime lookup.
- [x] Add a bounded `collaboration.toolAllowlist` CLI configuration that acts as
      one user-owned ceiling shared by every team worker; never infer grants
      from planner task data. Keep this ceiling as the upper bound for per-task
      grants.
- [x] Serialize package test scheduling inside the release gate without
      dropping tests; protect the setting with a release-gate contract.
- [x] Rerun the full TypeScript verification gate after the collaboration-config
      fail-closed change with no overlapping test process in the same checkout.
- [x] Make post-plan task tool-scope review mandatory and harden it with a
      complete ordered graph and scope confirmation, ordered-slot binding plus
      exact normalized-plan fingerprint, pre-workspace Agent Core revalidation,
      global-ceiling enforcement, bounded input, and fail-closed cancellation.

## Historical implementation phases

### Phase 1: Desktop managed runtime status (complete)

- Extend the Desktop status snapshot with a safe `managedRuntime` summary.
- Read managed runtime state without exposing binary paths or raw errors.
- Show managed runtime state in the Desktop status panel.
- Cover snapshot, API, and UI contract tests.

### Phase 2: Verification and docs (complete)

- Run focused Desktop tests.
- Run the TypeScript release gate.
- Update Desktop docs, CHANGELOG, and the roadmap decision record.

## Result

The shared project surface now includes an offline, metadata-only managed
runtime summary in Desktop status. The implementation is verified by focused
Desktop/runtime-manager tests and the full TypeScript release gate. No release
tag, npm publish, or push was performed.

## Phase 3: Eight-hour input-boundary hardening (complete)

The next eight-hour slice follows the 2026-09-20 audit and closes the five
reproducible `FIX` findings without disturbing the completed Signal Loom TTY,
Web Desktop, or native macOS shell work.

- [x] Write the executable plan at
      `docs/superpowers/plans/2026-09-20-eight-hour-hardening.md`.
- [x] Preserve and baseline the existing in-flight MCP error-response change.
- [x] Bound CLI session listing with an explicit 256-entry JSON contract.
- [x] Bound doctor command-version and Rust-probe subprocess output.
- [x] Bound FilesystemTool write and generated postimage bytes.
- [x] Synchronize audit/docs and run the full verification gates.

Verification completed on 2026-09-20:

- `pnpm build` passed.
- `pnpm verify` passed, including CLI 383/383, Desktop 138/138,
  documentation contracts 57/57, and real Rust integration 11/11.
- Swift package tests passed 8/8; native app launch verification and
  `Info.plist` lint passed.
- The five reproducible audit findings are closed. Four `NEEDS-EVIDENCE`
  decisions remain open.

### Phase 4: Input-boundary closure (verified)

The 2026-09-20 follow-up plan at
`docs/superpowers/plans/2026-09-20-input-boundary-closure.md` closes the four
remaining input-boundary decisions with fixed, non-configurable contracts.

- [x] Cap cumulative provider stream output at 16 MiB of UTF-8 bytes.
- [x] Bound code-search/index discovery at 100,000 files and 256 MiB of
      eligible source bytes.
- [x] Preserve the previous index when discovery or serialized write-back
      exceeds its limit.
- [x] Make rollback directory inspection asynchronous and early-exit.
- [x] Deny CLI approval input over 4 KiB before the first newline.
- [x] Run the final workspace, Rust, and native macOS gates.
- [x] Push the verified feature branch after the final review. No package
      publish, tag, or GitHub Release was performed.

Final verification completed on 2026-09-20:

- `pnpm build` and `pnpm verify` passed.
- CLI passed 392/392; Desktop 138/138; model 72/72; tools 151/151;
  documentation contracts 57/57; Rust unit/bin/doc tests 54/54; real Rust
  integration 11/11.
- Swift package tests passed 8/8; native launcher verification and
  `Info.plist` lint passed; `git diff --check` passed.
- Final whole-branch review was clean with no Critical or Important findings.
- `codex/desktop-cli-workbench` was pushed to GitHub at `7c35d79`.

### Phase 5: Native macOS local bundle polish (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-20-native-macos-local-bundle-polish.md`
keeps the native shell local while making the staged app easier to recognize
and hand off.

- [x] Generate `SignalLoom.icns` from the canonical Signal Loom SVG during
      app staging.
- [x] Add `CFBundleIconFile` metadata to the generated app bundle.
- [x] Add non-launching `--package`/`package` mode with a local ZIP and
      SHA-256 sidecar.
- [x] Document the checkout-bound archive and its unsigned, non-notarized
      limitation.
- [x] Add the native bundle contract to the fixed TypeScript verification
      gate.
- [x] Run focused native checks, full `pnpm verify`, app launch verification,
      archive inspection, and checksum verification.

Completed on 2026-09-20. No npm publish, tag, GitHub Release, signing,
notarization, or package upload was performed.

### Phase 6: Runtime events and Ink CLI migration (complete)

The design and execution plan are recorded in:

- `docs/superpowers/specs/2026-09-20-runtime-events-and-ink-cli-design.md`
- `docs/superpowers/plans/2026-09-20-runtime-events-ink-cli.md`

- [x] Record the shared Runtime Event, behavior-evaluation, checkpoint,
      Skills, Hooks, tool metadata, and Ink migration design.
- [x] Record the task-by-task implementation plan and acceptance gates.
- [x] Add `@dev-agent/runtime-events` and emit versioned events from AgentLoop.
- [x] Project the shared events into CLI and Desktop.
- [x] Add root `evals/` behavior tests for queue, streaming, approval,
  cancellation, resize, EOF, and tool-loop behavior.
- [x] Add FileMemory-backed checkpoint metadata.
- [x] Add bounded Skills and Hooks registries.
- [x] Add tool risk, confirmation, and result-format metadata.
- [x] Migrate rich TTY rendering to Ink 6/React 19 while preserving non-rich
  output contracts.
- [x] Run focused tests, `pnpm test:evals`, `pnpm verify`, and diff checks.

Completed on 2026-09-20. Final evidence: CLI 407/407, Desktop 139/139,
Agent Core 143/143, Tools 152/152, Runtime Events 3/3, behavior evaluations
5/5, documentation contracts 57/57, and real Rust integration 11/11. No npm
publish or release was performed.

Scheduler, additional sandbox backends, ACP, and A2A remain explicitly
deferred until the single-agent event and evaluation contracts are stable.

### Phase 22: ACP Agent Client Protocol bridge (complete)

The executable plan is recorded in
`docs/superpowers/plans/2026-09-21-acp-agent-client-protocol.md`. This phase
adds the Gemini CLI study's IDE/session integration boundary while keeping the
existing single-agent runtime and CLI configuration authoritative.

- [x] Add the reusable `@dev-agent/acp` package on the official ACP v1 SDK.
- [x] Add in-process lifecycle, streaming, permission, cancellation, and
      unsupported-content tests.
- [x] Add the CLI `--acp` stdio entry point and a real-provider subprocess smoke
      test with protocol-only stdout.
- [x] Run the full CLI, behavior-evaluation, TypeScript, package, and diff
      verification gates, then record exact evidence.
- [x] Decide whether to add a packaged ACP smoke case after the workspace gate
      confirms the bundle boundary; the existing CLI ACP subprocess smoke and
      package-install smoke cover the boundary without duplicating a second
      packaged protocol fixture.

Verification completed on 2026-09-22:

- CLI full suite: **490/490**.
- Desktop full suite: **150/150**.
- `@dev-agent/acp` package tests: **5/5**.
- CLI ACP subprocess smoke: **2/2**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed, including workspace build/typecheck,
  package install smoke, release-boundary contracts, preview contracts, and
  documentation contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 7: Ink compact layout and terminal scrollback (complete)

The post-migration Ink follow-up removes the fixed terminal-height layout that
created a large empty area and moves completed runtime transcript entries into
Ink static output so they remain available in terminal scrollback.

- [x] Keep short-session composer and footer directly below visible content.
- [x] Keep completed answers out of later dynamic repaint frames.
- [x] Add regression tests for compact layout and scrollback history.
- [x] Preserve the active thinking indicator and current composer behavior.

Focused verification completed on 2026-09-20:

- Ink app tests: 10/10.
- CLI package build: passed.
- Full CLI suite: 414/414.
- Rich CLI behavior evaluations: 5/5.

### Phase 8: On-demand Skills and modular Prompt composition (complete)

The Gemini CLI architecture study identifies Skills as bounded, on-demand
knowledge rather than permanent system-prompt content. The execution plan is
recorded in
`docs/superpowers/plans/2026-09-20-skill-activation-and-prompt-modules.md`.

- [x] Add explicit `:skills` and `:skill <name>` / slash-alias commands.
- [x] Keep project skills ahead of user skills and hide skill file paths.
- [x] Inject only the active skill through `systemPromptProvider`.
- [x] Keep ANSI and Ink command handling on the same adapter.
- [x] Run the full CLI and behavior-evaluation gates before closing this phase.

Verification completed on 2026-09-20:

- CLI build passed.
- Full CLI suite: **419/419**.
- Rich CLI behavior evaluations: **6/6**.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 21: Shared Model Routing and streaming-safe fallback (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-model-routing.md` follows the Gemini CLI
model-routing boundary while keeping provider/profile construction at the CLI
application edge.

- [x] Add the provider-neutral `ModelRouter` to `@dev-agent/model`.
- [x] Resolve explicit fallback providers lazily and bound the fallback count.
- [x] Allow fallback before the first streamed answer or reasoning token only.
- [x] Never replay a partial stream, and never fall back after an abort.
- [x] Migrate the CLI fallback adapter without changing profile or alias
      configuration behavior.
- [x] Update model/architecture documentation and run the fixed verification
      gates.

Verification completed on 2026-09-22:

- Model package full suite: **80/80**.
- CLI focused fallback regression: **3/3**.
- CLI full suite: **451/451**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` and `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 20: Sandbox expansion approval and bounded retry (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-sandbox-expansion.md` follows the Gemini
CLI study's `Tool -> sandbox -> capability denial -> explicit expansion`
boundary.

- [x] Preserve Rust `POLICY_DENIED` and `SANDBOX_DENIED` responses as typed
      sandbox errors with a bounded capability classification.
- [x] Add one-time Agent Core expansion approval and retry semantics.
- [x] Emit separate sandbox expansion request/resolution runtime events.
- [x] Keep built-in expansion network-only and preserve the original workspace
      limits.
- [x] Reuse CLI and Desktop approval transports while failing closed for
      non-interactive and MCP paths.
- [x] Keep ordinary approval cards separate from sandbox expansion cards.
- [x] Run focused and full TypeScript verification without publishing packages.

Verification completed on 2026-09-21:

- Agent Core: **176/176**.
- Executor: **57/57**.
- Tools: **159/159**.
- CLI: **450/450**.
- Desktop: **144/144**.
- `pnpm verify:typescript` passed.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 18: Tool-level sandbox execution (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-tool-level-sandbox-execution.md` follows
the Gemini CLI study's separation between the agent loop, built-in command
tools, and the restricted executor boundary.

- [x] Carry a provider-neutral sandbox profile through Agent Core tool context.
- [x] Route Shell, Git, and Search through `runSandboxed()` when a profile is
      present, with fail-closed behavior for non-sandbox executors.
- [x] Provide fixed read-only and workspace-write profiles and wire them into
      CLI, Desktop, and CLI MCP tool calls only when the executor supports
      sandboxing.
- [x] Close Rust executor child processes when CLI, Desktop, or MCP sessions
      end.
- [x] Update package and architecture documentation.
- [x] Run the final workspace verification gate and record its exact counts.

Verification completed on 2026-09-21:

- Agent Core full suite: **174/174**.
- Tools full suite: **158/158**.
- Executor full suite: **56/56**.
- CLI full suite: **444/444**.
- Desktop full suite: **144/144**.
- MCP full suite: **69/69**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed, including workspace build/typecheck,
  package install smoke, release-boundary contracts, preview contracts,
  documentation contracts, and native Desktop bundle contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 14: Local Scheduler and background-task lifecycle (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-scheduler-background-tasks.md` follows the
Gemini CLI Scheduler boundary while keeping work local, bounded, and attached
to the existing single-session prompt queue.

- [x] Add a FIFO `AgentTaskScheduler` with concurrency-one defaults,
      cancellation, confirmation-waiting state, bounded retention, and
      metadata-only snapshots.
- [x] Add `:tasks` and `:task <id>` with slash aliases to ANSI and Ink
      interactive sessions.
- [x] Wrap consumed interactive prompts in Scheduler tasks without moving
      input ownership away from the existing queue or duplicating output.
- [x] Run the complete core/CLI suites, behavior evaluations, TypeScript gate,
      and diff checks after the documentation update.

Verification completed on 2026-09-21:

- Agent Core full suite: **167/167**.
- CLI full suite: **439/439**.
- Desktop full suite: **143/143**.
- Tools full suite: **152/152**.
- Rich CLI behavior evaluations: **6/6**.
- Fixed `pnpm verify:typescript` gate passed.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 16: Unified Tool Registry (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-unified-tool-registry.md` follows the
Gemini CLI study's separation between the Agent Runtime and built-in tool
implementations. `@dev-agent/agent-core` is the canonical owner of the tool
contract and registry behavior; `@dev-agent/tools` remains the built-in tool
package with a compatibility registry export.

- [x] Lock the shared tool contract and metadata behavior with a package-level
      compatibility test.
- [x] Delegate the tools-package registry to `AgentToolRegistry` without
      changing public names or execution behavior.
- [x] Run focused tests, the TypeScript gate, rich CLI evaluations, and diff
      checks.

Verification for the registry implementation is recorded together with the
shared policy boundary below after the final repository gate.

### Phase 17: Shared Approval Policy (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-shared-approval-policy.md` follows the
Gemini CLI study's separation between runtime policy and UI interaction.

- [x] Move approval-mode selection into the Agent Core factory.
- [x] Keep CLI/Desktop/MCP-specific request and preparation adapters at the
      application boundary.
- [x] Run the complete core/tools/CLI/Desktop verification gates, behavior
      evaluations, and diff checks.

Verification completed on 2026-09-21:

- Agent Core full suite: **173/173**.
- Tools full suite: **153/153**.
- CLI full suite: **442/442**.
- Desktop full suite: **144/144**.
- MCP full suite: **69/69**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 9: Shared Prompt composition (complete)

The Gemini CLI study calls for named Prompt modules instead of a single large
system string. The executable plan is recorded in
`docs/superpowers/plans/2026-09-20-shared-prompt-composition.md`.

- [x] Add the shared `PromptModule` and deterministic `composePrompt` contract
      to Agent Core.
- [x] Extract the CLI base, evidence, language-audit, guardrail, and response
      contract guidance into named modules.
- [x] Compose active Skills and MCP metadata as optional runtime modules.
- [x] Use the same composition boundary for Desktop defaults while preserving
      the existing runtime metadata envelope and custom Prompt prefix.
- [x] Run the full Desktop suite, behavior evaluations, and final diff checks.

Verification completed on 2026-09-20:

- Agent Core full suite: **148/148**.
- CLI full suite: **419/419**.
- Desktop full suite: **140/140**.
- CLI rich-TTY behavior evaluations: **6/6**.
- Fixed `pnpm verify:typescript` gate passed, including Tools **152/152**,
  documentation contracts **57/57**, package install smoke, and release
  boundary contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 10: Hooks and metadata-only run observability (complete)

The Gemini CLI lifecycle-hook follow-up is specified in
`docs/superpowers/plans/2026-09-20-hooks-observability-integration.md` and
documented in `docs/trace-observability.md`.

- [x] Add timestamped, operation-correlated model/tool lifecycle metadata to
      Agent Core Hooks.
- [x] Add bounded `AgentRunTrace` retention with metadata-only snapshots and
      explicit dropped-run/span counters.
- [x] Attach one Hook registry and trace collector to each CLI/Desktop session.
- [x] Add `:trace` and `/trace` to the CLI command surface without changing
      JSON, pipe, `--once`, or MCP output.
- [x] Add the read-only Desktop
      `GET /api/sessions/<sessionId>/trace` endpoint with stable legacy-session
      behavior.
- [x] Document the privacy, retention, and local-only release boundary.
- [x] Run the complete TypeScript gate, rich CLI behavior evaluations, and
      whitespace checks.

Verification completed on 2026-09-20:

- Agent Core full suite: **153/153**.
- CLI full suite: **420/420**.
- Desktop full suite: **143/143**.
- `pnpm verify:typescript` passed, including the workspace build/typecheck,
  package install smoke, release-boundary contracts, and documentation
  contracts.
- `pnpm test:evals` passed **6/6**.
- `git diff --check` passed.
- No npm publish, tag, release, telemetry upload, or network package release
  was performed.

### Phase 11: Live TTY scrollback boundary (complete)

The follow-up plan at
`docs/superpowers/plans/2026-09-20-live-tty-scrollback-hardening.md` addresses
the remaining terminal behavior shown by the current TTY screenshots.

- [x] Reproduce the scrollback loss with a real Ink TTY render and a short
      terminal height.
- [x] Move the launch welcome surface into Ink static output.
- [x] Keep the active transcript and composer in the dynamic viewport.
- [x] Add a regression test proving a prompt update does not clear scrollback.
- [x] Run the full CLI suite, rich behavior evaluations, and diff checks.

Completed on 2026-09-20. Ink app tests passed **11/11**, the full CLI suite
passed **421/421**, and rich behavior evaluations passed **6/6**.
`pnpm verify:typescript` passed with workspace build/typecheck, Desktop
**143/143**, Tools **152/152**, documentation contracts **57/57**, package
install smoke, and release-boundary checks. `git diff --check` passed. No npm
publish, tag, release, or network package operation was performed.

Follow-up hardening completed on 2026-09-21:

- Submitted prompts are committed to Ink static scrollback as soon as their
  run starts.
- The dynamic frame filters out the submitted user entry, leaving the active
  assistant response, status, composer, and footer in the live viewport.
- A regression verifies the prompt is rendered exactly once before its answer
  completes, preventing duplicate frames and the tall blank viewport seen in
  earlier screenshots.
- CLI **443/443**, Agent Core **173/173**, Tools **153/153**, and rich CLI
  evaluations **6/6** passed. `git diff --check` passed.

### Phase 12: Session checkpoint rewind (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-20-session-checkpoint-rewind.md` follows the
Gemini CLI session/history direction while preserving this project's existing
no-cross-process-filesystem-undo boundary.

- [x] Add validated conversation-only rewind to FileMemory and InMemoryMemory.
- [x] Expose `:checkpoint`, `:checkpoints`, and `:rewind <checkpointId>` plus
      slash aliases in ANSI and Ink interactive sessions.
- [x] Keep summaries, evidence, workspace bytes, and later checkpoint behavior
      deterministic after rewind.
- [x] Run focused core/CLI tests, full TypeScript verification, behavior
      evaluations, and diff checks.

Verification completed on 2026-09-20:

- Agent Core full suite: **155/155**.
- CLI full suite: **425/425**.
- Rich CLI behavior evaluations: **6/6**.
- Fixed `pnpm verify:typescript` gate passed, including workspace
  build/typecheck, package install smoke, release-boundary contracts, and
  documentation contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 13: Metadata-only Extension Registry (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-20-extension-registry.md` follows the
Gemini CLI Extension boundary while keeping discovery fail-closed and local.

- [x] Add bounded project/user `extension.json` discovery with project
      precedence and stable surface counts.
- [x] Add `:extensions` and `:extension <id>` with slash aliases to ANSI and
      Ink interactive sessions.
- [x] Keep discovery metadata-only: no script loading, command execution,
      MCP startup, or policy mutation.
- [x] Run the full core/CLI suites, behavior evaluations, TypeScript gate, and
      diff checks.

Verification completed on 2026-09-20:

- Agent Core full suite: **158/158**.
- CLI full suite: **429/429**.
- Desktop full suite: **143/143**.
- Tools full suite: **152/152**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed, including workspace build/typecheck,
  package install smoke, release-boundary contracts, preview contracts, and
  documentation contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 15: Desktop MCP capability parity (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-desktop-mcp-capability-parity.md` follows
the Gemini CLI study's MCP boundary: one owned session manages tools,
resources, and prompts, while UI clients receive only bounded capability
metadata and runtime events.

- [x] Share the bounded MCP resource/prompt prompt formatter between CLI and
      Desktop.
- [x] Make Desktop register MCP resource and prompt adapter tools alongside
      native MCP tools.
- [x] Refresh the Desktop capability set on MCP list-change notifications and
      close every owned session deterministically.
- [x] Run focused MCP/Desktop tests, the TypeScript gate, rich CLI evaluations,
      and diff checks.

Verification completed on 2026-09-21:

- MCP capability formatter and lifecycle tests: **70/70**.
- CLI full suite: **442/442**.
- Desktop full suite: **161/161**.
- Tools full suite: **152/152**.
- Agent Core full suite: **168/168**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed, including workspace build/typecheck,
  package install smoke, release-boundary contracts, preview contracts, and
  documentation contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 19: Read-only session history command (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-session-history-command.md` adds a bounded
history view to both interactive CLI renderers without changing the model
context or workspace.

- [x] Add `:history [count]` and `/history [count]` with a default of 10 and
      a maximum of 50 entries.
- [x] Sanitize terminal controls, redact credential-shaped values, and bound
      each displayed entry.
- [x] Register the command in Ink hints, ANSI help, and CLI documentation.
- [x] Verify the command through focused unit tests and a persisted interactive
      CLI regression.

Verification completed on 2026-09-21:

- CLI full suite: **449/449**.
- Agent Core full suite: **176/176**.
- Tools full suite: **158/158**.
- Desktop full suite: **144/144**.
- Rich CLI behavior evaluations: **6/6**.
- `pnpm verify:typescript` passed, including workspace build/typecheck,
  package install smoke, release-boundary contracts, preview contracts, and
  documentation contracts.
- `git diff --check` passed.
- No npm publish, tag, release, or network package operation was performed.

### Phase 20: Desktop background-run reconnect (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-desktop-background-run-reconnect.md` keeps a
run alive when the user switches sessions and restores only its bounded,
not-yet-persisted fragments when the user returns.

- [x] Add a per-session bounded run registry with monotonic replay cursors.
- [x] Expose sanitized run snapshots and run summaries through the Desktop API.
- [x] Keep the existing SSE contract while allowing the old request to finish
      after a session switch.
- [x] Restore live assistant/reasoning/tool/approval state with stale-session
      guards and bilingual status labels.
- [x] Continue background recovery with a bounded cursor-based poll after
      returning to a running session.
- [x] Cover replay isolation, sanitization, retention, UI contracts, and
      terminal cleanup with focused tests.
- [x] Complete Desktop build, test typecheck, the full Desktop suite
      (**150/150**), and rendered browser smoke validation.
- [x] Resolve the Desktop test-process shutdown hang by closing test-owned HTTP
      connections and MCP-backed sessions.
- [x] Complete the workspace TypeScript gate after serializing the final
      verification run; current Desktop and CLI test processes exit cleanly.

### Phase 23: A2A Agent Server boundary (complete)

The implementation plan at
`docs/superpowers/plans/2026-09-21-a2a-agent-server.md` adds a local-first
A2A v1.0 boundary around the existing single-agent runtime. It is deliberately
not a multi-agent orchestrator.

- [x] Lock the A2A agent card, task lifecycle, stream, and cancellation
      contract with focused tests.
- [x] Add the reusable `@dev-agent/a2a` protocol and HTTP adapter package.
- [x] Connect CLI `--a2a` to the existing provider, AgentLoop, tools, policy,
      memory, MCP, and executor boundaries.
- [x] Keep card/task metadata bounded and free of credentials, raw tool inputs,
      workspace paths, and provider errors.
- [x] Document the local launch contract and ACP/A2A boundary.
- [x] Run focused A2A tests, CLI/Desktop suites, rich evaluations, the
      TypeScript release gate, and diff checks.

### Phase 24: Rich TUI viewport navigation and long-session scrollback (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-21-rich-tui-viewport-navigation.md`

This phase addresses the remaining concrete Rich TUI usability gap: long
sessions leave excessive empty space and cannot be browsed upward inside the
active view. It keeps the runtime event model unchanged and adds a bounded
presentation-layer viewport with fixed composer/footer behavior.

- [x] Lock the viewport contract and input precedence rules.
- [x] Implement bounded wrapped-row calculations, scroll offset, follow-output
      mode, resize clamping, and hidden-output indicators.
- [x] Integrate PageUp/PageDown/Home/End into the Rich Ink renderer without
      breaking completion, prompt history, approvals, Ctrl-C, Escape, or EOF.
- [x] Add unit, Ink integration, and PTY coverage for long sessions, streaming
      while scrolled, queue ordering, narrow widths, and resize.
- [x] Update Rich TUI documentation and complete focused/full verification.

Verification completed on 2026-09-22:

- Full CLI suite: **536/536**.
- Desktop suite: **150/150**.
- Repository TypeScript verification and `git diff --check`: passed.
- CLI typecheck and build: passed.
- Home/End raw terminal escape handling verified in Ink integration tests.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 44: Desktop stubbed-provider MCP isolation (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-23-desktop-stubbed-provider-mcp-isolation.md`

This test-isolation phase closes the same MCP-startup failure class that made
one provider-stubbed Desktop validation test depend on the host's configured
MCP servers.

- [x] Own `DEV_AGENT_MCP_SERVERS` in the shared Desktop validation test helper.
- [x] Default provider-stubbed validation tests to an empty MCP configuration.
- [x] Preserve explicit test-owned MCP overrides.
- [x] Add focused isolation coverage and verify the full Desktop and repository
      gates.

Verification completed on 2026-09-23:

- Focused Desktop validation suite: **12/12**.
- Full Desktop suite: **197/197**.
- Full CLI suite: **563/563**.
- CLI package-install smoke: passed.
- Full `pnpm verify:typescript`: passed all selected release, preview, CI,
  documentation, and native Desktop bundle contracts.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 45: CLI scheduler approval status (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-23-cli-scheduler-approval-status.md`

The CLI task scheduler already supports `waiting-for-confirmation`, but the
interactive AgentLoop did not bridge policy and sandbox-expansion waits into
the active task snapshot.

- [x] Add an optional AgentLoop observer for approval and sandbox-expansion
      waiting/resolution boundaries.
- [x] Bridge the observer to the currently scheduled CLI task and clear it
      after completion.
- [x] Cover normal approval, sandbox expansion, no-policy tool execution, and
      scheduler snapshot privacy.
- [x] Attempt the full CLI suite and record environment/test failures.
- [x] Pass the full CLI suite and repository TypeScript verification.
- [x] Review the focused diff and run `git diff --check`.

Verification completed on 2026-09-23:

- Full CLI suite: **566/566**.
- Final `pnpm verify:typescript` gate passed with Agent Core **196/196**,
  Tools **159/159**, Desktop **208/208**, CLI package-install smoke, and all
  selected release, preview, CI, documentation, and native Desktop contracts.
- Focused approval-status coverage and `git diff --check` passed.

Phase status: **complete**.

### Phase 43: CLI test build isolation (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-23-cli-test-build-isolation.md`

This phase preserves the CLI package smoke contract while removing the
repository-wide build from inside the active CLI test process.

- [x] Pin the CLI test lifecycle so package bundling completes before tests.
- [x] Have package-install coverage request `--skip-build` from the smoke
      script while retaining the direct smoke build path.
- [x] Add a focused contract for lifecycle ordering and skip-build behavior.
- [x] Run focused package-install coverage, the full CLI suite, and the
      repository TypeScript gate.

Verification completed on 2026-09-23:

- Focused package-install and isolation contract tests: **2/2**.
- Full CLI suite: **563/563**.
- Direct CLI package-install smoke: passed.
- Isolated Desktop suite after a one-test timing flake: **196/196**.
- Full `pnpm verify:typescript`: passed with CLI package-install smoke and all
  selected release, preview, CI, documentation, and native Desktop bundle
  contracts.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 39: MCP config command CLI parity (complete)

### Phase 41: Desktop conversation checkpoints and guarded rewind (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-23-desktop-conversation-checkpoints.md`

This phase closes the Desktop parity gap for bounded conversation checkpoints
without adding workspace rollback or a second history authority.

- [x] Expose FileMemory checkpoint creation, listing, and validated rewind
      through ChatSession.
- [x] Add active-run-protected Desktop routes for checkpoint creation,
      listing, and rewind.
- [x] Add a bounded checkpoint panel that reloads the session transcript after
      a confirmed rewind.
- [x] Preserve session isolation, queue pause behavior, and the no-workspace
      mutation guarantee.
- [x] Verify focused server/UI coverage and the full Desktop suite before
      documentation closure.

Verification completed on 2026-09-23:

- Focused checkpoint coverage: **4/4**.
- Focused plan-workflow regression: **5/5**.
- Full Desktop suite: **195/195**.
- Repository `pnpm verify:typescript`: passed, including CLI **561/561**,
  CLI package-install smoke, preview/release/CI contracts, documentation
  contracts, and native Desktop bundle contracts.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 42: Desktop runtime trace panel (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-23-desktop-runtime-trace.md`

This phase surfaces the existing bounded Desktop trace endpoint in the Runtime
Inspector without exposing prompts, tool inputs, tool output, paths, or raw
errors.

- [x] Add a localized `Trace` action and compact Runtime Inspector panel.
- [x] Render bounded run/span timing and status metadata only.
- [x] Add stale-session guards and reset behavior for new sessions.
- [x] Add focused UI contract coverage.
- [x] Run the full Desktop suite and repository TypeScript gate.

Verification completed on 2026-09-23:

- Focused trace UI contract: **1/1**.
- Full Desktop suite: **196/196**.
- Full CLI suite: **561/561**.
- `pnpm verify:typescript`: passed, including CLI package-install smoke,
  release/preview/CI contracts, documentation contracts, and native Desktop
  bundle contracts.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 39: MCP config command CLI parity (complete)

Implementation follows the Gemini CLI study's separation between a lightweight
configuration surface and the capability runtime: management commands are
metadata-only and never start a provider or MCP server.

- [x] Route explicit `mcp health`, `templates`, `enable`, and `disable`
      commands in the CLI entry point.
- [x] Add `mcp add --template` and stable output formatting for managed config
      results.
- [x] Keep the empty MCP summary contract synchronized after adding the
      disabled-server count.
- [x] Verify the focused MCP command and CLI integration suites.
- [x] Run the full TypeScript release gate without any release operation.

Verification completed on 2026-09-23:

- Focused MCP command suite: **10/10**.
- Focused MCP/config/parser integration suite: **15/15**.
- Full CLI suite: **561/561**.
- Full Desktop suite: **191/191**.
- `pnpm verify:typescript`: passed, including workspace build/typecheck,
  package smoke, release contracts, preview contracts, documentation
  contracts, and native Desktop bundle contracts.
- `git diff --check`: passed.

No npm publish, tag, GitHub Release, signing, notarization, or package upload
was performed.

### Phase 39: CLI Ink-only interactive input migration (complete)

This slice removes the legacy raw-ANSI input path from interactive TTY
sessions. Ink is now the sole TTY renderer and owns prompt editing, cursor
movement, queueing, approvals, redraws, and cancellation. Pipe and other
non-TTY modes keep their line-oriented `readline` contract.

- [x] Remove `RichInputController`, `RichPromptQueue`, and `tui-input.ts`.
- [x] Make `resolveTuiRenderer()` ignore the legacy `DEV_AGENT_TUI=ansi`
      selector and always choose Ink for eligible TTY sessions.
- [x] Remove the old ANSI PTY interaction coverage and keep Ink queue,
      cursor, approval, scroll, and cancellation coverage.
- [x] Update active CLI and architecture documentation to describe Ink as the
      only interactive TTY renderer.

Verification completed on 2026-09-22:

- CLI typecheck and build passed.
- Full CLI suite: **549/549**.
- CLI package-install smoke: passed as part of the full suite.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 39: Multi-agent collaborative execution (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-multi-agent-execution.md`

This phase upgrades `:team` from read-only specialist planning to a bounded
execution workflow. Tasks are planned as a validated DAG, run in isolated Git
worktrees, exposed through the Ink task board, and kept behind an explicit
user-confirmed merge.

- [x] Add provider-neutral Agent Core execution with parallel tasks, retries,
      task cancellation, blocked dependents, and bounded review events.
- [x] Add Git worktree isolation, tracked/untracked overlays, diff inspection,
      cleanup, and fail-closed merge conflict checks.
- [x] Add `:team <request>`, `:team plan`, `:team apply`, `:team retry`, and
      `:team cancel` to the interactive CLI sessions.
- [x] Add the Ink collaboration snapshot and live task status panel.
- [x] Add focused and interactive integration coverage.
- [x] Run the repository-wide TypeScript/release verification gate.

Status on 2026-09-22: phase complete. `pnpm verify:typescript` passed,
including the workspace build, typecheck, full TypeScript test suites, CLI
package-install smoke test, release/preview/documentation contracts, and
native Desktop bundle contracts. The focused collaboration matrix passed
21/21, and `git diff --check` passed.

### Phase 35: Agent workbench next slice (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-agent-workbench-next-slice.md`

This phase follows the Ink migration with the agent-facing workflow features
that make a local coding session safer and easier to inspect.

- [x] Add interactive Plan Mode with exact reviewed change-set apply.
- [x] Normalize provider reasoning across streamed and non-streamed responses.
- [x] Preserve tool timeline, retry, cancellation, and repeated-failure recovery
      behavior in the Ink session.
- [x] Add a first-use provider/model setup command that never stores credentials.
- [x] Add provider-free `mcp add` / `mcp remove` configuration management.
- [x] Add bounded parallel `:team <request>` specialist planning and synthesis.
- [x] Run the final full CLI, package, behavior-evaluation, and diff verification
      gates.

Verification completed on 2026-09-22:

- Model provider suite: **80/80**.
- Agent Core suite: **181/181**.
- CLI suite: **559/559**.
- Rich CLI behavior evaluations: **8/8**.
- CLI package smoke: passed.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 35: Codex-inspired Desktop workspace layout (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-codex-style-desktop-layout.md`

This slice reshapes the browser Desktop into a Codex-inspired workspace shell
while keeping Signal Loom branding, the vanilla controller, and the existing
agent/server contracts.

- [x] Add the workspace identity, session navigation, conversation context,
      composer metadata, and optional Runtime Inspector regions.
- [x] Apply the dark Codex-like rail/canvas hierarchy, centered message stream,
      sticky composer, blue focus frame, and responsive 390px layout.
- [x] Resolve the legacy `#new-session` specificity collision that caused the
      action label to overlap the session heading.
- [x] Restore persisted sessions on first status inspection so sidebar
      switching does not produce a false `/api/status` 404.
- [x] Add served HTML/CSS and persisted-session status regressions.
- [x] Add independent collapse controls for the session rail and Runtime
      Inspector, including compact-width drawer behavior and local preference
      persistence.

Verification completed on 2026-09-22:

- Focused layout contract coverage: **3/3**.
- Status API coverage: **15/15**.
- Full Desktop suite: **178/178**.
- Browser smoke: desktop screenshot review at 1440x900, Inspector open/close,
  blue composer focus, session switching, persisted-session status recovery,
  and 390x844 no-horizontal-overflow check.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 28: Desktop fixed-port lifecycle (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-port-lifecycle.md`

This phase keeps the browser Desktop URL deterministic. A healthy existing
dev-agent instance on the requested port is reused; an unrelated process
causes an explicit startup error; no fallback to 4318, 4319, or another
implicit port is allowed.

- [x] Validate the configured host and port before binding.
- [x] Probe and reuse an existing healthy Desktop instance.
- [x] Refuse unrelated port owners without automatic port drift.
- [x] Preserve the native macOS launcher cleanup behavior.
- [x] Add process-level lifecycle tests and update Desktop documentation.

Verification completed on 2026-09-22:

- Port lifecycle tests: **2/2**.
- Desktop suite: **152/152**.
- Rich TUI evaluations: **8/8**.
- CLI suite: **538/538**.
- Final workspace TypeScript gate and `git diff --check`: passed.

Phase status: **complete**.

### Phase 25: Historical session browser and resume switching (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-21-session-resume-plan.md`

This phase adds a bounded session registry, Ink picker, interactive
`:sessions`/`:resume` commands, and `--resume` startup support without changing
the persisted memory schema or legacy `--session-list` contract.

- [x] Scan only safe session JSON files and expose bounded metadata/previews.
- [x] Add sanitized search and `/`/`:` command aliases.
- [x] Add Ink picker selection, dismissal, and session-switch callbacks.
- [x] Reject switching while a run, approval, or queued prompt is active.
- [x] Add `--resume` validation, missing-session errors, and conflict handling.
- [x] Document the picker controls, idle-only rule, and resource limits.

Verification completed on 2026-09-21:

- Registry/parser tests: **7/7**.
- CLI resume/ANSI switching focused tests: **6/6**.
- Ink picker and command-palette focused tests: **3/3**.
- Full CLI suite: **532/532**.
- Agent Core suite: **176/176**.
- MCP suite: **70/70**.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 26: Eight-hour Rich TUI evaluation closure (complete)

Executable plan:
`docs/superpowers/plans/2026-09-22-eight-hour-continuation.md`

This phase is the active 8-hour development target. It preserves the existing
runtime architecture, closes the known PTY startup-clear regression, completes
the remaining Rich TUI evidence, and leaves one evidence-backed Desktop plan
ready for the next slice.

- [x] Reproduce and trace the first-render terminal-dimension boundary.
- [x] Fix the full-frame clear regression with a narrow regression test.
- [x] Add the missing resize-focused PTY assertion.
- [x] Re-run queue, Ctrl-C, Escape, approval, tool-card, EOF, and viewport
      interaction coverage.
- [x] Finish the Phase 24 plan, progress log, and task-plan evidence.
- [x] Audit the Desktop surface and write the next bounded Desktop plan.
- [x] Run the CLI full suite and record its result: **536/536** passed.
- [x] Run `pnpm verify:typescript` and `git diff --check`.

Phase status: **complete**.

### Phase 27: Desktop live-scroll recovery affordance (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-next-slice.md`

This phase closes the Desktop conversation's remaining discoverability gap:
readers who manually scroll above a live response now receive a localized,
accessible “new output below” control without changing the SSE protocol or
forcing the transcript back to the bottom.

- [x] Add a flex-contained conversation stream with a hidden-by-default
      jump-to-latest control.
- [x] Preserve manual scroll position while reasoning, tokens, tools,
      approvals, validation, and errors append output.
- [x] Clear pending output when the reader reaches the bottom or activates the
      control, and reset it across history/session transitions.
- [x] Keep the behavior bilingual and keyboard/focus accessible.
- [x] Run the Desktop suite, Rich TUI evaluations, CLI suite, TypeScript
      release gate, and diff checks.

Verification completed on 2026-09-22:

- Desktop suite: **152/152**.
- Rich TUI evaluations: **8/8**.
- CLI suite: **536/536**.
- `pnpm verify:typescript`: all selected gates passed.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 29: Desktop message queue and turn isolation (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-message-queue-and-turn-isolation.md`

This phase brings the Desktop composer in line with the verified Rich TUI
queue behavior. Prompts submitted during an active run become bounded FIFO
waiting items, and every response/tool/approval/replay update remains attached
to the turn that created it.

- [x] Lock bounded queue, terminal-state, and replay-idempotency contracts with
      RED tests.
- [x] Add per-session in-memory prompt queues with visible queued rows and
      cancellation controls.
- [x] Drain queued prompts only after a normal terminal answer, preserving
      approval, failure, abort, and session-switch semantics.
- [x] Replace global assistant/reasoning references with turn-owned rendering.
- [x] Make history hydration and background run recovery sequence-idempotent.
- [x] Add Desktop regressions for queue ordering, duplicate frames, approvals,
      retry, stop, failure, scroll-follow, and session isolation.
- [x] Run local browser smoke, Desktop/CLI suites, Rich TUI evaluations,
      `pnpm verify:typescript`, and `git diff --check`.

Verification completed on 2026-09-22:

- Provider-stubbed browser smoke: FIFO queue, turn isolation, and
  switch-away/switch-back recovery, and post-terminal late-frame rejection
  passed on an ephemeral local port.
- Desktop suite: **161/161**.
- CLI suite: **543/543**.
- Rich TUI evaluations: **8/8**.
- `run-replay-ui` focused regression: **1/1**.
- `pnpm verify:typescript`: all selected gates passed.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 30: Rich TUI single-source transcript and wheel-scroll hardening (complete)

Implementation note:
`docs/superpowers/plans/2026-09-21-rich-tui-viewport-navigation.md`

This follow-up closes the remaining Rich Ink usability issue observed after
Phase 24: a long history could leave a sparse active turn separated from the
composer by a large blank viewport, while transcript history could be rendered
through both Static scrollback and the manual viewport. Mouse-wheel navigation
is now a first-class input path when raw terminal mode is available.

- [x] Reproduce the sparse active-turn blank-region case after long history.
- [x] Make the bounded dynamic viewport the single transcript rendering source;
      keep only the launch welcome panel static.
- [x] Parse SGR and legacy X10 mouse-wheel events and clean up terminal
      tracking on unmount.
- [x] Add focused regressions, update the CLI help/docs, and preserve prompt,
      queue, approval, Ctrl-C, Escape, and EOF behavior.
- [x] Run the full CLI suite, Rich TUI evaluations, TypeScript verification,
      and diff checks.

Verification completed on 2026-09-22:

- Focused Ink/viewport/mouse-wheel coverage: **41/41**.
- Full CLI suite: **543/543**.
- Rich TUI evaluations: **8/8**.
- Desktop suite remains **161/161** from Phase 29.
- No package publish, tag, release, or network package operation was performed.

Phase status: **complete**.

### Phase 31: CLI startup interrupt hardening (complete)

This small reliability phase closes a startup race exposed by the aggregate
workspace gate. Provider-free commands must handle SIGINT even while the
heavier CLI command module is still loading.

- [x] Add an early CLI bootstrap that installs SIGINT before dynamic command
      loading.
- [x] Pass the early abort signal into `index refresh` and preserve its stable
      cancellation response and exit code.
- [x] Keep the interactive CLI, package bundle, and existing command contracts
      unchanged.
- [x] Verify the focused regression under concurrent Desktop load, the full
      CLI suite, and npm package smoke.

Verification completed on 2026-09-22:

- Focused startup-interrupt regression: **1/1** alone and under concurrent
  Desktop test load.
- Full CLI suite: **543/543**.
- CLI package smoke: passed.
- Final `pnpm verify:typescript` aggregate gate: all selected gates passed,
  including Desktop **161/161**, CLI **543/543**, package smoke, release
  contracts, documentation contracts, and native Desktop bundle contracts.
- Final `git diff --check`: passed.

Phase status: **complete**.

### Phase 32: Desktop waiting-queue reload recovery (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-queue-recovery.md`

This follow-up restores only prompts that were explicitly waiting in the
browser queue. It uses page-scoped bounded storage so a reload does not erase
queued work, while active runs, transcripts, reasoning, and tool output remain
non-persistent.

- [x] Add versioned, TTL-bound `sessionStorage` serialization with fixed item,
      prompt, and byte limits.
- [x] Hydrate each session queue once and persist only waiting items after
      queue mutations.
- [x] Migrate queue state on rename and clear it after successful deletion.
- [x] Add malformed, expired, unavailable-storage, and cross-session
      fail-closed coverage.
- [x] Verify the reload flow and expiry cleanup in a real browser.

Verification completed on 2026-09-22:

- Focused persistence/UI coverage: **5/5**.
- Full Desktop suite: **165/165**.
- Browser smoke: valid reload recovery and expired-snapshot cleanup passed.
- No server, SSE, session-memory, provider, package, or release behavior
  changed.

Phase status: **complete**.

### Phase 33: Desktop session discovery filters (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-session-filter.md`

This slice makes the session rail easier to scan as more sessions accumulate.
Filtering remains client-side and operates only on the bounded session
summaries already returned by the Desktop API.

- [x] Add case-insensitive session-id search with source-order preservation.
- [x] Add idle/running/waiting/done/failed/aborted status filtering.
- [x] Keep the current session visible while a filter is active.
- [x] Add bilingual labels, placeholders, status options, and empty results.
- [x] Keep the controls keyboard accessible and responsive on small screens.
- [x] Run focused tests, the full Desktop suite, and a browser interaction
      smoke on an ephemeral local port.

Verification completed on 2026-09-22:

- Focused session-filter and UI contract tests: **4/4**.
- Full Desktop suite: **168/168**.
- Browser smoke: search, status filtering, current-session retention,
  bilingual labels, and empty-result behavior passed with no console errors.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 34: Desktop run activity indicators (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-run-activity.md`

This slice makes an active turn understandable without exposing hidden model
chain-of-thought. The browser derives a safe stage label from existing stream
events and bounded run replay.

- [x] Add queued, thinking, tool, responding, approval, and terminal activity
      labels for each turn.
- [x] Keep activity state turn-owned across session switching and recovery.
- [x] Make all activity labels bilingual and refresh them live on language
      changes.
- [x] Let terminal state replace stale activity from replay or live fragments.
- [x] Add mapping/UI regressions and run a delayed-SSE browser smoke.

Verification completed on 2026-09-22:

- Focused activity/UI coverage: **3/3**.
- Full Desktop suite: **172/172**.
- Browser smoke: delayed reasoning/tool/response stages, Chinese switching,
  terminal cleanup, and console cleanliness passed.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 36: Desktop assistant response copy and hidden-state hardening (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-assistant-copy.md`

This slice adds a small copy action to each assistant response segment and
closes a CSS regression where author `display` rules could override the native
`hidden` attribute on completed-turn queue actions.

- [x] Add a bounded clipboard helper with asynchronous API and DOM fallback.
- [x] Attach copy controls to the exact assistant segment, including streamed,
      historical, and recovered responses.
- [x] Add English/Chinese copy, copied, and failure labels with live refresh.
- [x] Add a global hidden-state rule and a stylesheet contract regression.
- [x] Run focused tests, the full Desktop suite, browser smoke, and diff
      checks.

Verification completed on 2026-09-22:

- Focused copy/UI coverage: **4/4**.
- Full Desktop suite: **178/178**.
- Browser smoke: clipboard readback, bilingual copied state, hidden completed
  actions, and zero console errors.
- Full `pnpm verify:typescript` gate passed, including CLI **559/559**,
  package install smoke, release contracts, documentation contracts, and the
  native Desktop bundle contract.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 37: Desktop assistant Markdown rendering (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-markdown-rendering.md`

This slice makes assistant responses readable as structured content while
preserving the existing streaming, session, and copy contracts.

- [x] Add safe rendering for common Markdown blocks and inline syntax.
- [x] Escape HTML and reject unsafe link protocols.
- [x] Apply the renderer to streamed, historical, and recovered responses.
- [x] Preserve raw Markdown for exact copy actions.
- [x] Run focused tests, the full Desktop suite, browser smoke, and diff
      checks.

Verification completed on 2026-09-22:

- Focused Markdown and UI coverage: **8/8**.
- Full Desktop suite: **182/182**.
- Browser smoke: rendered structure, clipboard readback, script
  non-execution, and zero console errors.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 38: Desktop code-block copy actions (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-code-block-copy.md`

This slice adds independent copy controls to rendered fenced code blocks while
keeping whole-response copy exact and preserving the Markdown safety boundary.

- [x] Add one copy action per rendered fenced code block.
- [x] Copy only the selected block's visible code text.
- [x] Add bilingual copied and failure states with live language refresh.
- [x] Keep assistant-response copy bound to the original raw Markdown source.
- [x] Run focused tests, the full Desktop suite, browser smoke, and diff
      checks.

Verification completed on 2026-09-22:

- Focused Markdown/UI coverage: **5/5**.
- Full Desktop suite: **183/183**.
- Browser smoke: exact code-block clipboard readback, Chinese copied state,
  whole-response copy retention, and zero console/page errors.
- Final `pnpm verify:typescript` gate passed with Agent Core **188/188**,
  Desktop **183/183**, CLI **562/562**, package install smoke, and all
  selected release, documentation, and native Desktop contracts.
- `git diff --check`: passed.

Phase status: **complete**.

### Phase 40: Desktop Plan/Review/Apply/Validate/Undo workflow (complete)

Implementation plan:
`docs/superpowers/plans/2026-09-22-desktop-plan-review-apply-validate-undo.md`

This phase closes the browser-side coding-agent workflow while preserving the
existing prompt queue, turn ownership, SSE contracts, approvals, validation,
and evidence guards.

- [x] Add a shared plan-mode contract to ChatSession and AgentLoop.
- [x] Project the shared `plan-review` event into a bounded Desktop review.
- [x] Add session-owned pending-plan apply and reject routes with active-run
      and cancellation protections.
- [x] Add an Execute/Plan composer selector and preserve mode in queued and
      persisted prompts.
- [x] Render turn-owned, bilingual plan review cards with per-file diff
      collapse and explicit apply/reject actions.
- [x] Apply the stored reviewed change set without another model turn, stream
      trusted validation, and pause the queue on failure or abort.
- [x] Keep guarded undo available only while the applied postimage still
      matches, and surface conflict, missing, success, and failure states.

Verification completed on 2026-09-23:

- Focused plan/queue/replay/activity coverage: **19/19**.
- Full Desktop suite: **191/191**.
- Rich CLI behavior evaluations: **8/8**.
- Repository-wide `pnpm verify:typescript` passed all selected gates with
  Agent Core **188/188**, Tools **159/159**, CLI **561/561**, Desktop
  **191/191**, CLI package-install smoke, release/preview/documentation
  contracts, and native Desktop bundle contracts.
- `git diff --check`: passed.

Phase status: **complete**.


## 2026-09-23 Claude Agent SDK optional integration

- Added optional `packages/claude-agent-sdk` integration for
  `@anthropic-ai/claude-agent-sdk@0.3.280`. It disables native tools, isolates
  filesystem/settings/MCP configuration, exposes only allowlisted project tools
  through an in-process MCP server, routes permission decisions through the
  existing `ApprovalPolicy`, and passes the existing session/cwd/signal/sandbox
  context into tool execution. The default single-file CLI remains unchanged so
  the platform-native Agent SDK runtime is not bundled accidentally.

## 2026-09-24 Claude Agent SDK permission-boundary hardening

The optional adapter's initial `canUseTool` integration was not sufficient as
an independently verified execution boundary because the in-process MCP
handler is a separate seam and does not expose the SDK tool-use id. This
follow-up closes that gap without changing the default CLI runtime.

- [x] Enforce the existing `ApprovalPolicy` again at the project-owned MCP
      handler when no matching preflight decision is available.
- [x] Bind preflight allow/deny results to one canonical input, preserve
      reviewed `updatedInput`, and bound/expire pending authorization state.
- [x] Add real MCP client/server transport regressions for deny, allow,
      reviewed input, direct handler execution, bounded errors, allowlist
      isolation, and cancellation.
- [x] Rebuild, typecheck, run the focused package suite, and run serial
      workspace build/typecheck/tests. Re-run the full release gate after the
      final documentation synchronization.

Focused evidence on 2026-09-24: `@dev-agent/claude-agent-sdk` **12/12**;
workspace build/typecheck/tests passed, with current CLI **629/629** and
Desktop **222/222** observed. The full post-edit release-gate report remains
to be regenerated before claiming final repository-wide closure.

## 2026-09-24 Claude Agent SDK post-hardening closure

- The handler-level approval boundary is now verified with real MCP transport
  tests, not only direct bridge/unit tests.
- `HOME=/private/tmp/dev-agent-test-home
  DEV_AGENT_PACKAGE_SMOKE_NPM_CACHE=/Users/Admin/.npm pnpm verify:typescript
  --report` passed after the change and documentation sync. Current evidence:
  CLI **629/629**, Desktop **222/222**, Claude adapter **12/12**,
  documentation **60/60**, native Desktop contracts **2/2**, and package smoke.
- No commit, tag, publish, or push was performed.

## 2026-09-24 Claude Agent SDK lifecycle cleanup correction

- [x] Clear unused one-use MCP authorization bindings when the host query
      lifecycle ends, and cover the explicit bridge cleanup seam.

The focused adapter suite is now **13/13**. The previously recorded **12/12**
count referred to the state before this lifecycle regression was added.

## 2026-09-24 Next nine Desktop workflow features (complete)

The nearest unfinished Desktop workflow slice was completed as nine bounded
features: review-comment durability and insertion, diff keyboard navigation,
terminal reconnect/gap recovery, terminal clear/export, loopback preview
lifecycle, post-terminal workspace refresh, opt-in GitHub metadata probing,
skills/job metadata projection, and read-only monitoring/approval boundaries.

Browser acceptance also fixed the session-bootstrap ordering so the selected
session is loaded before workspace, terminal, and capability panels refresh.
The dark-mode status-panel background was made theme-aware. Final evidence and
commands are recorded in `.planning/2026-09-24-next-nine-features/`.

Status: **complete**. No commit, tag, publish, or push was performed.

## 2026-09-24 Claude Agent SDK lifecycle-cleanup final gate

- [x] Clear unused preflight authorization bindings at query end.
- [x] Add and pass the focused cleanup regression (**13/13**).
- [x] Regenerate the repository-wide TypeScript gate after lifecycle cleanup.
- [x] Re-run documentation and diff checks.

Final gate evidence: report status `passed`; CLI **629/629**, Desktop **222/222**,
Claude adapter **13/13**, documentation **60/60**, native Desktop **2/2**, and
CLI package smoke all passed. `git diff --check` passed. No commit, tag,
publish, or push was performed.
