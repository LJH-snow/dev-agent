# CLI speed, instructions, specialists, and durable jobs

## Goal

Implement the user's four requested CLI capabilities while preserving existing worktree changes and safety contracts.

## Phases

1. **Latency observability and speed modes** — record queue/first-answer-token/total/model/tool durations as bounded metadata; improve `:trace` with slow-stage diagnosis; add model-capability-aware `:mode fast|balanced|deep`; expose the current mode; add `:bench hi` or a repeatable regression evaluator.
2. **Layered project instructions** — discover user, project-root, and relevant descendant `AGENTS.md` files safely; apply only instruction files (not README/attachments); expose loaded/stale status through `:instructions`.
3. **Named specialist agents** — configurable roles with bounded prompts, model selection, tool ceiling, and task budgets; intersect grants with the existing user-owned collaboration ceiling.
4. **Durable cross-session jobs** — persist bounded, safe job metadata and isolated workspace state; support `:jobs`, inspect, cancel, and explicit resume; do not silently replay untrusted/stale work.
5. **Verification and documentation** — focused tests, typecheck/build, relevant package suites, documentation, and full requirement-by-requirement audit.

## Safety constraints

- Preserve all pre-existing modified/untracked files; never reset or clean the worktree.
- Timing/trace output is metadata-only; no prompt, answer, file contents, command output, secrets, or absolute paths.
- Model mode settings are sent only when the selected provider/model supports them; unknown capabilities fail open to provider defaults, not invented API parameters.
- Instruction loading uses explicit `AGENTS.md` files with bounded reads and trusted path containment. Attachments and ordinary repository text remain reference data.
- Specialist permissions are always intersected with caller-owned tool policy and the existing collaboration allowlist; planner-generated roles cannot grant tools.
- Durable resume requires explicit user action and must validate persisted job/worktree state before any execution.

## Status

- [~] Phase 1 implementation is present and focused-tested; the historical ~120s run is confirmed to be a model span (4,085 prompt tokens, 120,394ms first token, 132,321ms model time), but its provider substage is not attributable because that run predates provider timing. A controlled 4k-token provider probe remains pending.
- [x] Phase 1 latency tracing, speed modes, benchmark, and metadata-only stage diagnosis are implemented and tested. Historical telemetry proves the slow span was the model; a fresh 4,004-token probe plus a live CLI trace show prompt evaluation dominates comparable slow paths. The historical request's exact substage cannot be recovered because it predates provider timing.
- [x] Phase 2 layered instructions, scope/staleness reporting, reference-vs-instruction boundary, symlink safety, docs, and tests.
- [x] Phase 3 named specialist configuration for `:team plan`, with model/prompt/tool/budget bindings intersected with the caller-owned tool ceiling, docs, and tests.
- [x] Phase 4 detached cross-session jobs, metadata-only list/inspect/cancel, isolated worktrees, explicit safe continuation, docs, and cross-CLI E2E tests.
- [x] Phase 5 requirement audit; full CLI suite 625/625, model provider suite 92/92, Agent Core suite 210/210, workspace typecheck/build pass.
