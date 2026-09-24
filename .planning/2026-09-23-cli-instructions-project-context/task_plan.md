# Layered instructions and project-aware prompt context

## Scope
Implement only these two CLI capabilities:
1. Hierarchical `AGENTS.md` instruction discovery (user, project root, nested directories), precedence/scope, refresh/stale visibility via `:instructions`, and strict separation from ordinary reference attachments.
2. Automatic active-project detection and a concise project-aware prompt module, with `:project` inspection/refresh.

Do not expand this task into speed modes, benchmark, specialist agents, or durable jobs.

## Phases
- [x] Inspect existing prompt, CLI command, attachment, and test seams.
- [x] Implement bounded/safe layered instruction registry and project context detector.
- [x] Wire refreshed project context and instruction modules into standard CLI, ACP, A2A, and collaborative workflows; expose commands in both interactive renderers.
- [x] Add focused unit/integration tests and user documentation.
- [x] Run focused tests/typecheck/build and audit scope/security invariants.

## Verification note
Focused module typecheck and seven focused unit/integration tests pass. Full CLI typecheck/build still reports the existing `traceTimings` reference at `apps/cli/src/index.ts:4650`; that unrelated speed/trace residue is intentionally outside this task's scope.
