# Mimosa finding dispositions

Source scan: `scan-2026-10-04T08-40-18.059Z-c1111d24e45a` (static-only; verdict effect `none`). These are provisional dispositions pending focused tests and the rescan.

## Rescan after fixes

- Rescan: `scan-2026-10-04T15-10-19.578Z-ccca1440752d`, seal `sha256:c0a885e8d90a0dcb78cdf7f1270854a8b8b5dcc21e4d3ce28bd718ee976ae285`, depth deep, dependencies 198 scanned / 0 advisories.
- Findings: 21 (baseline 22). No new findings were introduced by this round's changes; every remaining occurrence maps onto a disposition row below. The rust-executor occurrence moved `:358` → `:354` purely from line shifts.
- The scan remains `static_only_no_runtime_execution` with partial call-graph coverage and verdict effect `none`: this ledger records triage and hardening evidence, not a runtime security proof.

| Finding/location | Provisional disposition | Evidence / follow-up |
|---|---|---|
| `apps/desktop/src/task-terminal.ts:189` | Fixed for executable-selection risk; capability remains intentional | `resolveTrustedTerminalShell()` now canonicalizes against fixed system shells, rejects temporary/non-regular/non-executable candidates, and `spawn()` explicitly uses `shell: false`. Focused terminal regression is GREEN. Terminal command text remains an intentional task-worktree shell capability. |
| `apps/cli/src/index.ts:1550`, `3327`; `apps/cli/src/index.ts:1591` | Caller-trusted custom runtime boundary, plus probe reliability gap | `--rust-executor`/`DEV_AGENT_RUST_BINARY` intentionally select a custom executable; no shell interpolation. Add regular-file/executable preflight and bounded probe timeout; retain explicit provenance limitation. |
| `apps/cli/src/index.ts:3962`, `4727`, `4748`, `6410`, `6554` | Static false positive | UI command parsers/lookup helpers do not reach an OS process sink. |
| `apps/desktop/src/server.ts:1196` | Static false positive | Fixed in-memory comparator, not a Mongo query. |
| `apps/desktop/src/server.ts:1378`, `1553` | Accepted terminal/validation capability boundary pending regression | Commands are intentionally executed in canonical task workspaces behind loopback/origin and launcher capability-token gates. |
| `apps/desktop/src/server.ts:3386` command/SQL occurrences | Static false positive or capability-boundary advisory | `session.run()` reaches approval/sandbox/tool/executor code, not SQL; command and args remain separate. Add deny/no-executor regression. |
| `packages/executor/src/rust-executor.ts:358` | Hardened; custom-runtime trust retained | `spawn(binaryPath)` uses no shell and `command`/`args` stay protobuf-separated. New preflight refuses missing/directory/non-regular paths (plus Unix exec-bit) with clear errors. Explicit custom paths remain caller-trusted by contract; static finding is a trust-boundary note, not command injection. Executor suite 12/12. |
| `apps/cli/src/doctor.ts` `probeRustBinary` | Fixed reliability gap | Probe now has a fixed 5s deadline that kills a wedged runtime and rejects exactly once (RED evidence: old probe hung the test process forever). CLI health-check suite 7/7. |
| `packages/mcp/src/server.ts:218` | Dispatch-only sink; authorization is host wiring (evidence recorded) | Generic dispatch has no policy context by design. Evidence chain: `packages/agent-core/tests/approval.test.ts` (deny → 0 executor runs; policy throw → denial; bounded `[denied by policy]` result), `apps/cli/tests/mcp-server.test.ts` (`--approval deny-dangerous gates MCP tool calls` — denied shell call never reaches disk; review-writes refuses unreviewed writes; allowlist honored; `allow` mode stays ungated as a trusted-caller compat choice), `packages/tools/tests/tools-edge-cases.test.ts` (sandbox profile → `runSandboxed` with separated command/args; missing enforcing executor fails closed). |
| `apps/desktop/src/server.ts:1356`, `1430`, `1485`, `1660`, `1808` | Provisional static false positives | Responses use JSON content types; verify endpoint tests/headers and no HTML rendering sink. |

Residual risks: static analysis does not prove runtime exploitability; managed cache existing-directory ownership/mode and manager-to-spawn TOCTOU remain out of scope for this minimal slice.
