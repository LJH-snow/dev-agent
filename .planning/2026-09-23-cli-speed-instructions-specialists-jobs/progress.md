# Progress

## 2026-09-23

- Started a separate plan for this user goal without modifying the unrelated root plan or active-plan pointer.
- Reconfirmed current architecture: trace hooks, runtime event stream, model adapter capability gaps, current `updateInkSummary` omission, existing collaboration roles/tool ceiling, and in-memory task scheduler.
- Next: implement Phase 1 timing instrumentation and speed-mode flow, beginning with exact source and API payload contracts.
- Confirmed runtime events carry answer-vs-reasoning channels and run IDs, allowing metadata-only TTFT/total timing without retaining prompt or answer text. The interactive task scheduler is serial, so queue wait can be measured at task dispatch.
- Reviewed provider-specific current docs (OpenAI reasoning, Anthropic extended thinking, Gemini thinking, Ollama chat). Continue with per-provider request-body tests and conservative model capability matching.
- Feasibility spike confirmed a real worker process can be launched through the bundled CLI entry without placing prompt data in argv. It also found concrete gaps: one-shot runs do not consume startup signals, SIGTERM is not forwarded, checkpoint anchors do not restore loop/worktree state, and collaboration worktrees are disposed from in-memory provider records. See the feasibility decision in `findings.md`; do not build a registry-only feature or replay the original prompt on resume.
- Next implementation slice: configured collaboration roles with model/prompt/tool ceiling/budget; then a small detached-process lifecycle proof with metadata-only persistence and validated isolated workspace before expanding resume semantics.
- Implemented named `collaboration.roles` configuration, strict validation, active-tool resolution, per-role provider/model, prompt, and AgentLoop budget wiring. Added unit and CLI integration coverage, including role allowlist intersection. Initial focused tests passed; expanded integration test is currently being rebuilt/run.
- Full agent-core suite initially exposed a stale trace snapshot expectation for the newly emitted `totalMs`; updated the test to the metadata contract. Full agent-core suite then passed (197/197). CLI test compilation's three pre-existing union-narrowing errors in `collaboration-authorization.test.ts` were fixed with one narrowing helper so full test compilation can proceed.

- Corrected trace diagnosis semantics: aggregate provider phases across model calls and report model-span share separately from the selected provider substage's duration/share; docs and fixtures cover a model span dominating the run while prompt evaluation occupies only 45%. Focused trace-summary tests and the interactive trace E2E pass.

- 2026-09-23 continuation: fixed misleading `slow-stage=model/prompt-eval (98% of total)` presentation by reporting the aggregate model span share separately from provider-substage duration/share. Verified 5 timing-summary tests, 16 targeted role/job/speed tests, 6 instruction/prompt-policy tests, and 4 interactive trace/mode/instruction/team-review tests. Historical local evidence confirms an earlier run had 4,085 prompt tokens, first token at 120,394ms, model span 132,321ms, and no tools; this isolates the wait to the model span but not the provider substage. A synthetic large-AGENTS CLI attempt timed out without collecting a usable trace, so it is not treated as root-cause proof.
- Full CLI package test (`pnpm --filter @agent_cli/cli run test`) is currently running in the active command session; it has passed through CLI authorization, background jobs, config, collaboration, project context, trace, speed mode, and interactive test cases so far.

- Trace rendering now has an explicit formatter with a regression test proving `slow-stage=model (98% of total); provider-substage=prompt-eval 450ms (45% of total)`. CLI build, six timing-summary tests, and the interactive trace E2E pass.
- Full CLI package suite rerun passed 625/625 in 536,988.9ms after one transient `--no-stream` test failure on an earlier run; that individual test passed in three repeated isolated reruns and in the full rerun.
- Next: run a metadata-only local Ollama probe near 4k prompt tokens with minimal generation to collect load/prompt-eval/generation durations; then final workspace typecheck and feature-by-feature audit.
- The full CLI rerun completed successfully: 625/625 tests passed. Workspace `pnpm typecheck` and `pnpm build` both passed. Model provider suite passed 92/92; Agent Core suite passed 210/210.
- Current CLI latency evidence: with warm local Qwen3 and project instructions active, `hi` took 4,739ms end-to-end (3,946ms first token); prompt-eval 3,368ms was the largest provider phase. A cache-miss synthetic 4,004-token greeting prompt took 24,071ms server-side, 23,295ms in prompt evaluation and 743ms generation; a distinct balanced-mode prompt was similarly prefill-bound. Exact measurements and limitations are recorded in `findings.md`.


## 2026-09-25 continuation

- Rebuilt Agent Core after wiring configured specialist roles into ordinary `:team` workers. The role binding test now proves the worker uses the configured model and system instructions, receives the role/task tool intersection, runs the role tool, and stops at the role budget without invoking the base model.
- Verified the specialist CLI integration for ordinary `:team` execution, configured role prompts/model selection, and role binding/tool intersection: 9 focused tests passed.
- Verification gates passed: workspace `pnpm typecheck`, workspace `pnpm build`, Agent Core suite 212/212, model provider suite 95/95, and the complete CLI suite 634/634.
- Updated the phase audit to reflect that specialist bindings apply to both `:team plan` and matching reviewed `:team` workers; no prompt, output, path, or secret data is added to latency or job metadata.
