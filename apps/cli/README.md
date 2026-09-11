# @dev-agent/cli

Primary entry point for phase 1.

Run from the repo root:

```bash
pnpm cli -- --version
pnpm cli -- --once "list files in the current directory"
pnpm cli -- --session docs --once "answer in code"
pnpm cli -- --session docs --reset-memory --once "start over"
pnpm cli -- --tools
DEV_AGENT_MODEL_PROVIDER=ollama pnpm cli
```

Options:

- `--once <prompt>` - run a single prompt and exit
- `--session <id>` - use a separate persisted memory session
- `--reset-memory` - clear the selected memory before running
- `--tools` - list registered tools and exit
- `--metadata` - print metadata for the selected session and exit
- `--session-list` - list saved sessions, newest first
- `--compact <n>` - compact the selected session, keeping the `n` most recent turns
- `--no-stream` - print only the final answer instead of streaming tokens
- `--rust-executor <path>` - run tools through the Rust sandbox runtime binary
- `--check-rust [path]` - send a health check to the Rust runtime binary
- `--mcp-server` - run as an MCP server over stdio instead of starting the agent,
  exposing the built-in tools to a host agent (no model provider needed)
- `--version` / `-v` - print the CLI version

MCP server mode speaks newline-delimited JSON-RPC on stdio; every frame on
stdout is a protocol message, so logs (if any) go to stderr:

```bash
node apps/cli/dist/index.js --mcp-server
```

Configuration is read from the environment:

- `DEV_AGENT_MODEL_PROVIDER` - `ollama` (default), `openai`, `anthropic`, or `gemini`
- `DEV_AGENT_MODEL` - model name; defaults to `qwen3:4b-instruct` for Ollama
- `OLLAMA_BASE_URL` - optional Ollama base URL override
- `OPENAI_API_KEY` / `DEV_AGENT_OPENAI_API_KEY` - required for OpenAI
- `OPENAI_BASE_URL` - optional OpenAI-compatible base URL override
- `ANTHROPIC_API_KEY` / `DEV_AGENT_ANTHROPIC_API_KEY` - required for Anthropic
- `ANTHROPIC_BASE_URL` - optional Anthropic base URL override
- `GEMINI_API_KEY` / `DEV_AGENT_GEMINI_API_KEY` - required for Gemini
- `GEMINI_BASE_URL` - optional Gemini base URL override
- `DEV_AGENT_MEMORY_FILE` - optional JSON memory file path; when set, it bypasses
  session files. Without it, memory defaults to `~/.dev-agent/sessions/default.json`
  and `--session <id>` maps to `~/.dev-agent/sessions/<id>.json`
- `DEV_AGENT_SESSION_DIR` - optional directory holding session files; defaults to
  `~/.dev-agent/sessions`. Used by `--session`, `--metadata`, `--compact`, and
  `--session-list` alike, so sessions written by the CLI are the ones listed.
- `DEV_AGENT_MAX_CONTEXT_CHARS` - optional character budget for the conversation
  history sent to the model. Oldest entries are dropped first (never splitting a
  tool call from its results) and the model is told how many were omitted. Unset
  means the full history is sent, exactly as before.
- `DEV_AGENT_SUMMARIZE_CONTEXT` - `1`/`true`/`yes` replaces the dropped history
  with a model-written `[summary]` digest instead of the omission notice; the
  digest grows incrementally and its tokens are counted in `[usage]`. `0`/`false`
  turns it off.
- `DEV_AGENT_SUMMARY_MAX_CHARS` - cap for the digest; over-long summaries keep
  their newest part. Defaults to 2000 characters.
- `DEV_AGENT_RUST_BINARY` - path to the `dev-agent-executor` binary. Applies to
  real tool runs as well as `--check-rust`, so setting it routes every tool
  command through the Rust sandbox. `--rust-executor <path>` wins over it.
- `DEV_AGENT_MCP_SERVERS` - optional JSON array of MCP stdio server configs

Runs print a `[usage] prompt=… completion=… total=…` line after the state line
when the provider reported token counts.

## Configuration file

`~/.dev-agent/config.json` is read on every run. Environment variables and CLI
flags take precedence over it, so a saved preference never overrides an explicit
invocation.

```json
{
  "defaultProvider": "openai",
  "defaultModel": "gpt-4o-mini",
  "maxTurns": 12,
  "maxContextChars": 120000,
  "mcpServers": [
    { "name": "files", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
  ]
}
```

- `defaultProvider` / `defaultModel` - used when `DEV_AGENT_MODEL_PROVIDER` /
  `DEV_AGENT_MODEL` are unset.
- `maxTurns` - agent turn budget; must be a positive integer, otherwise ignored
  (the default is 8).
- `maxContextChars` - conversation-history budget; used when
  `DEV_AGENT_MAX_CONTEXT_CHARS` is unset. Must be a positive integer, otherwise
  ignored (the default is no budget).
- `summarizeContext` - when true, trimmed history is summarized rather than
  announced; used when `DEV_AGENT_SUMMARIZE_CONTEXT` is unset.
- `summaryMaxChars` - digest length cap; used when
  `DEV_AGENT_SUMMARY_MAX_CHARS` is unset.
- `mcpServers` - MCP stdio servers, used when `DEV_AGENT_MCP_SERVERS` is unset.

A malformed config file is ignored rather than fatal.

When MCP servers are configured, dev-agent injects `DEV_AGENT_SESSION_ID` and
`DEV_AGENT_WORKING_DIRECTORY` into each server process so MCP tools can share
the same runtime context.

Example:

```bash
DEV_AGENT_MCP_SERVERS='[{"name":"files","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}]' pnpm cli
```

The CLI registers the default built-in tools (filesystem, shell, git, search,
code-search) plus any MCP tools, persists
conversation history with `FileMemory`, and prints the last assistant answer
after each prompt. Use `--session` to keep separate project or task histories,
and `--reset-memory` to clear the current session. The agent context records the
session id, working directory, provider, CLI version, current task, and last error.
The working directory is the directory where the CLI was invoked, preserved via
`INIT_CWD` when running through pnpm scripts.
