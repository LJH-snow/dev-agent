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
  session's consumption survives across runs
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
