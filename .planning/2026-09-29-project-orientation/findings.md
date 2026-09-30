# Project orientation findings

## Repository state

- The repository is a pnpm 12.3.4 workspace requiring Node >=22; the checkout
  currently reports Node 26 in .nvmrc documentation.
- Root package scripts expose build, typecheck, serial workspace tests, the
  TypeScript/Rust/integration release gates, CLI behavior evaluations, package
  smoke, runtime smoke, and guarded release helpers.
- The current branch is codex/desktop-cli-workbench, two commits ahead of its
  origin, with broad pre-existing and current uncommitted changes. Resets,
  cleanup, and unrelated overwrites are forbidden.
- The current uncommitted product diff is concentrated in apps/cli, its docs
  and tests, root/docs metadata, and the Ink dependency lock update. Untracked
  .mimosa/ and .zcode/ files are tool/session artifacts and are preserved.

## Architecture baseline

- User-facing edges are the rich CLI, provider-free/non-interactive CLI modes,
  Desktop local web server, ACP stdio bridge, A2A loopback HTTP/SSE bridge, and
  MCP stdio server mode.
- packages/agent-core owns the AgentLoop, context/memory, approval, runtime
  events, checkpoints, skills/agents/extensions, scheduler, trace, validation,
  and bounded collaborative execution.
- packages/tools owns the registry plus filesystem, shell, git, search, code
  search, change-set, and validation tools; packages/executor owns local and
  Rust-backed execution and sandbox profiles.
- packages/model normalizes OpenAI, Anthropic, Gemini, and Ollama streaming,
  retries, cancellation, usage, pricing, and bounded response handling.
- packages/mcp owns client/session/server framing and tools/resources/prompts;
  packages/code-intelligence owns multi-language indexing and references.
- runtime/rust is the active low-level sandbox/isolation runtime, while
  packages/runtime-manager handles explicit verified runtime distribution.

## Current workstream

- The completed Ink 7.1.1 adoption uses native usePaste, alternateScreen,
  and suspendTerminal, plus project-owned bounded input/editor safeguards.
- The :editor command is idle-only, bounded to 8,000 characters, uses a
  private temp file and shell: false, and injects its result through the
  ref-backed composer state. Its plan records a green 751/751 CLI suite and
  60/60 documentation contracts after the Ink upgrade follow-up.
- The current source tree also contains concurrent managed scrolling and
  conversation-status changes in the Ink surface; claims about the full CLI
  suite must be checked against the latest run rather than older plan counts.

## Source-verified runtime shape

- `AgentLoop.run()` is the single model/tool turn engine. It appends the user
  entry, emits session/run/status events, applies context and run budgets,
  forwards cancellation to model and tools, routes tool calls through the
  registry and approval policy, and records usage/memory before terminal
  events. `toolAccess: "none"` gives callers a no-tools model turn.
- `AgentLoop` keeps application concerns injectable: model, tool collection,
  event sink/sequence, hooks, approval, validation, sandbox profile resolver,
  expansion decisions, and UI-neutral callbacks. This is why CLI, Desktop,
  ACP, A2A, and MCP edges can reuse the same runtime rather than fork agent
  behavior.
- The repository's documentation matches a layered product: user-facing
  adapters at `apps/*`, reusable policy/runtime packages under `packages/*`,
  and the Rust executor at `runtime/rust`. The active uncommitted diff is
  confined to the CLI/Ink/editor workstream plus documentation/manifests and
  planning artifacts; no product changes were made in this orientation pass.

## Security and execution boundaries

- Built-in tools are deliberately split: `filesystem` handles bounded reads
  and reviewed change sets; `shell`/`git` delegate to an injected executor;
  `code-search` is read-only and indexes TS/JS/Python/Rust. Tool execution
  always receives the session cwd and abort signal, and the shared tool wrapper
  aborts timed-out work rather than merely racing an unresolved promise.
- The executor abstraction has a local process-group implementation and an
  optional Rust protobuf child. Both enforce output/concurrency limits and
  cancellation; the Rust side additionally carries sandbox profiles, framed
  transport limits, and a bounded response protocol.
- Desktop `ChatSession` constructs the same core loop with default tools,
  file-backed memory, provider selection, validation, approval, MCP sessions,
  sandbox expansion, usage/cost reporting, and metadata-only trace capture.
  Its HTTP server owns session/run serialization, SSE projection, approval
  response endpoints, plan apply/reject, checkpoint/rewind, evidence, task
  workspaces, terminal/validation routes, and loopback/capability checks.

## Verification snapshot

- `node --test tests/documentation-contract.test.mjs` passed all 60 tests.
- A targeted run of `Ink TTY buffers text typed before the first composer frame`
  failed at `apps/cli/tests-dist/interactive.test.js:847`: the stub provider
  observed 2 requests instead of the expected 1. The test process also kept a
  provider server alive after rejection, so the command needed an explicit
  timeout to terminate.
- A targeted run of `Ink TTY composes a prompt in $EDITOR and loads it into the
  composer` showed `Editor draft loaded` and the draft text, but the PTY output
  then showed the draft entering a run; the test's Ctrl-C did not produce EOF.
  `waitForExit` failed after 20,000 ms. This is a real current-worktree test
  failure, not evidence that the editor feature is fully green.
- The prior plan's `751/751` CLI claim is historical and must not be used as the
  current verification result. The latest full CLI run was not retained as a
  complete report; only the two targeted failures above and the independent
  60/60 documentation result are evidence for this orientation pass.

## Repair-phase source findings

- The current CLI source already uses Ink 7's `suspendTerminal` for `:editor`, while `InkRuntimeStore.inputSuppressed` and the app's `useInput` guard attempt to consume one replayed input event after suspension.
- The first-frame regression is not fixed by the existing ref-backed composer alone: the interactive loop can receive a prompt before Ink has rendered the first composer frame, and pending PTY bytes are still eligible to be interpreted again when the first input listener/frame boundary settles.
- `InkUiController.submit` delivers directly to the interactive loop when its waiter exists and queues otherwise; therefore duplicate provider requests indicate duplicate submit events, not merely queued-display state.
- The editor regression is at the handoff boundary: the external editor draft is inserted into the composer, but terminal input can replay bytes around Ink's suspension restore. Those bytes can include an unintended Enter, causing the loaded draft to submit before the test's later Ctrl-C.
- After rebuilding `apps/cli/dist` and `apps/cli/tests-dist` from the current checkout, both named PTY tests pass. The relevant suppression/drain implementation is already committed in `5894d51`; the current source diff is limited to an unrelated command-palette change in `apps/cli/src/ink/app.tsx`.
- Stability evidence: two additional runs of each PTY regression passed, and
  the complete Ink-focused test set passed 124/124.
- Final verification: the complete CLI suite passed 757/757 and
  `node --test tests/documentation-contract.test.mjs` passed 60/60. The
  checkout remains free of new product-code changes from this repair turn.
