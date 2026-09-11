# Desktop

dev-agent's desktop shell: a local web server with a streaming chat UI that wraps
the same `AgentLoop` used by the CLI. It reuses the existing `@dev-agent/*`
packages (agent-core, model, tools, mcp, executor) and needs no Electron or
native dependencies — just Node.js.

## Running

```bash
pnpm install
pnpm --filter @dev-agent/desktop run build
pnpm --filter @dev-agent/desktop run start
```

Then open the printed URL (default `http://127.0.0.1:4317`) in a browser.

Configure the model provider the same way as the CLI, via environment variables:

- `DEV_AGENT_MODEL_PROVIDER` — `ollama` (default), `openai`, `anthropic`, `gemini`
- `DEV_AGENT_MODEL` — model id
- Provider-specific keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_BASE_URL`
- `DEV_AGENT_DESKTOP_HOST` / `DEV_AGENT_DESKTOP_PORT` — bind address (default `127.0.0.1:4317`)
- `DEV_AGENT_MEMORY_FILE` — session memory file (defaults to `~/.dev-agent/sessions/desktop-default.json`)
- `DEV_AGENT_MAX_CONTEXT_CHARS` — optional conversation-history budget; oldest
  entries are dropped first (never splitting a tool call from its results)
- `DEV_AGENT_SUMMARIZE_CONTEXT` — `1`/`true`/`yes` replaces the dropped history
  with a model-written `[summary]` digest instead of the omission notice
- `DEV_AGENT_SUMMARY_MAX_CHARS` — cap for that digest (default 2000 characters)

## How it works

- `src/index.ts` — entry point; starts the server.
- `src/server.ts` — HTTP server. Serves the static chat UI, exposes `GET /health`,
  and streams chat responses from `POST /api/chat` as Server-Sent Events.
- `src/chat-session.ts` — builds the `AgentLoop` with the default tools and model
  provider, and bridges its `onToken` / `onToolCall` / `onToolResult` / `onTurn`
  callbacks to SSE events.
- `public/index.html` — single-page chat UI (vanilla JS, no build step) that
  renders streaming tokens live and shows tool call/result activity.

## API

- `GET /` — chat UI.
- `GET /health` — `{ "status": "ok" }`.
- `POST /api/chat` — body: `{ "message": "..." }`. Responds with `text/event-stream`
  frames: `token`, `tool`, `tool-result`, `turn`, `usage`, `done`, `error`.
- `POST /api/chat` while another run is in flight — `409`, so two runs never
  interleave the same conversation state.

## Interrupts

Disconnecting the client aborts the running agent: the abort signal is forwarded
to the model request and checked before each turn and each tool call. The
stream closes with a `done` frame carrying `{ "status": "aborted" }`.

A tool call that is already executing is not killed; the run stops before the
next one. Cancelling an in-flight sandboxed command would need a cancel message
in the Rust executor protocol and is out of scope for now.

## Tests

```bash
pnpm --filter @dev-agent/desktop run test
```
