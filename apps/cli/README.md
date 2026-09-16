# @agent_cli/cli

Primary entry point for phase 1. The package has two supported invocation modes:

- workspace development through `pnpm cli` from this repository;
- an installed `dev-agent` binary from any project directory after `@agent_cli/cli` is published or installed from a local tarball.

## Workspace development

Run from the repo root:

```bash
pnpm cli --version
pnpm cli --once "list files in the current directory"
pnpm cli --session docs --once "answer in code"
pnpm cli --session docs --reset-memory --once "start over"
pnpm cli --cleanup-evidence --remove-rolled-back --json
pnpm cli --session docs --export-evidence --audit-max-bytes 1048576
pnpm cli --session docs --preview-evidence --status failed
pnpm cli --tools
DEV_AGENT_MODEL_PROVIDER=ollama pnpm cli
```

## Installed CLI and external projects

After installing the package (or after placing a local package tarball in an npm
prefix), run the binary directly from the target project:

```bash
npm install -g @agent_cli/cli
cd /path/to/other-project
dev-agent --version
dev-agent --tools
dev-agent --cwd /path/to/other-project --index . --json
dev-agent --session other-project --once "list files in the current directory"
dev-agent init --cwd /path/to/other-project --gitignore
dev-agent config validate --cwd /path/to/other-project --project-state --json
dev-agent config show --cwd /path/to/other-project --project-state --json
```

`dev-agent init` creates `.dev-agent/config.json` and `.dev-agent/sessions`
without overwriting existing files. Add `--gitignore` only when you want the
command to append an idempotent `.dev-agent/` rule to the project `.gitignore`;
add `--dry-run` to preview the initialization. `config validate` checks the
JSON structure and supported provider, approval, validation, pricing, and MCP
fields without loading a provider or executing an MCP command. `config show`
prints the effective project configuration with sensitive-looking values
redacted. Both config commands support stable `--json` output.

`pnpm cli` is a workspace-only developer command; it is not required by an
installed user. See [`docs/release-cli-npm.md`](../../docs/release-cli-npm.md)
for clean-install checks, npm scope/version preflight, config/session isolation,
and the optional Rust sandbox boundary.

Options:

- `--once <prompt>` - run a single prompt and exit
- `--cwd <path>` - use an explicit working directory for filesystem, shell, git,
  search, code-search, MCP, and validation operations; the directory must exist.
  Filesystem, search, code-search, and MCP child-process paths are bounded to
  this project directory; shell and git remain command-level operations with
  the host permissions of the selected executor
- `--config <path>` - read a config file, resolving a relative path from the final
  working directory selected by `--cwd`
- `--project-state` - opt in to project-scoped defaults: config uses
  `<final-cwd>/.dev-agent/config.json` and sessions use
  `<final-cwd>/.dev-agent/sessions` unless an explicit config/session path is set;
  this does not migrate or rename existing user-level sessions
- `--session <id>` - use a separate persisted memory session
- `--reset-memory` - clear the selected memory before running
- `--tools` - list registered tools and exit
- `--metadata` - print metadata for the selected session and exit, including the
  accumulated token usage and a metadata-only `evidenceSummary` when the session
  has any
- `--session-list` - list saved sessions, newest first; `--json` includes each
  session's accumulated `usage` (`null` when it never reported tokens) and its
  metadata-only `evidenceSummary`
- `--cleanup-evidence` - explicitly prune metadata-only evidence for the selected
  session and exit. Optional `--max-validations <n>`, `--max-change-sets <n>`, and
  `--remove-rolled-back` control the cleanup; limits must be positive integers no
  greater than 10000. Applied change-set guards are always protected. The command
  never reads or changes workspace files, and `--json` returns removal, protection,
  remaining-count, and `evidenceSummary` fields
- `--export-evidence` - print a versioned, read-only metadata-only audit snapshot as
  JSON without loading a model provider or MCP server. Optional
  `--change-set-id <id>`, `--validation-id <id>`, and
  `--status passed|failed|skipped|blocked` filter the snapshot. Optional
  rejection-only limits are `--audit-max-validations <n>`,
  `--audit-max-change-sets <n>`, `--audit-max-files <n>`, and
  `--audit-max-bytes <n>`. The limits must be positive integers within the
  agent-core caps (10,000 validations, 10,000 change sets, 100,000 files, and
  10 MiB / 10,485,760 bytes); an over-limit complete snapshot exits non-zero
  and writes only a structured metadata error to stderr, never a partial JSON
  snapshot. The projection excludes commands, arguments, cwd, output, errors,
  diffs, patches, file bytes, before-images, and absolute working-directory paths;
  `--json` may be combined for scripting consistency
- `--preview-evidence` - print a separate, metadata-only preflight JSON object
  without loading a model provider or MCP server. It accepts the same
  `--change-set-id <id>`, `--validation-id <id>`, and
  `--status passed|failed|skipped|blocked` filters as `--export-evidence`, and
  returns only `schemaVersion`, `sessionId`, `generatedAt`,
  `validationCount`, `changeSetCount`, `fileCount`, and canonical UTF-8
  `serializedBytes`. It is for choosing a later export limit; it does not return
  evidence records, commands, paths, output/errors, file bytes, before-images,
  pagination fields, or recovery/execution authority. It cannot be combined with
  `--export-evidence`, `--cleanup-evidence`, `--audit-max-*`, or another command
  operation such as `--once`, `--index`, `--compact`, `--session-delete`,
  `--session-rename`, `--reset-memory`, `--mcp-server`, `--tools`, `--doctor`,
  or `--check-rust`.
- `--compact <n>` - compact the selected session, keeping the `n` most recent turns
- `--no-stream` - print only the final answer instead of streaming tokens
- `--rust-executor <path>` - run tools through the Rust sandbox runtime binary
- `--check-rust [path]` - send a health check to the Rust runtime binary
- `--mcp-server` - run as an MCP server over stdio instead of starting the agent,
  exposing the built-in tools, the `dev-agent://session` and
  `dev-agent://workspace` resources, and the `review-changes` /
  `explain-codebase` prompts to a host agent (no model provider needed).
  `--approval` (and the config file's `approval` section) also applies here:
  with `deny-dangerous` a flagged call comes back as `isError` with the reason
  instead of running, `ask` behaves the same because MCP has no prompt channel,
  and `review-writes` prepares the same change set but refuses filesystem
  mutations because stdio has no interactive reviewer.
- `--approval <mode>` - tool approval policy: `allow` (default, everything runs),
  `deny-dangerous` (block the built-in dangerous command patterns and writes
  outside the working directory), `ask` (same detection, but confirm with
  `y/N/a` first: `y` runs once, `a` runs and remembers the command + subcommand
  key for the rest of the session (`npm test` also covers
  `npm test -- --watch`), or `review-writes` (show the real filesystem diff and
  apply it only after an explicit `y`; dangerous shell/git calls keep their
  existing approval rules; EOF or a read failure denies it)
- `--json` - machine-readable output for `--once`, `--tools`, `--metadata`,
  `--session-list`, `--compact`, and `--cleanup-evidence`; implies `--no-stream`
  so nothing else is written to stdout. Prompt results include structured
  `reviews`, `validations`, `changeSets`, and metadata-only `evidenceSummary`
  fields. Argument-validation, provider-startup, and agent-run failures (whether
  returned as `status: "error"` or raised before a result exists) emit one
  `{ "error": "..." }` document on stdout and exit `1`; human-readable
  invocations keep their existing stderr errors. Evidence preview/export keep
  option errors on stderr so a successful JSON artifact can never be mixed with
  an error document.
- `--doctor` - check the environment (Node version, `rg`, `protoc`, the Rust
  runtime binary, the provider API key, `~/.dev-agent/config.json`, and the
  session directory); a missing config is fine, while malformed JSON is reported
  as a warning instead of being silently ignored. Exits 1 when any check fails.
  Combine with `--json` for `{ checks, summary }`
- `--session-delete <id>` - delete a stored session file; a missing session is
  reported (`deleted: false` with `--json`) without failing
- `--session-rename <old> <new>` - rename a stored session; refuses to overwrite
  an existing one and reports `{ from, to, renamed }` with `--json`. Renaming a
  session to its own name is a no-op when the session exists ("already has that
  name") and still reports "not found" when it does not
- `--index <path>` - scan a directory and write a symbol index to
  `<path>/.dev-agent/index.json`; scans TypeScript/JavaScript/Python/Rust up to
  depth 8 and skips `node_modules`, `dist`, `.git`, `.next`, `.cache`,
  `.dev-agent`. Unchanged files are reused from the previous index instead of
  re-read.
  `--json` reports `{ path, indexPath, files, symbols, reused, languages }`.
  The file also records per-file signatures so `code-search` can reuse it and
  only re-read what changed.
- `--version` / `-v` - print the CLI version

Arguments are validated before anything else runs: an unknown flag, a flag that
is missing its value, and a stray positional argument all exit `1` instead of
being ignored. Human-readable invocations receive the message on stderr;
`--json` invocations receive one parseable `{ "error": "..." }` document on
stdout. This matters because a typo used to fall through to interactive mode
(`--nope`), send the next flag as the prompt (`--once --json`), or consume it
as a session id (`--session --once`).

Running without `--once` starts an interactive session. Each prompt continues
from the previous run, so `[state=… turns=…]` counts the whole session and
`[usage]` accumulates instead of reporting one prompt at a time. In a real terminal
(where both stdin and stdout are TTYs), the CLI uses a rich presentation with a
welcome panel, provider/model/streaming status, a `›` input prompt, separate user
and assistant sections, live Markdown-aware streaming, and command hints. The
rich presentation is intentionally disabled for pipes, CI, `--json`, `--once`,
and `--mcp-server`, which keep the stable line-oriented or JSON contracts.

Rich interactive commands are `:help`, `:clear`, `:model`, and `:quit`; `exit`
and `quit` remain accepted aliases. During a request, `Thinking…` is shown until
the first token, tool activity, completion, failure, or cancellation, and rapid
tokens are coalesced into bounded live redraws. The readline echo is the single
user-input rendering, so the same prompt is not printed again as a separate
`You` block. Use `:validate <changeSetId>` for a guarded validation rerun, or
`:cleanup [--remove-rolled-back] [--max-validations N] [--max-change-sets N]`
for explicit metadata-only evidence cleanup. Cleanup reports removed validations,
removed change sets, protected applied guards, remaining counts, and the current
retention summary; it never executes a command or touches workspace files.
`Ctrl-C` cancels the request that is in flight (through the same abort path the
desktop uses) and exits with status `130`; it also exits immediately when the CLI
is idle at the prompt.

For a deterministic plain-text transcript with no terminal control sequences, use
a pipe, `--once`, or `--json`. Human-readable model/tool text is sanitized before it
reaches the terminal and obvious credential-shaped values are shown as `[redacted]`;
`--json` preserves the original successful model data and relies on JSON escaping for control
characters. Provider error response bodies are treated as untrusted input: credential-shaped
fields are redacted and the diagnostic body is bounded before it reaches agent memory or a JSON
error document.
`NO_COLOR=1` disables color ANSI in rich TTY mode, but cursor movement and clear-line
sequences required for live redraw remain.
Human-readable agent runs print the resolved runtime before the first prompt or
`--once` request:

```text
[runtime] provider=ollama model=qwen3:4b-instruct streaming=enabled
```

After each request, the CLI prints the time to the first visible token and the
total agent-run duration:

```text
[timing] first-token=418ms total=962ms
```

`--no-stream` reports `first-token=n/a` because it intentionally waits for the
final answer. `--json` does not add these display lines to stdout; it continues
to emit one parseable JSON value.

When an MCP tool reports progress, human-readable runs print one line per
update, for example `[tool-progress] files:download 4/10` (or just the current
number when the server omits `total`). Machine-readable `--json` runs never
mix these lines into stdout; they continue to emit one parseable JSON value.

MCP server mode speaks newline-delimited JSON-RPC on stdio; every frame on
stdout is a protocol message, so logs (if any) go to stderr:

```bash
node apps/cli/dist/index.js --mcp-server
```

Hosts may cancel an active `tools/call` by sending the MCP
`notifications/cancelled` notification with its request id. The CLI forwards
that cooperative cancellation signal to built-in tools, including the shell
executor, so a stopped host request does not remain blocked on a running
command.

### Reviewed filesystem writes

Use `review-writes` when a human should see the exact file changes before the
agent writes them:

```bash
pnpm cli --approval review-writes --once "update the README"
```

The CLI prepares a change set before approval and prints its id, file paths,
addition/deletion totals, and unified diff to stderr. `y` applies the prepared
change set; any other answer leaves the original bytes unchanged. A reviewed
write is always decided per change set, so it never inherits the `ask` mode's
"always allow" memory. With `--json`, stdout remains one parseable JSON object
and the `reviews` field records the structured review outcome. In
`--mcp-server` mode there is no reviewer channel, so `--approval review-writes`
denies filesystem mutations safely rather than applying them.

### Change-set validation

After an approved `review-writes` apply, the CLI derives safe checks from the
actual changed paths and runs them through the same executor as the built-in
tools. Human mode reports each check with its status, id, duration, and
structured command summary:

```text
[validation] passed: validation passed: 1 passed
  [passed] workspace:diff-check (12ms) — git diff --check -- target.md
```

A failing check means **the change was applied, but validation failed**. The
CLI keeps the changed bytes on disk and does not automatically roll them back.
Use the review's change-set id with a caller that supports the guarded rollback
operation if an explicit Undo is wanted. Non-Git workspaces and unknown-only
changes are reported as `skipped` instead of attempting an unsafe Git check.

With `--json`, stdout remains one JSON value and includes the complete
`validations` DTO plus a `changeSets` evidence summary. The change-set summary
is metadata-only: it includes identity, session/workdir binding, file hashes and
stats, existence, state, and timestamps, but never includes a diff, command, or
file bytes.

```json
{
  "validations": [
    {
      "validationId": "validation:<change-set-id>",
      "changeSetId": "<change-set-id>",
      "status": "passed",
      "checks": [
        {
          "id": "workspace:diff-check",
          "status": "passed",
          "durationMs": 12,
          "command": {
            "executable": "git",
            "args": ["diff", "--check", "--", "target.md"],
            "cwd": "/workspace",
            "timeoutMs": 30000
          }
        }
      ],
      "durationMs": 12,
      "summary": "validation passed: 1 passed"
    }
  ],
  "changeSets": [
    {
      "changeSetId": "<change-set-id>",
      "sessionId": "docs",
      "workingDirectory": "/workspace",
      "state": "applied",
      "files": [
        {
          "path": "target.md",
          "kind": "file",
          "exists": true,
          "beforeSha256": "…",
          "afterSha256": "…",
          "size": 42
        }
      ]
    }
  ]
}
```

Validation failures do not turn a successful apply into a CLI error state;
validation status and apply status remain separate. Ctrl-C still cancels the
active model/tool/validation path through the shared abort signal. MCP server
mode has no validation runner and continues to deny `review-writes` mutations
when no interactive reviewer is available.

In interactive mode, `:validate <changeSetId>` explicitly reruns the trusted
checks for an applied change set. The command accepts only the change-set id;
the planner recreates the structured commands and assigns a fresh validation
attempt id. A rerun is serialized with Undo, checks the postimage before and
after execution, and never overwrites or rolls back user bytes. On startup and
before an explicit rerun, the CLI restores persisted applied evidence only after
rechecking the session id, canonical working directory, safe relative paths,
file kinds, existence, and postimage hashes. A valid cross-process restore is a
read-only validation guard, so it can be rerun but cannot be used for Undo;
conflicts or session/workdir mismatches are reported as `blocked` and leave the
workspace unchanged. Older session memory without `changeSets` remains readable
and simply reports an empty evidence array.

Configuration is read from the environment:

- `DEV_AGENT_WORKING_DIRECTORY` - default working directory when `--cwd` is not
  supplied; precedence is `--cwd > DEV_AGENT_WORKING_DIRECTORY > INIT_CWD > process.cwd()`
- `DEV_AGENT_CONFIG_FILE` - config file path when `--config` is not supplied;
  relative paths resolve from the final working directory. With `--project-state`
  and no explicit config path, the project default is
  `<final-cwd>/.dev-agent/config.json`; otherwise the legacy user default remains
  `~/.dev-agent/config.json`.
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
  `~/.dev-agent/sessions`, or to `<final-cwd>/.dev-agent/sessions` when
  `--project-state` is present. An explicit `DEV_AGENT_SESSION_DIR` always wins.
  Used by `--session`, `--metadata`, `--compact`, and `--session-list` alike, so
  sessions written by the CLI are the ones listed.
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
- `DEV_AGENT_VALIDATION_POLICY` - validation policy (`fast`, `default`, or
  `strict`); overrides the matching config-file setting.
- `DEV_AGENT_APPROVAL` - approval mode (`allow`, `deny-dangerous`, `ask`,
  `review-writes`); `--approval` wins over it, and it wins over `approvalMode`
  in the config file.
- `DEV_AGENT_RUST_BINARY` - path to the `dev-agent-executor` binary. Applies to
  real tool runs as well as `--check-rust`, so setting it routes every tool
  command through the Rust sandbox. `--rust-executor <path>` wins over it.
- `DEV_AGENT_MCP_SERVERS` - optional JSON array of MCP stdio server configs

Each entry may also set `timeoutMs` (per-request MCP timeout, default 30000);
`DEV_AGENT_MCP_TIMEOUT_MS` overrides it for every server. A server that never
answers now fails fast — `dev-agent --tools` exits 1 with
`MCP request "initialize" timed out after <n>ms` instead of hanging.
MCP stdio frames are bounded to 8 MiB by default and are rejected while they
are being decoded if the UTF-8 payload exceeds that limit. This protects both
the CLI's MCP client and `--mcp-server` before an oversized JSON frame can
become an unbounded allocation.

Each configured MCP server contributes tools named `<prefix>:*`. The prefix is
the server's `name`; a single unnamed server keeps the historical `mcp`, several
unnamed servers become `mcp-1`, `mcp-2`, ... in config order, and a repeated
`name` gets a numeric suffix (`files`, `files-2`). Prefixes are always unique so
two servers can never overwrite each other's tools.

Runs print a `[usage] prompt=… completion=… total=…` line after the state line
when the provider reported token counts. When the config file has a matching
`pricing` entry, the line ends with `cost=$0.00000795`; unknown models and
unpriced runs print no cost, and `--json` carries the same value as a `cost`
field (`null` when unknown).

## Configuration file

By default `~/.dev-agent/config.json` is read on every run. Use
`--config <path>` or `DEV_AGENT_CONFIG_FILE` for a project-specific file. The
precedence is `--config > DEV_AGENT_CONFIG_FILE > ~/.dev-agent/config.json`; a
relative explicit path is resolved from the final `--cwd` directory. Environment
variables and CLI flags take precedence over values in the selected file, so a
saved preference never overrides an explicit invocation.

```json
{
  "defaultProvider": "openai",
  "defaultModel": "gpt-4o-mini",
  "maxTurns": 12,
  "maxContextChars": 120000,
  "validation": { "policy": "default" },
  "pricing": {
    "gpt-4o-mini": { "inputPerMillion": 0.15, "outputPerMillion": 0.6 }
  },
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
- `validation.policy` (or `validationPolicy`) - one of the predefined validation
  policies: `fast`, `default`, or `strict`. The environment variable
  `DEV_AGENT_VALIDATION_POLICY` overrides it. The policy selects a fixed check
  set; executable, shell, args, cwd, diff, and custom check definitions are not
  accepted.
- `approvalMode` - approval policy (`allow`, `deny-dangerous`, `ask`, or
  `review-writes`); used when `DEV_AGENT_APPROVAL` is unset.
- `approval.allow` / `approval.deny` - extra approval rules shared with the
  desktop app. `allow` entries are command substrings that always pass (for
  example `"npm test"`); `deny` entries are regular expressions added to the
  built-in dangerous table. Malformed patterns are ignored.
- `pricing` - model-name prefix to USD per one million tokens
  (`inputPerMillion` / `outputPerMillion`), used to estimate the cost shown in
  `[usage]` and `--json`. An optional `cachedInputPerMillion` prices cache-hit
  prompt tokens (OpenAI/Anthropic report them separately) at a discount;
  `cacheCreationInputPerMillion` does the same for Anthropic cache writes.
  Either falls back to the normal input price when unset. The longest matching
  prefix wins, so a dated snapshot such as `gpt-4o-mini-2024-07-18` can share
  the `gpt-4o-mini` entry. Entries with missing or negative values are ignored,
  and an unknown model simply shows no cost.
- `mcpServers` - MCP stdio servers, used when `DEV_AGENT_MCP_SERVERS` is unset.

Malformed JSON or an unreadable config file is ignored; an invalid validation policy or validation command field is rejected rather than silently disabled.

When MCP servers are configured, dev-agent injects `DEV_AGENT_SESSION_ID` and
`DEV_AGENT_WORKING_DIRECTORY` into each server process so MCP tools can share
the same runtime context. The selected project directory is also the MCP
child's process `cwd` and roots boundary. If a server emits a tools, resources,
or prompts list-change notification, dev-agent refreshes that server's tools
and rebuilds the system-prompt metadata; the refreshed prompt/resource list is
read immediately before the next model turn, without duplicate stale entries.

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
The working directory uses the fixed precedence `--cwd`,
`DEV_AGENT_WORKING_DIRECTORY`, `INIT_CWD`, then `process.cwd()`. The selected
path is validated before provider or tool initialization, and is passed to all
built-in tools and configured MCP servers. A path that traverses outside the
project or follows a symlink outside it is rejected by filesystem, search, and
code-search tools. The shell tool still intentionally delegates to the
selected executor; use `--rust-executor` when a restricted runtime is required.
