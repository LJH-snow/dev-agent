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
- `--version` / `-v` - print the CLI version

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
- `DEV_AGENT_MCP_SERVERS` - optional JSON array of MCP stdio server configs

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
