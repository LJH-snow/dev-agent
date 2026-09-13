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
  flagged call in the chat and waits for an Allow/Deny click; `review-writes`
  shows the real filesystem diff and applies it only after Allow. Without a
  client to answer, `ask` and `review-writes` stay conservative and deny.
- `DEV_AGENT_APPROVAL_TIMEOUT_MS` — how long an `ask` prompt may stay unanswered
  before it is denied (default 120000).
- `DEV_AGENT_SSE_MAX_BYTES` — how many bytes one SSE stream may buffer before the
  server stops it (default 32 MiB). A client that stops reading cannot make the
  desktop server buffer without bound; the stream gets an `error` event and the
  run is aborted.
- `DEV_AGENT_MCP_SERVERS` — optional JSON array of MCP stdio server configs;
  when unset, the `mcpServers` array in `~/.dev-agent/config.json` is used.
  Each entry can set `name`, `command`, `args`, `env`, and `timeoutMs` (default
  30 seconds).

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
  provider, optionally connects configured MCP stdio servers, and bridges its
  `onToken` / `onToolCall` / `onToolProgress` / `onToolResult` / `onTurn`
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
  missing. Renaming to the current id is idempotent (`200` with
  `renamed: false`) when the session exists, and `404` when it does not.
- `GET /api/sessions/<id>/export` — the session as a Markdown transcript
  (`text/markdown`, attachment filename `<id>.md`); `404` when unknown.
- `POST /api/chat` — body: `{ "message": "..." }`. Responds with `text/event-stream`
  frames: `token`, `tool`, `tool-progress`, `tool-result`, `turn`, `usage`,
  `approval-request`, `approval`, `done`, `error`. A `tool-progress` frame carries
  `{ name, progress, total? }`; for one tool call it appears after `tool` and
  before `tool-result`. An `approval-request` frame carries `{ id, tool, reason,
  input }`; in `review-writes` mode it also carries `review` with the
  `changeSetId`, per-file hashes/diff, and addition/deletion totals. The matching
  `approval` frame preserves the decision and includes the same review. A
  denial is also written back to the model as that tool's result.
- `POST /api/chat` takes an optional `sessionId` (unknown ids are created on
  first use). The `409` guard is per session: different sessions run
  concurrently while one session stays serialised.
- `POST /api/chat/cancel` — body `{ "sessionId": "..." }`. Aborts the run that
  is in flight in that session and answers `{ sessionId, cancelled: true }`;
  the aborted stream still closes with `done { "status": "aborted" }`.
  Cancelling an idle session is a no-op (`cancelled: false`) rather than an
  error, so the caller can repeat it safely.
- `POST /api/approval` — body `{ "id": "...", "decision": "allow" | "deny" }`
  answers an `approval-request` frame; unknown or already answered ids return
  `404`.
- `POST /api/changesets/rollback` — body `{ "sessionId": "...",
  "changeSetId": "..." }`; guarded rollback of an applied reviewed change set.
  A successful response is the change-set result. Unknown or expired ids return
  `404`; an in-flight session, postimage conflict, or already rolled-back set
  returns `409`; an unavailable rollback implementation returns `501`.

## Interrupts

Disconnecting the client aborts the running agent: the abort signal is forwarded
to the model request and checked before each turn and each tool call. The
stream closes with a `done` frame carrying `{ "status": "aborted" }`.

The header's `Stop` button does the same thing without dropping the connection:
it calls `POST /api/chat/cancel`, the run unwinds through the same abort path,
and the status reads `aborted` instead of snapping back to `idle`. The button is
enabled only while a run is in flight.

A tool call that is already executing is cancelled too: the signal reaches the
executor, which kills the command (see `packages/executor`), or reaches a
configured MCP client, which sends `notifications/cancelled` to that server.
The aborted stream still emits its terminal `done { "status": "aborted" }` frame
and does not emit a late MCP `tool-result`.

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

The `Rename` button prompts for a new session id and moves the stored file; an id
that already exists is reported as a conflict instead of overwriting anything.

The `Download` button saves the current session as a Markdown file.

## Approvals

With `DEV_AGENT_APPROVAL=ask`, a flagged tool call renders an Allow/Deny prompt
in the conversation and the run waits for the click. "Always allow" remembers
the command + subcommand key for the rest of the session, so `npm test` and
`npm test -- --watch` only ask once. The decision is echoed as an `approval`
frame, and a denial is written back to the model as the tool's result so it can
pick another path.

With `DEV_AGENT_APPROVAL=review-writes`, filesystem `write`, `edit`, `patch`,
and `mkdir` mutation calls are first converted into a read-only change set. The
chat shows the change-set id, file-level additions/deletions,
SHA-256 preimage/postimage metadata, and the real unified diff. Allow applies
that exact change set atomically; Deny, timeout, or client disconnect leaves the
workspace unchanged. Reviewed cards do not offer "Always allow". After a
successful Allow, the card offers **Undo**, which calls
`POST /api/changesets/rollback`; rollback is guarded by the postimage hash and
will report a conflict rather than overwrite an external edit.

## Tests

```bash
pnpm --filter @dev-agent/desktop run test
```
