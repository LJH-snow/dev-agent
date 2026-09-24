# Anthropic SDK adoption plan

## Objective
Integrate mainstream Anthropic TypeScript SDKs into the existing dev-agent project without replacing or weakening its current provider contracts, tool policies, sandbox, CLI/desktop events, or packaging behavior.

## Scope derived from the conversation
1. Adopt `@anthropic-ai/sdk` in the existing Anthropic `ModelProvider` adapter, preserving current streaming, retries, cancellation, usage, tool-call mapping, configurable endpoint, and test seams.
2. Add `@anthropic-ai/claude-agent-sdk` as an opt-in runtime only if its tools can be routed through the project's trusted tool registry and sandbox/approval policy. Do not expose native host tools that bypass project boundaries.
3. Validate CLI/desktop integration, npm bundle/runtime packaging, and existing workspace gates. Keep the current runtime as default and preserve unrelated working-tree changes.

## Phases
- [x] Phase A: inspect current model provider, tool registry/executor contracts, CLI/desktop loop seams, current dirty files, and official SDK API requirements.
- [x] Phase B: replace manual Anthropic HTTP/SSE transport with the official Client SDK behind the existing `ModelProvider` interface and update provider tests.
- [x] Phase C: implement a guarded, optional Claude Agent SDK backend using only project-owned tools and permission boundaries; keep it out of the default CLI bundle until a native-runtime packaging path is explicitly selected.
- [x] Phase D: add docs/configuration and focused integration/package tests; run typecheck, relevant tests, package smoke, and diff checks.

## Constraints
- Do not modify or discard pre-existing dirty/untracked user work.
- No default runtime switch without verified parity.
- No host file/shell/network capability may bypass the existing executor, approval, and sandbox policies.
- If the Agent SDK cannot be safely wrapped in this architecture, record the concrete blocker and still deliver the Client SDK integration; keep the overall goal active until a safe full design is proven.


## Delivery status

- Phase A: complete.
- Phase B: complete with `@anthropic-ai/sdk@0.126.0` behind the existing
  `ModelProvider` contract.
- Phase C: complete as an opt-in `@dev-agent/claude-agent-sdk` package. Native
  Claude Agent SDK tools remain disabled; the adapter exposes only allowlisted
  project tools through an in-process MCP server and routes approval,
  cancellation, sandbox context, and tool execution through existing contracts.
- Phase D: complete. Documentation, focused model and adapter regressions,
  package smoke, the TypeScript release gate, and diff checks are green.

## 2026-09-24 final lifecycle-cleanup gate

- [x] Re-run the full TypeScript release gate after adding host lifecycle cleanup.
- [x] Verify the focused Claude Agent SDK suite includes the cleanup regression.
- [x] Verify documentation contracts, native Desktop contracts, package smoke,
      and whitespace checks after the final documentation synchronization.

Final evidence: `HOME=/private/tmp/dev-agent-test-home
DEV_AGENT_PACKAGE_SMOKE_NPM_CACHE=/Users/Admin/.npm pnpm verify:typescript
--report` passed with report status `passed`. The gate covered workspace
structure/build/typecheck/tests, CLI **629/629**, Desktop **222/222**, Claude
adapter **13/13**, package smoke, release/preflight/publish/preview/gate/CI
contracts, documentation **60/60**, and native Desktop **2/2**. `git diff
--check` also passed. No commit, tag, publish, or push was performed.

Phase status: **complete**.
