# @dev-agent/claude-agent-sdk

Optional Claude Agent SDK integration for `dev-agent`.

This package intentionally does **not** replace the existing `AgentLoop` or
become the default CLI backend. It provides an opt-in `runClaudeAgentSdk()`
backend for hosts that want Claude Agent SDK's higher-level agent loop while
keeping `dev-agent` as the source of truth for tools, approvals, and sandbox
context.

## Safety boundary

- Claude Agent SDK native tools are disabled with `tools: []`.
- Only tools selected from a supplied `AgentToolRegistry`/`ToolCollection` are
  exposed through the in-process `mcp__dev_agent__*` namespace.
- `settingSources: []` and `strictMcpConfig: true` prevent user/project MCP
  configuration and settings from silently adding capabilities.
- The existing `ApprovalPolicy` is called before every tool execution. The MCP
  handler enforces the same decision even if an SDK path bypasses the host
  permission callback. If no policy is supplied, tool calls are denied.
- Permission results are bound to one bounded, one-use input fingerprint. This
  preserves `prepare()`'s reviewed `updatedInput` and prevents an unbound MCP
  handler call from being treated as approved.
- The existing `ToolExecutionContext` carries the session id, working
  directory, abort signal, and sandbox profile into the project tool.
- The package is separate from the CLI's single-file bundle so the optional
  Claude Code native runtime is not added to the default distribution.

## Example

```ts
import { runClaudeAgentSdk } from "@dev-agent/claude-agent-sdk";

const result = await runClaudeAgentSdk("Inspect the repository and summarize it", {
  tools,
  sessionId,
  workingDirectory,
  approval,
  sandbox,
});
console.log(result.text);
```

Use the existing `@dev-agent/model` Anthropic provider when the project needs a
`ModelProvider` for its current `AgentLoop`; use this package only when the
host explicitly opts into the Claude Agent SDK runtime.
