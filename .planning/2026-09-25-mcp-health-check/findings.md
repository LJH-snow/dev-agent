# Findings

- `McpServerSession` already owns one MCP connection, exposes `prefix`, `getClient()`, `getSnapshot()`, and reconnect lifecycle.
- `McpClient.ping()` currently has no abort option; adding an optional signal is the safest way to keep health checks bounded without changing tool execution behavior.
- `ChatSession` keeps `mcpSessions` and `mcpSnapshots`, so the health surface can be session-bound and metadata-only without reading MCP config command/args/env.
- Desktop metadata routes are loopback-only. A dedicated `/api/mcp/health` route can follow the existing `/api/status` session resolution and response-size limits.
