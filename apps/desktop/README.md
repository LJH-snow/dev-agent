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
- `DEV_AGENT_APPROVAL` — `deny-dangerous` blocks the built-in dangerous command
  patterns and filesystem writes outside the working directory. The web UI has
  no approval prompt yet, so `ask` also behaves as `deny-dangerous`; use the CLI
  when a human should confirm each dangerous call.

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
- `GET /api/sessions` — the default session id plus every session file in
  `DEV_AGENT_SESSION_DIR` (`~/.dev-agent/sessions` by default), newest first.
- `GET /api/sessions/<id>/messages` — the stored transcript of one session.
- `POST /api/chat` — body: `{ "message": "..." }`. Responds with `text/event-stream`
  frames: `token`, `tool`, `tool-result`, `turn`, `usage`, `approval`, `done`,
  `error`. An `approval` frame carries `{ tool, decision, reason }`; a denial is
  also written back to the model as that tool's result.
- `POST /api/chat` takes an optional `sessionId` (unknown ids are created on
  first use). The `409` guard is per session: different sessions run
  concurrently while one session stays serialised.

## Interrupts

Disconnecting the client aborts the running agent: the abort signal is forwarded
to the model request and checked before each turn and each tool call. The
stream closes with a `done` frame carrying `{ "status": "aborted" }`.

A tool call that is already executing is cancelled too: the signal reaches the
executor, which kills the command (see `packages/executor`).

## Sessions

The header has a session picker plus a `+` button for a new one. Switching
sessions reloads that transcript and sends later messages to it. With
`DEV_AGENT_MEMORY_FILE` set, every session shares that single file; leave it
unset to get one file per session.

## Tests

```bash
pnpm --filter @dev-agent/desktop run test
```
