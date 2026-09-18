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
only tokens are shown. The same config file may set
`"validation": { "policy": "default" }` (or the flat `validationPolicy` key);
`DEV_AGENT_VALIDATION_POLICY` overrides it. Only `fast`, `default`, and `strict`
are accepted, and validation command fields are deliberately not configurable.

## How it works

- `src/index.ts` — entry point; starts the server.
- `src/server.ts` — HTTP server. Serves the static chat UI, exposes `GET /health`
  and the metadata-only `GET /api/status` endpoint, and streams chat responses
  from `POST /api/chat` as Server-Sent Events.
- `src/status.ts` — allowlisted status model shared by the server, session, and
  status panel. It intentionally excludes secrets, absolute paths, source text,
  command arguments, and raw exception details. The managed-runtime summary is
  sanitized before serialization, even when injected by a custom host.
- `src/chat-session.ts` — builds the `AgentLoop` with the default tools and model
  provider, optionally connects configured MCP stdio servers, and bridges its
  `onToken` / `onToolCall` / `onToolProgress` / `onToolResult` / `onValidation` /
  `onTurn` callbacks to SSE events.
- `public/index.html` — single-page chat UI (vanilla JS, no build step) that
  renders streaming tokens live, shows tool call/result activity, renders
  validation cards next to reviewed-change Undo actions, and displays the
  metadata-only runtime status panel.

## API

All POST JSON endpoints accept at most `1 MiB` of request body. A larger body
returns `413`; the server does not echo the body, path, or raw error.
Static responses under `/public/` are also capped at `1 MiB`; an oversized file
returns `413` without echoing the path, contents, or raw error.
Static symlink requests, including the root static asset, are resolved to real
paths and must remain inside the real public directory; escaped or broken
symlinks return a clean `404`.
A trimmed `changeSetId` passed to rollback or validation rerun may contain at
most `96` characters; a longer change set ID returns `400` before calling the
session.
Evidence query filters for `changeSetId` and `validationId` are also capped at
`96` trimmed characters; a longer evidence query filter returns `400` without
selecting evidence.
An approval request ID may contain at most `96` characters; a longer approval
ID returns `400` before the approval lookup.

- `GET /` — chat UI, including the runtime status panel.
- `GET /health` — lightweight liveness response with the executor mode.
- `GET /api/status?sessionId=<id>` — metadata-only status for the selected
  session. The response reports executor, Node runtime, provider, model,
  approval mode, validation policy, the latest validation result, and whether the
  session is currently busy.
  Status loading is stale-safe: a new status request aborts the previous status
  request, and a response for a stale request or stale session does not render.
  It always includes a managed-runtime summary. `state` is `unsupported`,
  `missing`, `installed`, `corrupt`, or `unavailable`; `target` is one of the
  four supported runtime targets, `version` appears only when the installed
  binary has been verified, and `reason` is a stable diagnostic rather than raw
  error text.
  It may include a safe `workspace.label` derived from the working directory
  and an `mcp` summary with configured/connected counts only. It does not
  expose MCP commands, args, env, or absolute paths.
  It never returns API keys, environment values, absolute paths, source text,
  command arguments, or raw provider/tool errors. Unknown sessions return a
  generic `404` response. Unexpected internal failures return a generic `500`
  `request failed` response instead of leaking the thrown diagnostic.
- `GET /api/sessions` — the default session id plus stored session files from
  `DEV_AGENT_SESSION_DIR` (`~/.dev-agent/sessions` by default), newest first.
  The fixed session listing holds at most `256` summaries; active/default
  sessions are retained first, and summaries are then filled in stable filename
  order.
  Each summary includes a metadata-only `evidenceSummary` with retained counts,
  effective limits, and the number/reason for protected applied guards.
- `GET /api/sessions/<id>/messages` — the stored transcript of one session,
  returned as `{ messages, validations, changeSets, evidenceSummary }`; validation
  and applied change-set evidence stay separate from the model message list. The
  summary always describes the whole session, while optional query filters
  `changeSetId`, `validationId`, and `status` (`passed`, `failed`, `skipped`, or
  `blocked`) narrow only the evidence arrays without removing messages. An
  oversized evidence query filter returns `400` without selecting evidence.
  An invalid `status` returns a structured `400` response.
  The fixed history response is capped at `1 MiB`; an oversized transcript
  returns `413` without echoing the transcript, path, or raw error.
  History loading is stale-safe: a new history request aborts the previous
  history request, and a response for a stale request or stale session does not
  render.
- `DELETE /api/sessions/<id>` — delete a session's memory file and drop it from
  the in-memory registry; unknown ids return `404`.
- If a chat, validation, or cleanup request is already running in the session,
  deletion fails closed with `409`; the running request and memory file stay
  untouched.
- While rollback is active, rollback, deletion, and rename fail closed with
  `409`; chat, validation, and cleanup use the same active-session guard, and
  the active rollback is the only mutation that runs.
- `POST /api/sessions/<id>/rename` — body `{ "sessionId": "new-id" }`; moves the
  memory file, answers `409` when the target exists and `404` when the source is
  missing. Renaming to the current id is idempotent (`200` with
  `renamed: false`) when the session exists, and `404` when it does not.
  Rename also fails closed with `409` while the same session has an active
  chat, validation, cleanup, or rollback request, or when the active target is
  another session. Rename locks both the source and target while it runs, so a
  concurrent rename cannot duplicate the same source into the target.
- `GET /api/sessions/<id>/export` — the session as a Markdown transcript
  (`text/markdown`, attachment filename `<id>.md`); `404` when unknown. It
  accepts the same `changeSetId`, `validationId`, and `status` filters, applies
  the same `96`-character evidence query filter cap, and adds metadata-only
  change-set evidence and evidence-retention summary sections.
  The fixed export response is capped at `1 MiB`; an oversized transcript
  returns `413` without echoing the transcript, path, or raw error.
- `POST /api/chat` — body: `{ "message": "..." }`. Responds with `text/event-stream`
  frames: `token`, `tool`, `tool-progress`, `tool-result`, `turn`, `usage`,
  `approval-request`, `approval`, `validation`, `done`, `error`. A
  `tool-progress` frame carries `{ name, progress, total? }`; for one tool call it
  appears after `tool` and before `tool-result`. An `approval-request` frame
  carries `{ id, tool, reason, input }`; in `review-writes` mode it also carries
  `review` with the `changeSetId`, per-file hashes/diff, and addition/deletion
  totals. The matching `approval` frame preserves the decision and includes the
  same review. After a successful reviewed apply, a `validation` frame carries
  the complete validation DTO plus the session id, and arrives after the apply
  `tool-result`; its `status` is `passed`, `failed`, `skipped`, or `blocked`. A
  denial is also written back to the model as that tool's result.
- `POST /api/chat` takes an optional `sessionId` (unknown ids are created on
  first use). The fixed in-memory session registry holds at most `256` total
  sessions; a new unknown id after that returns `429` and does not start a run.
  A normalized `sessionId` may contain at most `96` characters; a longer
  request id returns `400` without starting a run or creating a registry entry.
  Existing sessions, including the default one, remain available. The `409`
  guard is per session: different sessions run concurrently while one session
  stays serialised.
- `POST /api/chat/cancel` — body `{ "sessionId": "..." }`. Aborts the run that
  is in flight in that session and answers `{ sessionId, cancelled: true }`;
  the aborted stream still closes with `done { "status": "aborted" }`.
  Cancelling an idle session is a no-op (`cancelled: false`) rather than an
  error, so the caller can repeat it safely.
- `POST /api/approval` — body `{ "id": "...", "decision": "allow" | "deny" }`
  answers an `approval-request` frame; unknown or already answered ids return
  `404`. The approval ID is capped at `96` characters; a longer ID returns
  `400` before looking up a pending approval.
- `POST /api/changesets/rollback` — body `{ "sessionId": "...",
  "changeSetId": "..." }`; guarded rollback of an applied reviewed change set.
  A successful response is the change-set result and durable evidence is then
  marked `rolled-back`. Unknown or expired ids return `404`; an in-flight session,
  postimage conflict, or already rolled-back set returns `409`; an unavailable
  rollback implementation returns `501`.
  A normalized `changeSetId` may contain at most `96` characters; a longer
  request ID returns `400` without calling rollback.
  A running rollback is tracked in the active session lifecycle: a concurrent
  rollback, deletion, or rename returns `409` and does not mutate the evidence
  or memory file.
  Undo loading is stale-safe: a new undo request aborts the previous undo
  request, and a response for a stale request or stale session does not update
  the UI.
- `POST /api/changesets/cleanup` — body `{ "sessionId": "...",
  "maxValidations": 3, "maxChangeSets": 10, "removeRolledBack": true }`; all
  fields except `sessionId` are optional. It changes only the selected session's
  memory metadata and returns removal counts, protected applied-guard counts,
  remaining counts, and `evidenceSummary`. Invalid JSON/limits return `400`, an
  unknown session returns `404`, an in-flight session returns `409`, and an
  unavailable cleanup implementation returns `501`. It never executes commands or
  reads/writes the working directory.
- `GET /api/sessions/<id>/evidence` — returns the selected session's versioned,
  metadata-only audit projection as JSON. It accepts the same `changeSetId`,
  `validationId`, and `status` filters as history/export plus optional
  rejection-only `maxValidations`, `maxChangeSets`, `maxFiles`, and `maxBytes`
  query values. Oversized evidence query filters return `400`. Limits are
  positive integers within the agent-core caps
  (10,000 validations, 10,000 change sets, 100,000 files, and 10 MiB /
  10,485,760 bytes); invalid values return `400`, while a complete snapshot
  over a requested limit returns `413` with `code`, `kind`, `limit`, and `actual`
  metadata and never a partial v1 snapshot. It returns `404` for an unknown
  session and never initializes a model, executes a command, or reads/writes the
  working directory. The projection excludes command inputs, output/error text,
  diffs, patches, file bytes, before-images, and the absolute working-directory
  path.
- `GET /api/sessions/<id>/evidence/preview` — returns a separate, fixed
  metadata-only preflight object with `schemaVersion`, `sessionId`, `generatedAt`,
  `validationCount`, `changeSetCount`, `fileCount`, and canonical UTF-8
  `serializedBytes` for the complete v1 projection. It accepts the standard
  `changeSetId`, `validationId`, and `status` filters, but rejects audit limit
  query values because limits apply only to the full `/evidence` export. The
  same `96`-character evidence query filter cap applies. It
  returns `404` for an unknown session and never initializes a model, enters the
  chat queue, executes a command, reads/writes the working directory, or exposes
  evidence content, paths, commands, output/errors, file bytes, before-images,
  pagination fields, or restore/Undo authority.
- `POST /api/changesets/validate` — body `{ "sessionId": "...",
  "changeSetId": "..." }`; explicitly reruns trusted validation for the
  applied change set without changing files. A successful response is the full
  validation DTO plus `sessionId`; unknown ids return `404`, a prepared,
  rolled-back, conflicting, or busy set returns `409`, and an unavailable
  rerunner returns `501`.
  A normalized `changeSetId` may contain at most `96` characters; a longer
  request ID returns `400` without calling validation rerun.
  Validation rerun loading is stale-safe: a new rerun request aborts the
  previous rerun request, and a response for a stale request or stale session
  does not update the UI.

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

## Validation

A reviewed filesystem apply is followed by a deterministic, allowlisted
validation plan derived from the changed paths. Package source changes run the
affected package's typecheck and test; Rust runtime changes run format, clippy,
and tests; documentation/configuration changes in a Git checkout run
`git diff --check` for the changed paths. Unknown-only or non-Git changes are
reported as `skipped`, and unsafe review paths are `blocked` before a command
runs. No model-provided shell string becomes a validation command.

The planner has three fixed policies: `fast` keeps the quickest relevant
checks (source typecheck, test-only package tests, or Rust fmt), `default`
keeps the changed-path checks above, and `strict` adds bounded workspace
`pnpm typecheck` and `pnpm test` checks when package or workspace configuration
changes are involved. Set `validation.policy` in `~/.dev-agent/config.json`,
`DEV_AGENT_VALIDATION_POLICY`, or the embedding `ChatSessionOptions`; only the
policy name is accepted, never custom commands, args, cwd, diffs, or check ids.

The browser renders `passed`, `failed`, `skipped`, and `blocked` results as a
validation card with the change-set id, check id, command summary, duration, and
reason. A failed validation explicitly means the apply succeeded but the check
failed; the already-applied bytes remain available to the guarded **Undo**
action. Each card also offers **Rerun validation** for an applied change set.
Rerun results are appended as separate evidence with a fresh attempt id and are
serialized with Undo. If Stop is pressed while a check is active, the current
validation is reported as `blocked` before the stream closes with `done { "status":
"aborted" }`.

Applied change-set evidence is persisted with the session in a minimal,
non-executable form. When a session is opened again, Desktop rechecks the
session/workdir binding, canonical paths, file kinds, existence, and postimage
hashes before restoring a read-only validation guard. A conflict becomes a
`blocked` validation and does not create, repair, overwrite, or roll back files.
Restored evidence supports explicit validation reruns but not **Undo**, because
the before-image is deliberately not persisted. Evidence is never added to the
model context, and its history/export summaries omit diffs, commands, and file
bytes. Session files from before this feature remain compatible and expose an
empty `changeSets` array.

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

The `Download` button saves the current session as a Markdown file,
including structured validation and change-set evidence sections. The history
endpoint and export preserve both kinds of evidence without adding them to model
context; use `changeSetId`, `validationId`, and `status` query filters when a
focused view is needed.

## Approvals

With `DEV_AGENT_APPROVAL=ask`, a flagged tool call renders an Allow/Deny prompt
in the conversation and the run waits for the click. "Always allow" remembers
the command + subcommand key for the rest of the session, so `npm test` and
`npm test -- --watch` only ask once. Each session remembers at most `256`
short always-allow keys, and only keys of at most `512 bytes`; an oversized or
post-limit decision allows the current call but is not remembered. Existing
remembered keys stay automatic. The decision is echoed as an `approval`
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
