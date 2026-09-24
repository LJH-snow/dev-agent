# Findings — Anthropic SDK adoption

## Current repository evidence
- Root workspace is TypeScript/Node ESM, Node engine >=20, pnpm workspace.
- `packages/model/src/types.ts` defines a common `ModelProvider` with chat and optional streaming methods.
- `packages/model/src/anthropic.ts` implements Anthropic Messages over raw `fetch`, including its own retry, bounded-response, streaming, usage, thinking, and tool-call mappings.
- CLI and desktop already select Anthropic via `ANTHROPIC_API_KEY` and use `createAnthropicProvider`.
- `packages/agent-core/src/loop.ts` owns the current agent loop, event flow, tool execution, approval callbacks, and sandbox integration; CLI and desktop each construct this loop.
- CLI package bundles with esbuild into a single ESM entry and has a package smoke test. Any SDK runtime/binary packaging must be verified, not assumed.
- The current relevant source files are clean; there are unrelated modified/untracked project files elsewhere. Preserve them.
- No Context7 MCP resources/tools are exposed in this session. Official Anthropic documentation was fetched directly for current API reference.

## External docs consulted
- Anthropic TypeScript Client SDK and Claude Agent SDK are different layers: direct Messages API client vs. higher-level agent loop/tool runtime.
- The official Agent SDK uses optional platform-specific binary packages; packaging must preserve optional runtime assets.

## 2026-09-24 — MCP handler approval boundary finding

- The installed Claude Agent SDK declaration documents `canUseTool` as a
  pre-execution callback, but the in-process MCP server handler is a separate
  execution seam and does not receive the SDK `toolUseID`. A safe adapter must
  therefore not make `canUseTool` the sole enforcement point.
- The adapter now enforces approval in the handler itself. When the SDK has
  already called `canUseTool`, a bounded one-use input binding reuses that
  decision and its reviewed input; otherwise the handler calls the policy. A
  cached denial remains a denial if a future SDK path invokes the handler after
  the callback rejected the call.
- The binding is fail-closed: canonical JSON fingerprints are capped at 1 MiB,
  pending decisions are capped at 256 and expire after five minutes, and an
  unbindable input or capacity exhaustion returns a denial rather than running
  the project tool. The actual MCP server/client transport tests cover these
  paths without requiring a provider or Claude CLI subprocess.

## 2026-09-24 — final verification

- The post-hardening TypeScript release gate is green. The optional package is
  included in the workspace build/typecheck/test traversal while remaining out
  of the default CLI bundle; the package focused suite is **12/12**.
- Current workspace evidence is CLI **629/629**, Desktop **222/222**,
  documentation **60/60**, native Desktop **2/2**, and a passing CLI tarball
  install smoke using the isolated HOME plus the explicit local npm cache.

## 2026-09-24 — lifecycle cleanup finding

- A preflight decision that never reached an MCP handler must not remain
  usable merely because the host retained the context object. The bridge now
  exposes a cleanup operation, and `runClaudeAgentSdk()` clears pending
  authorizations in `finally`; the focused suite covers the explicit cleanup
  behavior.

## 2026-09-24 — final lifecycle-cleanup verification

- The final release-gate report is green after the host lifecycle cleanup:
  structure, build, typecheck, workspace tests, package smoke, release and CI
  contracts, documentation **60/60**, and native Desktop **2/2** all passed.
- Focused current-worktree evidence is CLI **629/629**, Desktop **222/222**,
  and Claude Agent SDK **13/13**. The adapter remains opt-in, with native
  Claude tools disabled and the default CLI bundle unchanged.
- `git diff --check` and the standalone documentation contract suite pass.
  No publication or repository history mutation was performed.
