# @dev-agent/agent-core

Core agent runtime: agent loop, context, memory, and agent state.

Implemented in phase 1:

- `AgentLoop` - model and tool orchestration loop with a max turn limit
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

The loop appends user input, asks the model with available tool schemas, executes
any requested tools, and repeats until the model returns a final answer or
`maxTurns` is reached. It passes the runtime context to tools and includes the
session id and working directory in the system prompt.
