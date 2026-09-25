# Progress

## 2026-09-25

- Started the MCP tool health check slice after the Changes Center workflow was pushed.
- Existing MCP support exposes only configured/connected counts through Desktop status; per-server tool/resource/prompt counts and ping health are not yet surfaced.

## 2026-09-25 — implementation and verification

- Added bounded `McpHealthSnapshot` types/normalization with server count, connection/degraded state, tool/resource/prompt counts, latency, last-check time, and allowlisted error categories.
- Added abortable MCP `ping` support and session-bound health checks with a 2.5-second timeout; raw commands, args, environment, credentials, and server errors remain outside the projection.
- Added loopback-only `GET /api/mcp/health?sessionId=...` with stale-session handling and a 16 KiB response cap.
- Added bilingual Desktop health panel with refresh, stale-request cancellation, safe text rendering, and per-server health rows.
- MCP package suite passed 70/70; focused Desktop MCP health suite passed 4/4; full Desktop suite passed 250/250.
