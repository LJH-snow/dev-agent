# Progress

## 2026-10-04 — baseline

- Completed Mimosa deep scan: `scan-2026-10-04T08-40-18.059Z-c1111d24e45a`.
- Seal: `sha256:f82281cf8b68feabcf9deae32617d30934a1f7d417026e0d8e1801997972042d`.
- Findings: 22 occurrences (20 high, 2 medium); dependency advisories: 0; evidence boundary: `static_only_no_runtime_execution`; coverage: partial/inconclusive.
- Read-only triage confirms the highest-risk concrete boundary is Desktop terminal shell selection from `SHELL`/`ComSpec`.
- Normal Desktop launcher already starts the server with `requireCapabilityToken: true`; bare `createDesktopServer()` remains an embedding seam whose caller must opt into browser mutation protection.
- MCP/AgentLoop approval and sandbox wiring is present; missing evidence is a regression that a deny decision prevents executor reachability.
- Explicit `--rust-executor`/`DEV_AGENT_RUST_BINARY` paths are caller-trusted custom executables. Managed RuntimeManager paths have stronger cache/archive/hash/contract checks, with residual owner/mode and TOCTOU risks.
- No production security fix had been applied at baseline.

## 2026-10-04 — terminal shell boundary

- Added `resolveTrustedTerminalShell()` in `apps/desktop/src/task-terminal.ts`.
- Unix selection now accepts only canonical, regular, executable system shells from a fixed allowlist; untrusted or temporary `SHELL` values fall back to `/bin/sh`.
- Windows selection validates `ComSpec` against the canonical `System32/cmd.exe` location and falls back to that fixed path.
- Terminal `spawn()` now explicitly sets `shell: false` while preserving the intentional interactive `-lc`/`/c` command capability.
- RED regression `terminal ignores an untrusted SHELL executable` is GREEN; focused desktop compile and all 18 terminal tests pass.
- Residual boundary: terminal commands remain an intentional capability of the Desktop task worktree; this change protects executable selection, not the command text itself.

## 2026-10-04 — Rust runtime path preflight and probe deadline

- Added `assertSpawnableBinaryPath()` to `RustExecutor.start()` (`packages/executor/src/rust-executor.ts`): refuses missing paths, directories, and non-regular files before spawning; on Unix also refuses files without the executable bit. The explicit `--rust-executor`/`DEV_AGENT_RUST_BINARY` custom-runtime contract is unchanged — no owner/hash/allowlist constraint was added.
- RED evidence: both preflight regressions failed against the old `existsSync`-only check (spawn surfaced raw `EACCES`/spawn errors). After the fix: executor focused suite 12/12 GREEN.
- Added a fixed 5s deadline to `probeRustBinary()` (`apps/cli/src/doctor.ts`): a wedged runtime is killed and the probe rejects with `Rust executor health probe timed out`; a single settle guard prevents double resolution and the timer is unref'd.
- RED evidence was stronger than a failed assertion: the old probe hung the whole `node --test` process (the un-killed wedged child kept the event loop alive) instead of merely failing. After the fix, the wedged-probe regression completes at the 5s deadline and the focused CLI health-check suite is 7/7 GREEN.
- Residual: explicit custom runtime paths remain trusted at startup by design; managed-cache owner/mode and manager-to-spawn TOCTOU are recorded as out-of-scope residual risks.

## 2026-10-04 — full suite results

- `@dev-agent/executor` full suite: 59/59 pass.
- `@dev-agent/desktop` full suite: 445/445 pass (96.9s), including the new shell-selection and origin-variant regressions.
- `@agent_cli/cli` full suite: first run had one flaky assertion (`actual 1, expected 0` exit-code style failure under full-suite load, consistent with the documented cross-process PTY/load races); immediate rerun with unchanged code: 844/844 pass. No security boundary was relaxed and no timing constant was changed for this.
- MCP/AgentLoop approval evidence chain confirmed from existing regressions (deny → 0 executor runs at agent-core level; denied MCP shell call never reaches disk at CLI level; sandbox profile → `runSandboxed` with separated command/args); recorded in `findings.md` instead of duplicating tests.

## 2026-10-04 — Mimosa rescan and closure

- Rescan: `scan-2026-10-04T15-10-19.578Z-ccca1440752d`, seal `sha256:c0a885e8d90a0dcb78cdf7f1270854a8b8b5dcc21e4d3ce28bd718ee976ae285`.
- Findings 22 → 21; dependency advisories 0 (198 packages). No new findings; all remaining occurrences carry a disposition in `findings.md` (caller-trusted runtime boundaries, intentional terminal command capability behind loopback/token gates, and static false positives on parser/UI/JSON/SQL-shaped sinks).
- Status: this round's security triage and minimal hardening are complete. The scanner's evidence boundary is still `static_only_no_runtime_execution` with `inconclusive` run status — that is a statement about the scan, not a claim that the project is fully secure.
- Committed only this round's files: terminal shell resolver + tests, executor preflight + tests, doctor probe timeout + test, and this ledger.
- Post-commit audit: `scan-2026-10-04T15-13-52.808Z-6e6cfe5f36e7`, seal `sha256:74afa161b73fe7841a2c6d29c8ed8d0c6db4a905b6abb0970140d3e89e727ccf`. Same result as the pre-commit rescan (21 findings, 0 dependency advisories, no business-logic hypotheses), confirming commit `2a501fb` carries the audited content.
