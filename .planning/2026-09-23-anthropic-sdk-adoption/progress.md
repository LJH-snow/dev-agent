# Progress — Anthropic SDK adoption

## 2026-09-23
- Confirmed the active Codex goal and inspected current git state. Several unrelated files are already modified/untracked; no resets or broad cleanup.
- Created an isolated task plan to avoid overwriting the repository's active project plan and existing planning work.
- Verified no Context7 MCP resources are available; official Anthropic docs are the fallback.
- Initial architecture finding: direct Anthropic API support exists already, but it is handwritten; Claude Agent SDK would overlap the existing `AgentLoop` and must be isolated behind a safe optional runtime.

- Baseline `pnpm --filter @dev-agent/model test` passes **92/92** before implementation.
- Chose a release-age-eligible Anthropic TypeScript SDK release (`0.126.0`, published 2026-09-15) rather than the newest just-published version, preserving the workspace's dependency-age policy. The install command also inserted an unnecessary exception for `0.128.0`; that local side effect will be removed.

## 2026-09-23 — Phase B implementation and focused verification

- Replaced the handwritten Anthropic Messages request/response transport in
  `packages/model/src/anthropic.ts` with the official `@anthropic-ai/sdk`
  client behind the existing `ModelProvider` adapter. The provider still owns
  the shared retry policy (`withRetry`, including Retry-After), caller
  cancellation, tool/message mapping, usage accounting, and model-gated
  thinking options.
- Set the SDK retry budget to zero so the project retry policy remains the only
  retry loop. Injected fetch is retained as a test/proxy seam. Omitted API keys
  explicitly disable SDK environment credential discovery to preserve the old
  no-auth local-proxy/test behavior.
- Added an adapter fetch boundary that bounds successful JSON to 16 MiB,
  bounds error bodies to 16 KiB before SDK parsing, preserves redaction, and
  wraps streamed SSE bodies with the existing 1 MiB line limit and output
  cancellation. Official event-named SSE is supported; legacy data-only test
  fixtures remain structurally compatible.
- Added regressions for official SDK event-named streams and SDK API-error
  redaction. Model package typecheck/build and tests pass **94/94**.
- Updated `packages/model/README.md` to describe the SDK-backed Anthropic
  adapter. The dependency is now used by source code rather than being an
  unused manifest-only change.

Phase B status: **complete**. Phase C is complete as an optional
`@dev-agent/claude-agent-sdk` adapter: native tools are disabled, project-owned
allowlisted tools are exposed through an in-process MCP bridge, and approval,
sandbox context, cancellation, and execution remain owned by dev-agent. The
existing default runtime remains unchanged; no unsafe runtime switch was added.


## 2026-09-23 — Phase D completion and final verification

- Added the final SDK adapter documentation and kept the existing provider
  contract as the only public integration surface. Legacy data-only SSE
  fixtures that omit `type` are normalized only at the bounded SDK fetch seam;
  official event-named SSE remains the normal path.
- Rebuilt and typechecked `@dev-agent/model`; the complete focused model suite
  passes **94/94**.
- Ran `git diff --check` and the completed:
  `HOME=/private/tmp/dev-agent-test-home DEV_AGENT_PACKAGE_SMOKE_NPM_CACHE=/Users/Admin/.npm pnpm verify:typescript --report`.
  The gate passed structure, workspace build/typecheck/tests, CLI **629/629**,
  Desktop **217/217**, model **94/94**, package-install smoke, release/preview/CI
  contracts, documentation **60/60**, and native Desktop contracts **2/2**.
- Phase D is complete. Phase C is complete as the optional adapter described
  above; native tools stay disabled and the default CLI runtime remains unchanged.

- A later documentation-only gate rerun was stopped after the package smoke's
  nested workspace build left a Node/TypeScript child idle for more than eight
  minutes. It did not modify source or user files; the existing passing gate
  report remains intact. The standalone `pnpm package:smoke -- --skip-build`
  check and the post-edit documentation contract suite both passed.


## 2026-09-23 — Phase C adapter implementation and final gate

- Added `packages/claude-agent-sdk` with `@anthropic-ai/claude-agent-sdk@0.3.280`,
  Zod schema conversion, and an in-process MCP bridge for project-owned tools.
- The adapter sets `tools: []`, `settingSources: []`, `strictMcpConfig: true`, and
  `permissionPrompts: "host"`; missing approval policy denies calls. It forwards
  session/cwd/signal/sandbox context, reviewed inputs, progress, bounded output,
  streaming text/reasoning, and cancellation.
- Adapter tests pass **7/7**. Full `pnpm verify:typescript --report` passes
  structure, build, typecheck, serial workspace tests (CLI **629/629**, Desktop
  **217/217**, model **94/94**), package smoke, release/preview/CI contracts,
  documentation **60/60**, and native Desktop contracts **2/2**.
- The adapter remains opt-in and is not bundled into the default CLI, because the
  Agent SDK includes a platform-native runtime.


## 2026-09-24 final verification

- Rebuilt and typechecked the adapter after its bounded truncation correction;
  focused adapter tests pass **7/7**.
- The full TypeScript release gate passed with CLI **629/629**, Desktop
  **217/217**, model **94/94**, documentation **60/60**, package smoke, and
  native Desktop contracts **2/2**.

## 2026-09-24 — Claude Agent SDK MCP execution-boundary hardening

- Added a second, project-owned approval enforcement layer inside every
  in-process MCP handler. A handler invocation without a matching permission
  result now performs a fresh `ApprovalPolicy` check; it is never implicitly
  trusted because it came from the SDK transport.
- Added a bounded one-use authorization binding. It fingerprints canonical JSON
  input, carries `prepare()`'s reviewed `updatedInput` into the project tool,
  preserves cached denials, expires entries after five minutes, and refuses
  inputs or pending-state capacity that cannot be safely bounded.
- Added real MCP transport tests with `Client` and `InMemoryTransport` for
  approval denial, approval allow, reviewed-input forwarding, direct handler
  execution without `canUseTool`, bounded handler errors, allowlist isolation,
  and cancellation context propagation.
- The focused Claude Agent SDK suite now passes **12/12**. Workspace build,
  typecheck, and serial workspace tests pass; the observed CLI suite is
  **629/629** and Desktop is **222/222** in this current worktree. The full
  release-gate command remains the final post-edit verification step.

## 2026-09-24 — final post-hardening release gate

- `HOME=/private/tmp/dev-agent-test-home
  DEV_AGENT_PACKAGE_SMOKE_NPM_CACHE=/Users/Admin/.npm pnpm verify:typescript
  --report` passed after the handler-boundary changes and documentation sync.
- The gate passed structure, workspace build, workspace typecheck, serial
  workspace tests, CLI package smoke, release/preflight/publish contracts,
  preview contracts, release-gate/CI contracts, documentation **60/60**, and
  native Desktop contracts **2/2**. The current workspace test totals include
  CLI **629/629**, Desktop **222/222**, and the optional Claude adapter
  **12/12**.
- `git diff --check` and the standalone documentation contract suite **60/60**
  pass. No commit, tag, publish, or push was performed.

## 2026-09-24 — host lifecycle cleanup

- Added an explicit bridge cleanup method and invoke it from
  `runClaudeAgentSdk()`'s `finally` block. Unused preflight decisions cannot
  survive the query lifecycle and be consumed by a later handler call.
- Added the regression for clearing a preflight decision before a subsequent
  handler call. The focused Claude Agent SDK suite now passes **13/13**.

## 2026-09-24 — final lifecycle-cleanup gate

- Completed the second final TypeScript gate after adding
  `bridge.clearPendingAuthorizations()` and invoking it from the SDK runner's
  `finally` block.
- `HOME=/private/tmp/dev-agent-test-home
  DEV_AGENT_PACKAGE_SMOKE_NPM_CACHE=/Users/Admin/.npm pnpm verify:typescript
  --report` completed with report status `passed`.
- The final gate passed structure, workspace build/typecheck, serial workspace
  tests, CLI package smoke, release/preflight/publish/preview/gate/CI
  contracts, documentation **60/60**, and native Desktop contracts **2/2**.
  Current focused evidence is Claude adapter **13/13**, CLI **629/629**, and
  Desktop **222/222**.
- Independent post-gate checks passed: `git diff --check` and
  `node --test tests/documentation-contract.test.mjs` (**60/60**).
- No commit, tag, publish, or push was performed.
