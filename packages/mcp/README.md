# @dev-agent/mcp

MCP client and server: dev-agent can consume other MCP servers and expose its
own tools to a host agent.

## Server mode

`createMcpServer({ tools, resources, prompts })` speaks newline-delimited
JSON-RPC 2.0 over stdio and implements `initialize`, `ping`, `tools/list`,
`tools/call`, `resources/list`, `resources/read`, `prompts/list`, and
`prompts/get`. Tools, resources, and prompts are injected by the caller, so this
package stays free of any dependency on `@dev-agent/tools`; the CLI wires the
built-in tool set plus `dev-agent://session`, `dev-agent://workspace`, and two
prompt templates in with `--mcp-server` (see `apps/cli/README.md`). Tool
execution failures come back as `{ isError: true }` results so the host model
can react, while unknown tools, resources, prompts, and methods are JSON-RPC
errors. When a tool result is marked `isError`, `McpStdioClient.callTool()`
preserves the server's text content in the thrown `McpRequestError` (multiple
text blocks are joined in order and oversized details are truncated); an empty
error result keeps the generic `reported an error` message.

## Client

Implemented:

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

`resources/read` may answer with several content blocks (a directory read, or
text plus a blob), so the client exposes both shapes:
`readResourceContents(uri)` returns every block in order, while `readResource(uri)`
stays as the single-block convenience wrapper and returns the first one. Callers
that would otherwise lose data should use the plural method.

The implementation deliberately uses only Node built-ins and no MCP SDK
dependency. The CLI injects `DEV_AGENT_SESSION_ID` and
`DEV_AGENT_WORKING_DIRECTORY` into MCP server environments when it connects.

Every request has a timeout (`McpClientConfig.timeoutMs`, default 30s). A server
that never answers fails the call with
`MCP request "<method>" timed out after <n>ms` and drops the pending entry,
instead of hanging the caller forever; `connect()` tears the half-open child
down before surfacing that failure, so a silent server cannot keep the process
alive.

### Cancellation and progress

`McpStdioClient.callTool()` accepts an optional `AbortSignal` and progress
callback. The same options are forwarded by the `McpTool.execute()` adapter, so
an agent or UI can cancel an MCP call without reaching into the JSON-RPC layer:

```ts
import { McpRequestError } from "@dev-agent/mcp";

const controller = new AbortController();
const resultPromise = client.callTool("download", { url }, {
  signal: controller.signal,
  onProgress: ({ progress, total }) => {
    console.log(total === undefined ? progress : `${progress}/${total}`);
  },
});

// Call this from Ctrl-C, a Stop button, or an HTTP disconnect handler.
controller.abort();

try {
  await resultPromise;
} catch (error) {
  if (error instanceof McpRequestError && error.code === -32001) {
    console.log("MCP call cancelled");
  }
  throw error;
}
```

For an in-flight call, aborting sends the MCP
`notifications/cancelled` notification with the JSON-RPC request id and reason
`request aborted`, then rejects locally with `McpRequestError` code `-32001`.
The default 30-second timeout uses the same wire notification with reason
`request timed out`, but rejects with code `-32000` and the timeout message.
Progress notifications are matched to the request's progress token and invoke
`onProgress({ progress, total? })`; exceptions thrown by that callback do not
break the MCP transport or global notification handlers.

When a call settles, the client removes its pending request, timer, abort
listener, and progress route. A late response is ignored. An already-aborted
signal is rejected before any `tools/call` or cancellation notification is
written to the server.

The CLI registers a `<prefix>:resource` tool (read by URI) and a
`<prefix>:prompt` tool (get by name) for every connected server, and lists the
available resources and prompts in the agent system prompt so the model can
discover and use them. When a server emits a `tools/list_changed` notification,
the CLI unregisters that server's old `<prefix>:*` tools and re-registers the
updated set.
