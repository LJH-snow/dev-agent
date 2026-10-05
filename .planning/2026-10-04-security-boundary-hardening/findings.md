# Mimosa finding dispositions

Source scan: `scan-2026-10-04T08-40-18.059Z-c1111d24e45a` (static-only; verdict effect `none`). These are provisional dispositions pending focused tests and the rescan.

## Rescan after fixes

- Rescan: `scan-2026-10-04T15-10-19.578Z-ccca1440752d`, seal `sha256:c0a885e8d90a0dcb78cdf7f1270854a8b8b5dcc21e4d3ce28bd718ee976ae285`, depth deep, dependencies 198 scanned / 0 advisories.
- Findings: 21 (baseline 22). No new findings were introduced by this round's changes; every remaining occurrence maps onto a disposition row below. The rust-executor occurrence moved `:358` → `:354` purely from line shifts.
- The scan remains `static_only_no_runtime_execution` with partial call-graph coverage and verdict effect `none`: this ledger records triage and hardening evidence, not a runtime security proof.

## Rescan after audit-history and runtime-default slices (2026-10-05)

- Rescan: `scan-2026-10-05T05-28-39.340Z-21118f7e6330`, seal
  `sha256:7df8618a1d950bcdeec417fc486b00a7bd92c2bf209871cd2bc0da02fa84630b`,
  depth deep, dependencies 198 scanned / 0 advisories / 0 unknown,
  evidence boundary `static_only_no_runtime_execution`, verdict effect `none`.
- Findings: 21 — identical count to the 2026-10-04 rescan. The new
  `apps/cli/src/security-audit-history.ts`, `apps/cli/src/runtime-command.ts`
  change, and the `securityCommandMessage`/`securityAuditHistory` additions in
  `apps/cli/src/index.ts` introduced no findings.
- Location mapping (old → new, line shifts only from the index.ts additions):
  `checkRust`/`runDoctor` 1550/1591 → 1559/1600; `probeRustBinary` 3327 → 3340;
  `parseSessionResumeCommand` 3962 → 3997; `backgroundJobCommandMessage` /
  `sessionPickerLookup` 4727/4748 → 4762/4783 and 6554/6410 → 6589/6445.
  All Desktop `server.ts`, `rust-executor.ts:354`, and `mcp/server.ts:218`
  occurrences are unchanged and remain covered by the disposition rows above.
- Still not claimed: this scan is static-only triage evidence, not a runtime
  security proof; managed-cache TOCTOU and same-UID planted-state residuals
  remain recorded as out of scope.

## Rescan after the Desktop Security Center round (2026-10-05)

- Rescan: `scan-2026-10-05T06-12-58.118Z-a18c6e27a77f`, seal
  `sha256:f68404a864036a8f6c23fbc8d27cd045b82329f30662c8e6f54cbfec7d8c77b5`,
  depth deep, dependencies 198 scanned / 0 advisories / 0 unknown,
  evidence boundary `static_only_no_runtime_execution`, verdict effect `none`.
- Findings: 21 — identical count to both previous scans. The new
  `packages/agent-core/src/security-scan.ts`,
  `packages/agent-core/src/security-audit-history.ts`,
  `apps/desktop/src/security-center.ts`,
  `apps/desktop/public/security-center.js`, and the Desktop route additions
  introduced zero findings. Desktop `server.ts` occurrences only shifted
  lines (1196→1217, 1356→1463, 1378/1553 terminal block, 1430→1537,
  1485→1592, 1660→1767, 1808→1915, 3386→3493) from the inserted routes and
  remain covered by the disposition rows above.
- New gated surface evidence: both `/api/security-center` and
  `/api/security-scan` are in the trusted-loopback metadata gate; the scan
  POST is additionally capability-token gated (tested); unknown sessions fail
  closed with 404; the scan itself is read-only with file/byte caps and never
  executes anything.
- Still not claimed: static-only triage evidence, not a runtime security
  proof; managed-cache TOCTOU and same-UID planted-state residuals remain out
  of scope.

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

> 2026-10-05 update: the manager-to-spawn TOCTOU window was narrowed (not
> eliminated) by `RustExecutor.verifyBeforeSpawn`, which re-runs the full
> managed-runtime inspection (private modes, size, checksum) immediately
> before the process is created; see
> `.planning/2026-10-05-runtime-toctou-narrowing/progress.md`. Same-UID
> planted state that rewrites cache content and metadata consistently, and
> root attackers, remain out of scope.
