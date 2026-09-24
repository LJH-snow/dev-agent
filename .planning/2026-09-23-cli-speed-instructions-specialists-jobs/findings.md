# Findings

- The root `task_plan.md` and `.planning/.active_plan` belong to a separate in-flight ReactBits/Gemini task; do not overwrite them.
- The CLI already has bounded metadata-only `AgentRunTrace` model/tool spans, a session-local task scheduler, resumable conversations, and collaboration worktrees. The requested additions should extend rather than duplicate these capabilities.
- `InkRunSummary.firstTokenMs` and `totalMs` exist but are not populated by `updateInkSummary`; `:trace` currently shows run duration and span counts only.
- The CLI currently enables Ollama `think` only through provider options; OpenAI, Anthropic, and Gemini adapters currently omit reasoning configuration. Provider-specific mode support must be capability-gated and covered with request-body tests.
- `:tasks` is in-memory/session-local. Persisting status alone is not durable resume; execution/worktree state must be validated and resume must be explicit.
- `AGENTS.md` guidance appears in the base prompt text but there is no discovery/loading implementation in the CLI path. `context-attachments.ts` marks attached workspace excerpts as reference data and must remain distinct from project instructions.

- Runtime events already expose `run.started`, answer-channel `assistant.delta`, and terminal run events. The event stream includes raw prompt/token fields, so the trace observer must read only the event type/run ID/channel and never retain content.
- `AgentTaskScheduler` executes interactive prompts with concurrency 1; queue latency can be measured from submit to scheduler callback start. Runtime event timestamps give a clean boundary for answer-token and total run timing.
- Provider request contracts are provider-specific. OpenAI reasoning effort, Anthropic adaptive thinking/output effort, Gemini thinking config, and Ollama `think` require separate capability gates; only mode-supported model identifiers should receive non-default request fields.
- `:bench hi` can directly benchmark one provider round trip without tools or persisting a conversation turn; it must be explicit and report metadata only (not answer content).

## 2026-09-23 feasibility spike: durable CLI jobs

- A detached process is technically viable: npm's production entry is a single bundled `dist/cli.js`, and `cli-entry.ts` already provides a process boundary that can be respawned with `node` and a private job ID (never the prompt in argv).
- The existing interactive `AgentTaskScheduler` is unsuitable for durability: `interactive()`/Ink shutdown explicitly cancels its active task, and it retains only in-memory lifecycle snapshots.
- `FileMemoryCheckpointStore` is not an execution checkpoint. It only stores a conversation anchor; it cannot restore AgentLoop turn state, a collaboration DAG, pending tool execution, or workspace provider records.
- `AgentLoop.run()` always appends a new user message. Re-running the original prompt would be silent replay and can duplicate side effects. A possible explicit-resume contract is a new continuation turn in the same persistent, validated isolated worktree/session, after validating the prior transcript and workspace; this is not exact mid-turn restoration. If the transcript ends in an unmatched assistant tool call, resume must be blocked or explicitly repaired rather than blindly replayed.
- `runPrompt()` supports an AbortSignal, but the `--once` path currently does not pass one. `cli-entry.ts` forwards only SIGINT, not SIGTERM. A worker needs both signals connected to one abort path and terminal job status persistence.
- `GitCollaborationWorkspaceProvider` can create an isolated worktree including bounded untracked overlays, but its workspace records are process-local and `disposeAll()` removes them. A durable worker would need a dedicated persistent job worktree and strict revalidation (canonical path under a trusted job root, registered git worktree, expected repository root/base revision, and private job ID binding) before explicit resume. Its independent provider instance would avoid the interactive provider's cleanup, but the job lifecycle would need explicit retention/cleanup.
- Prompt text must not be stored in the public job registry or passed in child argv. It can live in a mode-0600 request/session file under a mode-0700 user state directory, bounded and deleted/retained by policy; disclose that it is locally persisted. Job listings should remain metadata-only.
- Feasibility decision: proceed with a minimal detached worker spike using a private job ID and fake runner first; do not claim durable resume until process survival, cross-process status/cancel, path/worktree validation, and explicit continuation are covered by tests. Avoid extending the in-memory scheduler into a pretend durable queue.
- Local process experiment on 2026-09-23 confirmed `spawn(process.execPath, ..., { detached: true, stdio: "ignore" }); child.unref()` survives exit of the parent process and can write a marker afterward. This proves only the Node process-lifecycle primitive, not a complete CLI job worker.
- Specialist role execution is now wired through `:team plan`: config-defined provider/model/prompt/tool list/budget are resolved by a caller-owned binding; role tool lists are intersected with the global collaboration ceiling and active registry. Default roles also receive the global ceiling. Planner-generated task role labels remain unused as grants.


## 2026-09-23 latency evidence update

- Cold isolated `qwen3:4b-instruct` greeting: 7,031ms total; TTFT 6,227ms; model 6,865ms; provider load 2,845ms, prompt evaluation 3,135ms, generation 814ms.
- Warm `balanced` greeting: 1,565ms total; TTFT 489ms; model 1,391ms; load 20ms, prompt evaluation 237ms, generation 1,080ms. Warm `fast`: 1,469ms total; TTFT 461ms; model 1,309ms; load 9ms, prompt evaluation 231ms, generation 1,013ms.
- A different earlier project run took 132,321ms in the model span (120,394ms to first token), processed 4,085 prompt tokens, and called no tools. This proves the dominant measured interval was model inference, not queueing or tool execution. Because provider-stage telemetry was not available on that run, assigning the delay specifically to model loading, prompt prefill, or generation would overstate the evidence. The new trace can distinguish those stages on a repeat run.
- A synthetic large-instructions CLI run did not complete with a usable trace and is explicitly not used to claim attribution.

## Controlled provider and CLI latency probe (2026-09-23)

All probes used the local `qwen3:4b-instruct` model and emitted only numeric timing/count metadata; the synthetic context and assistant text were not saved.

- A synthetic fresh 4,004-token prompt with fast-mode-equivalent `think: false` measured 24,096ms wall time: load 8ms, prompt evaluation 23,295ms, generation 743ms, server total 24,071ms. Thus on this cache-miss path, prompt evaluation was the dominant stage (about 97% of server time); reasoning-mode controls do not reduce prefill time.
- A distinct 4,004-token prompt using balanced/provider-default thinking measured 24,373ms wall time: load 8ms, prompt evaluation 23,360ms, generation 790ms, server total 24,346ms. Fast vs balanced had essentially the same prefill latency on this simple greeting.
- Repeating the exact balanced prompt immediately afterwards measured 62ms prompt evaluation and 826ms total; this is consistent with provider prefix/KV caching and is not comparable to a fresh-prefix run.
- A real CLI `hi` run in the current project with the model already warm measured 4,739ms total, 3,946ms first token, 4,592ms model span, queue 0ms, and no tool span. Its `:trace` output showed load 9ms, prompt evaluation 3,368ms, generation 791ms, server total 4,573ms, app overhead 19ms, and the corrected diagnosis `slow-stage=model (97% of total); provider-substage=prompt-eval 3368ms (71% of total)`.
- Together with the historical 4,085-token / 120,394ms-to-first-answer-token run, the evidence identifies the model span as the source and prompt evaluation as the dominant stage on a comparable fresh-context probe. The exact provider substage of the historical run itself cannot be recovered because stage timings were not recorded then; do not claim the 23.3s probe reproduces its full 120s duration.
