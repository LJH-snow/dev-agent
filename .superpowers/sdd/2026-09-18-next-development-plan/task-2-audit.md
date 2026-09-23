# Task 2 Audit: Remaining Input Boundaries

Date: 2026-09-20

Status: completed as a read-only audit. No production source was changed for
this audit.

## Scope

The review covered:

- `apps/cli/src` and `apps/cli/tests`
- `apps/desktop/src` and `apps/desktop/tests`
- `packages/agent-core/src` and `packages/agent-core/tests`
- `packages/tools/src` and `packages/tools/tests`
- `packages/mcp/src` and `packages/mcp/tests`
- `packages/model/src` and `packages/model/tests`
- `packages/runtime-manager/src` and `packages/runtime-manager/tests`
- `runtime/rust/src`

The inventory started with:

```sh
rg -n "readFile|readFileSync|createReadStream|JSON\.parse|JSON\.stringify|readdir|stat\(" \
  apps/cli/src apps/desktop/src packages/agent-core/src packages/tools/src \
  packages/mcp/src packages/model/src packages/runtime-manager/src runtime/rust/src
```

Each match was traced to its caller and nearest regression test. A `readFile`
call was not classified by itself; the decision below considers the source of
the bytes, the guard that runs before loading them, the shape of the returned
data, and the observable failure mode.

## Findings

### Existing boundaries to preserve

| Boundary | Guard and output contract | Covering evidence | Decision |
| --- | --- | --- | --- |
| CLI config loading in `apps/cli/src/config.ts` (`loadConfig`) | `stat` rejects files above `1 MiB` before `readFileSync`; malformed or non-object JSON becomes an empty config. | `apps/cli/tests/config.test.ts` covers the `1 MiB` fixture and normal parsing. | `PRESERVE` |
| `config validate/show` in `apps/cli/src/config-command.ts` (`executeConfigCommand`) | `stat` rejects files above `1 MiB` before `readFile`; the response is a stable `config_read_error` without a path or raw bytes. | `apps/cli/tests/config-command.test.ts` covers the oversized file and redacted show output. | `PRESERVE` |
| CLI doctor config inspection in `apps/cli/src/doctor.ts` (`checkConfig`) | The same `1 MiB` pre-read check; diagnostics are metadata-only. | `apps/cli/tests/doctor.test.ts` covers the oversized config warning and path redaction. | `PRESERVE` |
| Workflow input files in `apps/cli/src/workflow-command.ts` | Plan and changes files are checked before reading with the fixed `16 MiB` workflow limit. JSON shape is checked after parsing. | `apps/cli/tests/workflow-command.test.ts` covers oversized plan and changes files for both `plan` and `apply`. | `PRESERVE` |
| Project initialization in `apps/cli/src/project-init.ts` | Existing `.gitignore` content is checked before reading with the fixed `16 MiB` limit; writes are append-only for the known suffix. | `apps/cli/tests/project-init.test.ts` covers the oversized `.gitignore` and no-change invariant. | `PRESERVE` |
| File-backed agent memory in `packages/agent-core/src/memory.ts` (`FileMemory`) | `stat` runs before every memory read; reads and serialized writes use the fixed `16 MiB` limit; malformed memory is rejected. | `packages/agent-core/tests/memory.test.ts` covers oversized reads, oversized writes, malformed data, and legacy files. | `PRESERVE` |
| Desktop JSON request bodies in `apps/desktop/src/server.ts` (`readJsonBody`) | Streaming body collection stops above the fixed `1 MiB` limit and destroys the request before parsing. | `apps/desktop/tests/server.test.ts` covers oversized `/api/chat`; edge tests cover related request validation. | `PRESERVE` |
| Desktop static files in `apps/desktop/src/server.ts` (`serveFile`) | `stat` and post-read byte checks enforce the fixed `1 MiB` response limit; public paths are resolved inside `public`. | `apps/desktop/tests/server-edge-cases.test.ts` covers oversized readable and unreadable files plus traversal containment. | `PRESERVE` |
| Desktop history, export, and evidence responses in `apps/desktop/src/server.ts` | File-backed history is bounded by `FileMemory`; serialized history/export and evidence projections have response/audit limits and metadata-only DTOs. | `apps/desktop/tests/multi-session.test.ts` and `apps/desktop/tests/server-edge-cases.test.ts` cover history/export over-limit behavior, filters, and metadata-only output. | `PRESERVE` |
| Desktop session discovery in `apps/desktop/src/server.ts` (`listSessions`) | `opendir` is consumed incrementally; candidate filenames and final summaries stay within the fixed `256` session cap; corrupt/missing files are tolerated. | `apps/desktop/tests/server-edge-cases.test.ts` covers more than 256 files, deterministic selection, duplicate known sessions, and corrupt/missing files. | `PRESERVE` |
| MCP server input and normal responses in `packages/mcp/src/server.ts` | Newline-delimited frames are checked in UTF-8 bytes before JSON parsing; normal serialized responses are checked before writing. Default frame size is `8 MiB`. | `packages/mcp/tests/mcp-frame-limits.test.ts` covers unterminated input, oversized incoming frames, and oversized outgoing frames. | `PRESERVE` |
| MCP resource reads in `packages/mcp/src/server.ts` and the built-in workspace resource in `apps/cli/src/index.ts` | Resource readers receive the configured frame budget; workspace enumeration stops before the next line exceeds it; returned text is checked before response serialization. | `packages/mcp/tests/mcp-server.test.ts` covers bounded resource context, UTF-8 budgets, and frame errors; `apps/cli/tests/mcp-resource-tool.test.ts` covers the CLI resource surface. | `PRESERVE` |
| MCP client input/output in `packages/mcp/src/stdio-client.ts` | Incoming partial frames accumulate only to `maxFrameBytes`; outgoing frames are checked before writing; child cleanup follows protocol failure. | `packages/mcp/tests/mcp-frame-limits.test.ts` covers incoming and outgoing client frame limits. | `PRESERVE` |
| Provider success and error responses in `packages/model/src/json-response.ts` and `packages/model/src/retry.ts` | Success bodies are streamed into a fixed `16 MiB` buffer; error bodies are streamed into a fixed `16 KiB` buffer and summarized. | `packages/model/tests/provider.test.ts` covers oversized success bodies; `packages/model/tests/retry.test.ts` covers oversized error bodies. | `PRESERVE` |
| Provider streaming line buffers in `packages/model/src/line-reader.ts` and provider implementations | Each incomplete SSE/NDJSON line is capped at `1 MiB`; the reader is cancelled before the line buffer grows further. | `packages/model/tests/streaming.test.ts` covers the line limit for OpenAI, Anthropic, Gemini, and Ollama. | `PRESERVE` for the line-level contract |
| Runtime manifest/archive download in `packages/runtime-manager/src/manager.ts` | Manifest and archive downloads are streamed and bounded before staging; archive size must match the manifest; extraction has a `32 MiB` decompressed limit. | `packages/runtime-manager/tests/runtime-manager.test.ts` covers oversized streamed downloads, size/checksum mismatches, and gzip bombs. | `PRESERVE` |
| Runtime completion metadata in `packages/runtime-manager/src/manager.ts` | `lstat` checks the install metadata and `.complete` marker before either file is read; corrupt status is generic and metadata-only. | `packages/runtime-manager/tests/runtime-manager.test.ts` covers oversized metadata/marker files and corrupt status behavior. | `PRESERVE` |
| Rust protobuf transport in `runtime/rust/src/stdio_transport.rs` | The four-byte length is checked before allocation; emitted protobuf responses are encoded and checked before writing. Default frame size is `8 MiB`. | In-module transport tests cover truncated prefixes, oversized reads, and oversized writes. | `PRESERVE` |
| Rust local executor output in `runtime/rust/src/local_executor.rs` | Child stdout/stderr are read through `read_capped`; default output is `1,000,000` bytes unless a smaller/larger request limit is selected, and truncation is reported. | In-module local-executor tests cover default and configured output limits, exact-limit output, cancellation, and truncation. | `PRESERVE` |
| Rust sandbox resource limits in `runtime/rust/src/restricted_executor.rs` | CPU, file size, open files, and process count limits are applied to restricted child processes; policy evaluation has fixed tick and heap limits. | In-module sandbox tests cover policy behavior and resource limits. | `PRESERVE` |

### Boundaries requiring a follow-up decision

| Boundary | Current guard | Covering evidence | Decision |
| --- | --- | --- | --- |
| Total provider stream accumulation in `packages/model/src/openai.ts`, `anthropic.ts`, `gemini.ts`, and `ollama.ts` | All four providers share a `16 MiB` UTF-8 cumulative budget across text, reasoning, and accumulated tool-call fragments. The reader is cancelled before the next append exceeds the limit and `StreamOutputLimitError` exposes stable metadata. | `packages/model/tests/stream-budget.test.ts`, `packages/model/tests/streaming.test.ts`, and the Agent Core regression suite cover byte accounting, cancellation, provider parsing, and normal completion. | `RESOLVED 2026-09-20`: provider-layer transport guard is separate from Agent `maxOutputChars`. |
| Code-search traversal and write-back in `packages/tools/src/code-search.ts` and `apps/cli/src/index-command.ts` | Async directory iteration enforces `100,000` eligible files and `256 MiB` eligible source bytes. Limit failures install no partial result; serialized write-back over `16 MiB` leaves the previous valid index untouched. Source symlinks are skipped and CLI output ordering remains deterministic. | `packages/tools/tests/code-search-cache.test.ts`, `packages/tools/tests/code-search-persisted.test.ts`, and `apps/cli/tests/index-command.test.ts` cover limits, preservation, symlink isolation, ordering, incremental refresh, and corruption recovery. | `RESOLVED 2026-09-20`: fixed project-size contract is now explicit and non-configurable in public tool input. |
| Rollback directory inspection in `packages/tools/src/filesystem.ts` (`preflightRollback`) | `opendir()` async iteration stops at the first unexpected entry instead of materializing a complete directory listing. The existing postimage conflict message and rollback ordering remain unchanged. | `packages/tools/tests/filesystem-changeset.test.ts` proves injected iterator early exit, directory-handle cleanup, rejection, and preservation of the unexpected file. | `RESOLVED 2026-09-20`: early-exit inspection preserves the no-surprise rollback invariant. |
| CLI approval input in `apps/cli/src/index.ts` (`readLineFromStdin`) | Input before the first newline is capped at `4 KiB` of UTF-8 bytes. Overflow resolves as an empty answer, removes listeners, pauses stdin, and destroys only non-TTY input so a one-shot producer without EOF cannot hang. | `apps/cli/tests/approval.test.ts` covers deny/allow, split UTF-8, exact `4 KiB`, `4 KiB + 1`, no-EOF overflow, newline, and EOF behavior. | `RESOLVED 2026-09-20`: overflow is a fail-closed denial; a deliberately open non-TTY stream after a normal newline remains a compatibility observation because destroying it would break multiple piped approvals. |

### Reproducible gaps for a separate fix task

These are not silently classified as preserved. They have a concrete unbounded or
incompatible behavior and should become a separate RED/GREEN task before the
next release gate.

| Boundary | Defect | Why it is reproducible | Decision |
| --- | --- | --- | --- |
| `apps/cli/src/index.ts` (`listSessions`) | `readdir()` materializes every session filename and then reads metadata for every matching file. Unlike Desktop, the CLI has no candidate or output cap. | A session directory containing thousands of `.json` entries makes `--session-list --json` scale with all entries and emit all metadata. No test asserts a CLI cap. | `FIX` |
| `apps/cli/src/doctor.ts` (`probeRustBinary`) | Rust probe stdout and stderr are concatenated until the child exits. The first four bytes are trusted only after the entire stdout stream has already been buffered. | Point `--check-rust` at an executable that writes more than the transport limit and stays alive briefly; the parent keeps accumulating output instead of rejecting and terminating at the limit. | `FIX` |
| `apps/cli/src/doctor.ts` (`defaultCommandVersion`) | External `--version` output is accumulated without a byte limit. | A command earlier on `PATH` that prints an unbounded stream makes the doctor retain it until process exit. | `FIX` |
| `packages/mcp/src/server.ts` (`handleMessage` error paths) | Tool failures and unexpected errors are converted to JSON-RPC error strings without applying `maxFrameBytes`. Normal results are checked, but a large thrown `Error.message` can produce an oversized response. | A tool that throws `new Error("x".repeat(...))` makes `handleMessage()` return a response larger than the configured frame limit; `start()` then fails at the final assertion instead of returning a bounded protocol error. | `FIX` |
| `packages/tools/src/filesystem.ts` (`write`, `prepareMutation`) | The tool validates that content is a string but does not enforce a maximum byte size for new write content or the computed postimage. Existing-file reads are capped, but direct/in-process callers can supply a larger postimage. | Calling `FilesystemTool.execute({ action: "write", ... content: "x".repeat(...) })` writes the full payload; preview/edit/patch can also build an oversized `afterBytes` before apply. The default MCP frame limit only bounds one transport, not the tool API itself. | `FIX` |

## Decision List

| Exact path and boundary | Disposition | Reproduction or preservation reason |
| --- | --- | --- |
| `apps/cli/src/config.ts:loadConfig` | `PRESERVE` | `apps/cli/tests/config.test.ts` proves the `1 MiB` pre-read check and unchanged fallback behavior. |
| `apps/cli/src/config-command.ts:executeConfigCommand` | `PRESERVE` | `apps/cli/tests/config-command.test.ts` proves oversized files return `config_read_error` without reading or echoing the path. |
| `apps/cli/src/workflow-command.ts:readChanges` and `executeApply` | `PRESERVE` | `apps/cli/tests/workflow-command.test.ts` proves the fixed `16 MiB` boundary for both workflow input files. |
| `packages/agent-core/src/memory.ts:FileMemory` | `PRESERVE` | `packages/agent-core/tests/memory.test.ts` proves fixed read/write limits and no replacement on rejected writes. |
| `apps/desktop/src/server.ts:readJsonBody`, `serveFile`, `listSessions` | `PRESERVE` | Desktop has pre-read request/static limits and a bounded streamed session candidate set; the edge-case suite covers each contract. |
| `packages/mcp/src/server.ts` frame input and resource read | `PRESERVE` for normal input/resources | Frame-limit and resource tests prove byte checks before parsing/serialization. The separate thrown-error path remains a `FIX`. |
| `packages/model/src/json-response.ts`, `retry.ts`, `line-reader.ts` | `PRESERVE` for success/error bodies and per-line streams | Provider, retry, and streaming tests prove the fixed `16 MiB`, `16 KiB`, and `1 MiB` boundaries. Total stream accumulation remains `NEEDS-EVIDENCE`. |
| `packages/runtime-manager/src/manager.ts` and `archive.ts` | `PRESERVE` | Runtime tests prove bounded downloads, bounded completion metadata, bounded decompression, checksums, and cleanup. |
| `runtime/rust/src/stdio_transport.rs` and `local_executor.rs` | `PRESERVE` | In-module tests prove frame allocation and child output are capped before the returned result grows. |
| `apps/cli/src/index.ts:listSessions` | `FIX` | Reproduce with `DEV_AGENT_SESSION_DIR=<dir> node apps/cli/dist/index.js --session-list --json` after creating thousands of `<id>.json` files in `<dir>`. The command currently enumerates and emits all of them. |
| `apps/cli/src/doctor.ts:probeRustBinary` | `FIX` | Reproduce with `node apps/cli/dist/index.js --check-rust <executable-that-writes-more-than-8MiB>`. The parent currently buffers stdout/stderr until child exit. |
| `apps/cli/src/doctor.ts:defaultCommandVersion` | `FIX` | Reproduce by placing an executable that prints an unbounded stream before `rg` or `protoc` on `PATH`, then run `node apps/cli/dist/index.js --doctor`. |
| `packages/mcp/src/server.ts:handleMessage` unexpected/tool-error branches | `FIX` | Reproduce with a server tool that throws a message larger than `maxFrameBytes`, then call `handleMessage()` with `tools/call`; the returned JSON currently exceeds the configured frame limit. |
| `packages/tools/src/filesystem.ts:write` and `prepareMutation` | `FIX` | Reproduce with `pnpm --filter @dev-agent/tools run build` followed by an in-process `FilesystemTool.execute()` call whose `content` is larger than `16 MiB`; the payload is currently accepted. |
| `packages/model/src/*` total stream accumulation | `RESOLVED` | Shared `16 MiB` cumulative provider budget with cancellation; model 72/72 and Agent Core 134/134 focused evidence. |
| `packages/tools/src/code-search.ts` traversal/write-back | `RESOLVED` | `100,000` files, `256 MiB` source bytes, `16 MiB` persisted write boundary, and no-partial-index preservation tests. |
| `packages/tools/src/filesystem.ts:preflightRollback` | `RESOLVED` | Early-exit `opendir()` inspection with injected iterator proof and unchanged rollback conflict semantics. |
| `apps/cli/src/index.ts:readLineFromStdin` | `RESOLVED` | `4 KiB` UTF-8 fail-closed overflow handling with exact-boundary, split-character, and no-EOF tests. |

## Verification Plan

The focused suites that cover the preserved boundaries are:

```sh
pnpm --filter @agent_cli/cli run test
pnpm --filter @dev-agent/desktop run test
pnpm --filter @dev-agent/agent-core run test
pnpm --filter @dev-agent/tools run test
pnpm --filter @dev-agent/mcp run test
pnpm --filter @dev-agent/model run test
pnpm --filter @dev-agent/runtime-manager run test
cargo test --manifest-path runtime/rust/Cargo.toml
node --test tests/documentation-contract.test.mjs
```

At audit time, the five `FIX` rows were intentionally left as explicit
follow-up work. The follow-up implementation and verification are recorded in
`docs/superpowers/plans/2026-09-20-eight-hour-hardening.md`:

| Finding | Implemented boundary | Focused evidence |
| --- | --- | --- |
| CLI session listing | `opendir()` enumeration, newest-256 candidate cap, `sessions/truncated/total` JSON envelope | `apps/cli/tests/session-list.test.ts`, `apps/cli/tests/json-output.test.ts`, `apps/cli/tests/session-dir.test.ts` |
| Doctor command versions | `64 KiB` stdout cap with child termination and bounded stderr draining | `apps/cli/tests/doctor.test.ts` |
| Rust doctor probe | `8 MiB` declared/received frame cap and `16 KiB` stderr cap | `apps/cli/tests/rust-health-check.test.ts` |
| MCP error responses | bounded JSON-RPC error fallback under the configured frame budget | `packages/mcp/tests/mcp-server.test.ts`, `packages/mcp/tests/mcp-frame-limits.test.ts` |
| Filesystem writes/postimages | `16 MiB` UTF-8 postimage guard before write, diff creation, or direct edit/patch | `packages/tools/tests/tools-edge-cases.test.ts`, `packages/tools/tests/filesystem-preview.test.ts` |

The four former `NEEDS-EVIDENCE` rows were resolved by the 2026-09-20
input-boundary closure plan. The normal-newline/open-non-TTY observation in the
approval row remains a documented compatibility tradeoff, not an unresolved
overflow boundary.
