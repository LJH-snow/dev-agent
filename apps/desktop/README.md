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
  patterns and filesystem writes outside the working directory; `ask` shows the
  flagged call in the chat and waits for an Allow/Deny click. Without a client
  to answer, `ask` stays conservative and denies.
- `DEV_AGENT_APPROVAL_TIMEOUT_MS` — how long an `ask` prompt may stay unanswered
  before it is denied (default 120000).

Both surfaces also read the `approval` section of `~/.dev-agent/config.json`:
`allow` lists command substrings that always pass (`"npm test"`), `deny` adds
regular expressions to the dangerous table. The same file's `pricing` section
(model-name prefix to `inputPerMillion` / `outputPerMillion`) lets the header
show an estimated USD cost next to the token counter; without a matching entry
only tokens are shown.

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
- `DELETE /api/sessions/<id>` — delete a session's memory file and drop it from
  the in-memory registry; unknown ids return `404`.
- `POST /api/sessions/<id>/rename` — body `{ "sessionId": "new-id" }`; moves the
  memory file, answers `409` when the target exists and `404` when the source is
  missing.
- `GET /api/sessions/<id>/export` — the session as a Markdown transcript
  (`text/markdown`, attachment filename `<id>.md`); `404` when unknown.
- `POST /api/chat` — body: `{ "message": "..." }`. Responds with `text/event-stream`
  frames: `token`, `tool`, `tool-result`, `turn`, `usage`, `approval`, `done`,
  `error`. An `approval` frame carries `{ tool, decision, reason }`; a denial is
  also written back to the model as that tool's result.
- `POST /api/chat` takes an optional `sessionId` (unknown ids are created on
  first use). The `409` guard is per session: different sessions run
  concurrently while one session stays serialised.
- `POST /api/approval` — body `{ "id": "...", "decision": "allow" | "deny" }`
  answers an `approval-request` frame; unknown or already answered ids return
  `404`.

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

The header also restores the session's accumulated token count (and its
estimated cost when the `pricing` config matches the current model) from the
`usage` stored with the session file, so a page reload no longer resets it.

The `Delete` button next to the picker removes the current session after a
confirmation and switches back to the default one.

The `Download` button saves the current session as a Markdown file.

## Approvals

With `DEV_AGENT_APPROVAL=ask`, a flagged tool call renders an Allow/Deny prompt
in the conversation and the run waits for the click. "Always allow" remembers
the command + subcommand key for the rest of the session, so `npm test` and
`npm test -- --watch` only ask once. The decision is echoed as an `approval`
frame, and a denial is written back to the model as the tool's result so it can
pick another path.

## Tests

```bash
pnpm --filter @dev-agent/desktop run test
```
