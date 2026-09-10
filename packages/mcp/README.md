# @dev-agent/mcp

MCP client and server: dev-agent can consume other MCP servers and expose its
own tools to a host agent.

## Server mode

`createMcpServer({ tools })` speaks newline-delimited JSON-RPC 2.0 over stdio
and implements `initialize`, `ping`, `tools/list`, and `tools/call`. Tool
implementations are injected by the caller, so this package stays free of any
dependency on `@dev-agent/tools`; the CLI wires the built-in tools in with
`--mcp-server` (see `apps/cli/README.md`). Tool execution failures come back as
`{ isError: true }` results so the host model can react, while unknown tools and
methods are JSON-RPC errors.

## Client

Implemented in phase 1:

- `McpStdioClient` - JSON-RPC MCP client over stdio
- `initialize` handshake with capability negotiation: client declares the
  `roots` capability (`listChanged: true`) and captures the server's returned
  `capabilities` and `serverInfo`, exposed via `getServerCapabilities()` and
  `getServerInfo()`
- `notifications/initialized` lifecycle notification
- `tools/list` and `tools/call` support
- `McpTool` objects that can be registered into the agent tool registry
- `resources/list`, `resources/read`, and `McpResource` objects
- `prompts/list`, `prompts/get`, and `McpPrompt` objects
- `ping` for basic liveness checks
- `reconnect()` - closes and re-establishes a session using the stored
  configuration, so a dropped server can be reconnected without recreating the
  client
- `onNotification(handler)` - receives server→client notifications:
  `tools/list_changed`, `resources/list_changed`, `prompts/list_changed`,
  `notifications/message`, `notifications/progress`, and
  `notifications/cancelled`
- `roots/list` request handling - responds to server roots queries with the
  workspace directory, so servers that inspect client roots work correctly
- `McpServerSession` - higher-level lifecycle wrapper that owns connect /
  reconnect / close and emits a change callback whenever tools, resources, or
  prompts change (including after a `*_list_changed` notification), so the CLI
  can dynamically re-register tools

The `McpClient` interface exposes resources and prompts with structured
objects, so the agent loop can treat them as first-class capabilities instead
of only translating MCP tools into local tools.

The implementation deliberately uses only Node built-ins and no MCP SDK
dependency. The CLI injects `DEV_AGENT_SESSION_ID` and
`DEV_AGENT_WORKING_DIRECTORY` into MCP server environments when it connects.

The CLI registers a `<prefix>:resource` tool (read by URI) and a
`<prefix>:prompt` tool (get by name) for every connected server, and lists the
available resources and prompts in the agent system prompt so the model can
discover and use them. When a server emits a `tools/list_changed` notification,
the CLI unregisters that server's old `<prefix>:*` tools and re-registers the
updated set.
