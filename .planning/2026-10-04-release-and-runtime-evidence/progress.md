# Progress

## 2026-10-04 — setup

- Scope confirmed with the user: publish 0.2.1 first, then runtime evidence.
- 15 commits landed after `cd8ff68` (0.2.0 release, 2026-09-30 13:55); all are
  unpublished. Headline groups: CLI TUI hardening (mouse parser resync, editor
  mouse suspend, MCP/notice panel windows, Ctrl-R incremental search,
  persistent session-scoped prompt history), Desktop execution history +
  execution center, MCP notification isolation, CI verify gate, zh README,
  and the security boundary hardening round (2a501fb).
- npm identity: `libai168` (authenticated). Release governance followed:
  `docs/release-cli-npm.md`; preflight = `scripts/npm-release-preflight.mjs`.
- Rust runtime binaries exist at `runtime/rust/target/{debug,release}/dev-agent-executor`;
  integration suite uses the debug binary and macOS sandbox-exec backend.

## 2026-10-04 — release 0.2.1 published

- `docs/CHANGELOG.md` gained a 0.2.1 entry covering the 15 post-0.2.0 commits;
  `apps/cli/package.json` bumped to 0.2.1; `docs/release-state.json` moved to
  candidate then published.
- `pnpm release:preflight` passed (candidate 0.2.1 > registry 0.2.0, auth ok,
  5-file artifact allowlist).
- The gated `pnpm release:publish` wrapper failed with `publish_failed`: npm
  now requires web-based 2FA (EOTP) which `execFile` cannot complete. The user
  approved the browser flow; a pty-wrapped `npm publish --access public`
  printed the auth URL, the user authenticated, and npm accepted the tarball
  (shasum `e6bacff4fd044b2680d5d517476b1eddd2c87d77`).
- Registry propagation delay observed (E404 twice) as documented for earlier
  releases; final verification: `npm view @agent_cli/cli@0.2.1 version` =
  `0.2.1`, `dist-tags.latest` = `0.2.1`.
- No Git tag or GitHub Release created (project convention: separate
  authorization).

## 2026-10-04 — runtime evidence and cache ownership hardening

- Real Rust sandbox integration suite (`pnpm --filter @dev-agent/executor
  test:integration`) ran against the locally built `dev-agent-executor` debug
  binary with the macOS `sandbox-exec` backend: 11/11 pass. This closes part
  of the static-only evidence gap from the 2026-10-04 hardening round:
  Starlark policy enforcement, readonly-path rejection, network disable and
  loopback allowance, profile timeout, resource limits, output truncation,
  abort refusal, cancellation, and the runtime's own concurrency limit are now
  verified against the real runtime, not mocks.
- `--check-rust` on the same binary reports runtime version `0.2.0` with
  `run, run_sandboxed, cancel` capabilities, matching the CLI health contract.
- Managed cache ownership gate (the deferred residual): new POSIX
  `isPrivatelyOwned()` predicate exported from `@dev-agent/runtime-manager`;
  `ensurePrivateDirectory()` now fails installation and `inspect()` now marks
  status corrupt when the cache root/version/target directory is owned by
  another user or is group/world writable. This blocks another local user from
  pre-planting or tampering with a version directory that would otherwise pass
  its metadata/hash consistency checks. Windows remains a no-op (no uid
  model); explicit custom `--rust-executor` paths are untouched.
- RED evidence: three new regressions failed before the fix (writable root
  install succeeded, tampered version dir reported installed, predicate
  missing). After the fix: runtime-manager suite 26/26, desktop suite 445/445.
- Residual: root-level attackers and pre-existing same-uid planted state are
  out of scope; TOCTOU between inspect and spawn is narrowed by the ownership
  gate but not eliminated (documented, not claimed solved).

## 2026-10-04 — CLI flake identified and stabilized

- The full CLI suite failed once more, this time with a named test:
  `interactive CLI exposes answer, stage, and total timings in a
  metadata-only trace` hit its 4s `waitFor` under full-suite load (the
  `:trace` round-trip crosses two processes).
- Fix follows the documented `validation.test.ts` precedent: only that test
  carries a local timing allowance (`waitForReady` gained an optional timeout
  parameter, default unchanged; this test uses 20s waits). No assertion was
  relaxed and no production code changed.
- Final full-suite results for this round: runtime-manager 26/26, desktop
  445/445, CLI 844/844, real Rust sandbox integration 11/11.