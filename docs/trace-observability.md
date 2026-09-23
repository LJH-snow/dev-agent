# Agent Run Trace

The CLI and Desktop adapters expose a small, local-only run trace for
diagnosing model and tool timing. It follows the lifecycle-hook style described
in the Gemini CLI architecture study, while keeping the existing Agent Core
boundaries and output contracts intact.

## Lifecycle hooks

`AgentLoop` emits the existing Hook events for each session and run:

- `session.start` and `session.end`
- `before.model` and `after.model`
- `before.tool` and `after.tool`

Each event now carries an ISO timestamp. Model calls receive a unique
`model-*` operation id, tool calls reuse their tool-call id, and completed model
events carry normalized token usage when the provider reports it. These values
let the trace correlate spans without retaining conversation content.

## Metadata-only contract

`AgentRunTrace.snapshot()` returns:

- run id, status, start/end timestamps, runtime duration, submit-to-completion
  duration, queue wait, submit-to-first-answer-token latency, selected speed mode,
  turn count, and aggregated token counts;
- model and tool spans with operation id, sanitized tool name, status,
  timestamps, duration, and turn number; providers that report phase timings
  may add numeric model-load, prompt-evaluation, generation, and server-total
  durations;
- retention counters when older runs or spans were dropped.

The collector never stores prompt text, assistant output, tool arguments,
tool results, file contents, working-directory paths, environment values, or
credentials. The snapshot is marked `metadataOnly: true`.

Retention is bounded in memory to the latest 20 completed runs and at most 100
spans per run. `droppedRuns` and `droppedSpans` make eviction visible instead of
silently implying complete history. The normal usage source is the AgentLoop
`after.model` Hook event; `recordUsage()` is retained for future adapters that
receive usage outside the loop.

## CLI

In an interactive session, enter either `:trace` or `/trace` after a run to
show a compact summary:

```text
[trace] run=run-... status=completed duration=120ms turns=1
spans=model:1 tool:2 tokens=prompt:4 completion:2 total:6
[trace] timing queue=3ms first-token=44ms model=72ms tool=19ms other=4ms total=98ms
[trace] slow-stage=model (73% of total); longest model turn=1=72ms
```

Ollama runs may include an additional provider line for model load, prompt
evaluation, token generation, total server time, and the difference between
server and application measurements. When model calls dominate, `slow-stage`
reports the model span's share of the whole run, while `provider-substage`
reports the largest aggregate provider phase and its own share. Those are
separate measurements: for example, `slow-stage=model (98% of total);
provider-substage=prompt-eval 45ms (45% of total)` does not imply that
prompt-evaluation consumed 98% of the run.

The command is available in interactive renderers. It identifies the largest
measured contributor (queue, model, tools, or unaccounted runtime time) and the
longest individual model/tool span, without showing prompt or result content.
The same timing summary is visible after human-readable turns. It is intentionally
not part of JSON or MCP protocol output.

## Desktop

The Desktop server exposes the additive read-only endpoint:

```text
GET /api/sessions/<sessionId>/trace
```

Successful responses are bounded metadata snapshots and include
`Cache-Control: no-store`. Unknown sessions return a stable `unknown session`
error. Injected legacy session implementations that do not provide trace data
return `trace unavailable`. Trace data is not added to session history, audit
evidence, or the existing SSE transcript.

## Privacy and release boundary

The trace is process-local and session-local. It is not persisted to
`FileMemory`, exported as audit evidence, sent to a remote telemetry service,
or connected to OpenTelemetry in this slice. No npm publish, release tag, or
network package release is required to use it from the workspace.
