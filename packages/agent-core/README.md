# @dev-agent/agent-core

Core agent runtime: agent loop, context, memory, and agent state.

Current package capabilities include:

- `AgentLoop` - model and tool orchestration loop with a max turn limit
- Optional `AgentLoopOptions.maxRepeatedToolFailures` stops a one-run loop when
  the same failing tool call repeats without progress
- Optional `AgentLoopOptions.finalizeOnMaxTurns` gives the model one final
  no-tools turn to format verified evidence when a run reaches its turn limit
- `AgentLoop`'s optional `contextBudget` - character budget for the history sent
  to the model. It keeps the newest entries that fit, never splits an assistant
  tool call from its tool results, always keeps the system prompt, and announces
  how many older entries were omitted. With `summarize: true` the dropped
  entries are replaced by a model-written `[summary]` digest instead, growing it
  incrementally as more history is trimmed; if summarization fails the plain
  omission notice is used and the run continues. The digest is stored with the
  session (`FileMemory` persists it, `InMemoryMemory` keeps it in process), so a
  later run reuses it instead of summarizing the same history again, and
  `summaryMaxChars` (default 2000) caps its length by keeping the newest part.
- Usage accounting: every model response that reports tokens fires `onUsage`,
  and the loop adds the totals up on the returned context's `usage` field, so a
  session's consumption survives across runs. `AgentMemory.recordUsage()` is
  awaited for every report: `InMemoryMemory` keeps the total in process and
  `FileMemory` writes it to `metadata.usage`, so `getMetadata()` can restore it
  after a restart.
- Approval policies: `AgentLoopOptions.approval` decides whether a tool call may
  run. `denyDangerousPolicy()` blocks commands matching its pattern table
  (recursive delete, `sudo`, force push, pipe-to-shell, disk tools, …) and
  filesystem writes outside the working directory; a policy that throws is
  treated as a denial. Denials are written back as the tool's result so the
  model can choose another path. Unset means every call runs, exactly as before.
- Tool-risk metadata is normalized at the registry boundary. Unclassified tools
  default to dangerous/always-confirm, and approval requests carry only the
  trusted `risk` and `confirmation` fields. Plan mode allows generic tools only
  when the host explicitly classifies them as read-only.
- `normalizeApprovalKey(request)` returns the key an "always allow" decision
  should be remembered under: the command name plus up to two leading non-flag
  tokens (`npm test`, `git status`, `npm run test`, `chmod 777 /tmp/x`),
  unwrapping `sh -c "…"` first. Extra flags share one key, while `npm run test`
  and `npm run build` stay separate. Tools that run no command return
  `undefined`.
- `AgentContext` - holds session id, working directory, runtime metadata, timestamps,
  `AgentState`, and `AgentMemory`
- `AgentState` - id, status, turn counter, current task, and last error
- `AgentMemory` / `InMemoryMemory` / `FileMemory` - append and read conversation history;
  `FileMemory` persists entries as JSON and recreates the directory as needed
- `AgentToolRegistry` - lookup, schema exposure, and execution of tools by name

## Collaborative planning

`runCollaborativePlan(prompt, options)` runs a bounded set of specialist
planning roles in parallel and then asks the selected model to synthesize their
findings. The built-in roles are `architect`, `reviewer`, and `tester`.
Specialists use isolated memory and `mode: "plan"`, so mutating tools are
denied during the review. Role failures are returned as metadata while
successful roles continue to the synthesis step. Callers can bound concurrency
with `maxParallel`, pass an abort signal, and observe `started`, `completed`,
and `failed` role events without exposing raw tool output.

The "outside the working directory" check resolves symlinks before deciding: a
path that looks like it is inside the workspace but links to a file outside it is
denied, while a symlink that stays inside is allowed. Because the target of a
`write` or `mkdir` often does not exist yet, the deepest existing ancestor is
resolved and the missing tail appended. If the workspace itself does not exist,
the check falls back to the string comparison (nothing inside it can be a
symlink yet).

## Collaborative execution

`runCollaborativeExecution(prompt, options)` is the execution counterpart to
`runCollaborativePlan`. It validates a bounded task DAG, runs ready tasks in
parallel through an injected `CollaborationWorkspaceProvider`, and returns
bounded task results plus a review. Each task receives its own session,
workspace, retry budget, cancellation signal, and default deny-dangerous
approval policy.

Agent Core never merges a collaboration result. The application edge owns the
workspace provider and must explicitly call its `merge` method after reviewing
`result.review`. Task events expose lifecycle metadata only; they do not carry
full model transcripts or workspace paths.

A trusted application edge may also provide `toolAllowlistForTask(task)`. Agent
Core resolves and validates each returned list before creating any task
workspace, intersects it with the caller-supplied `tools` collection, and gives
the worker the same narrowed collection for both model schemas and runtime
lookups. Lists are limited to 256 unique, exact registered tool names; invalid
or unavailable names fail closed. The allowlist is an execution option, not a
`CollaborationTask` field, so planner output cannot directly set a grant. The
callback still receives task data that may originate from the planner: callers
must not derive permissions from its id, role, title, or instructions unless
those fields have been independently bound to explicit user authorization.
Omitting the callback preserves the existing full-tool behavior.

For an interactive post-plan review, callers may instead pass
`reviewedToolScopes` with a SHA-256 fingerprint from
`fingerprintCollaborationTaskGraph(tasks)` and one scope per ordered task slot.
Agent Core normalizes the supplied plan again and validates the exact fingerprint,
complete slot coverage, every registered tool name, and the optional
`toolScopeCeiling` synchronously before creating workspaces. Reviewed scopes
cannot be combined with `toolAllowlistForTask`; neither mechanism can widen the
caller-supplied tools or global ceiling. The fingerprint binds plan contents and
ordering but is not authorization by itself—the caller must obtain grants from
an explicit trusted policy or user confirmation.

The loop appends user input, asks the model with available tool schemas, executes
any requested tools, and repeats until the model returns a final answer or
`maxTurns` is reached. It passes the runtime context to tools and includes the
session id and working directory in the system prompt.

An application edge may provide `AgentLoopOptions.toolSandboxProfile` to attach
a provider-neutral `ToolSandboxProfile` to each tool invocation. Agent Core
only carries the bounded profile through `ToolExecutionContext`; it does not
choose an executor, invent a default profile, or widen the requested paths.

Tool calls are bounded by `toolDefaults.timeoutMs` (default 30s). A timeout does
more than report: `runTool()` aborts the signal it handed the tool, so
`LocalExecutor` kills the child and `RustExecutor` sends a cancel envelope —
otherwise a "timed out" command kept running and its side effects still landed
after the model had been told it failed.
