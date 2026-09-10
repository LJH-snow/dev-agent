# Changelog

## 2026-09-10 (Night Build)

### Test infrastructure
- Split executor tests into `test` (no sandbox) and `test:integration` (sandbox-exec).
- Added `scripts/test-with-sandbox.mjs` to run the full suite with elevated permissions.
- Added LocalExecutor edge-case tests (empty command, nonexistent command, stdout across non-zero exits).

### MCP robustness
- Reconnect with exponential backoff (3 attempts, 1s/2s/4s) in `McpServerSession`.
- Debounced `tools/list_changed` / `resources/list_changed` / `prompts/list_changed` notifications (500ms).
- Graceful close: `close()` is idempotent and does not reject pending requests after the client is closed.
- Structured errors: `McpRequestError` carries the JSON-RPC error code from the server.
- New tests: reconnect backoff, notification debounce, error propagation, graceful close.

### Executor and Rust runtime
- `ExecutorResult` now includes `durationMs` and `command`.
- `LocalExecutor` supports optional execution history (`historyLimit`).
- Linux sandbox placeholder improved: detects `bwrap` availability for a clearer unsupported message.

### CLI hardening
- Agent loop exposes an `onTurn` callback; CLI prints `[turn N]` progress.
- System prompt now includes runtime (platform / Node version) and available tool count.
- New commands: `--metadata` (session metadata), `--compact <turns>` (compact session memory).
- Ctrl-C handling: interactive mode interrupts cleanly and saves partial session state.
- New E2E tests for `--tools`, `--version`, `--metadata`, `--compact`.

### Code intelligence
- Improved symbol ranking: case-sensitive exact-match bonus, test-file demotion, path-depth penalty.
- New `JsonFileCodeIndex` with JSON persistence and incremental updates.
- New tests for ranking behavior and persistent index load/save.

### Policy language
- The Rust sandbox uses **Starlark** for filesystem/network/policy rules, consistent with the
  open-source Codex agent. See `runtime/rust/README.md` for the policy model.

## 2026-09-10 (Night Build v2)

### Agent Loop streaming
- AgentLoop now supports `onToken`, `onToolCall`, `onToolResult` callbacks for streaming progress.
- All four model providers (OpenAI, Anthropic, Gemini, Ollama) implement `streamChat` for token-level streaming.
- Fallback to non-streaming `chat` when callbacks are not provided.

### Tool output truncation and timeout
- `runTool` now truncates output exceeding `maxOutputChars` (default 50000), preserving head and tail with a notice.
- Tool execution honors `timeoutMs` (default 30000); returns structured error instead of hanging.
- Configurable via `AgentLoopOptions.toolDefaults`.

### MCP resource subscription
- `McpServerSession.watchResource(uri, callback)` subscribes to resource changes.
- Supports `resources/updated` notifications and `resources/list_changed` (triggers all watchers).
- Unwatch function returned for cleanup.

### Code intelligence — multi-language scanning
- New `python-scanner.ts` extracts Python functions, classes, and methods (with class scope tracking).
- New `rust-scanner.ts` extracts Rust functions, structs, enums, types, modules, and uses.
- `scanFile()` dispatches to the correct scanner based on file extension.
- `InMemoryCodeIndex.addSource` now handles .py, .rs, .ts, .tsx, .js, .jsx, .mts, .mjs, .cjs.

### Executor quotas and safety
- `LocalExecutor` now enforces `maxOutputBytes` (default 1MB) — terminates process and sets `bytesTruncated`.
- `maxConcurrentExecutions` (default 5) prevents fork bombs.
- `getActiveCount()` exposes current execution count.

### CLI configuration
- `loadConfig()` reads `~/.dev-agent/config.json` for default provider, model, maxTurns, mcpServers.
- `parseConfig()` exposed for testing config parsing logic.

### Integration tests
- CLI integration tests verify `--version`, `--tools`, `--metadata` E2E.
- Full pipeline test verifies AgentLoop with FileMemory persistence.
