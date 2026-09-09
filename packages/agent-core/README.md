# @dev-agent/agent-core

Core agent runtime: agent loop, context, memory, and agent state.

Implemented in phase 1:

- `AgentLoop` - model and tool orchestration loop with a max turn limit
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
