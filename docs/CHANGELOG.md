# Changelog

## 2026-09-10 (CI + build hardening)

### Continuous integration (`.github/workflows/ci.yml`)
- Added a GitHub Actions workflow that runs on push to `main`, pull requests, and
  manual dispatch:
  - TypeScript job (ubuntu, Node 26 via `.nvmrc`, pnpm 12.3.4): `pnpm install
    --frozen-lockfile` -> structure check -> build -> typecheck -> test.
  - Rust job (ubuntu, stable toolchain): `cargo fmt --check`, `cargo clippy
    --all-targets -- -D warnings`, `cargo test`.
- Validated the workflow with `actionlint`.
- Added `.nvmrc` pinning Node 26 and a CI status badge in the root README.

### Fixed: root `clean` script caused infinite recursion
- `pnpm clean` is a **built-in pnpm command** (it removes `node_modules`
  directories) and a same-named script in `package.json` overrides it. The root
  `"clean": "pnpm -r clean"` therefore re-entered the root script recursively,
  spawning processes until it was interrupted instead of removing `dist`.
- Root delegating scripts now use the explicit `run` verb
  (`pnpm -r run build|typecheck|test|clean`), which avoids built-in collisions and
  correctly skips the workspace root. Added a root `test` script.

### Build ordering
- Documented and wired the required order on a fresh checkout: `build` before
  `typecheck`/`test`, because workspace packages resolve each other through
  `dist/*.d.ts`, which only exist after a build.

### Rust lint gates
- `cargo fmt --check` is now clean.
- Resolved all `cargo clippy --all-targets -- -D warnings` findings: gated the
  Linux-only `ro_bind_if_exists`/`build_bwrap_args` helpers with
  `#[cfg(any(target_os = "linux", test))]`, switched to `std::io::Error::other`,
  and moved `impl Default for SandboxExecutor` before the test module.

## 2026-09-10 (Night Build v4)

### Network policy enforcement via Starlark (`runtime/rust`)
- Fixed a bug where `ctx.network_policy` exposed the Rust enum Debug output
  (e.g. `"NetworkDisabled"`) instead of the documented lowercase labels
  (`"enabled"`, `"disabled"`, `"loopback"`, `"unspecified"`). This silently broke
  the example policy's `check_network_policy` function. Added a
  `network_policy_label` helper that maps the prost-generated enum to the
  documented lowercase contract.
- Added Starlark-level unit tests for network policy decisions: the policy script
  can now deny network commands (e.g. `curl`, `wget`) when `network_policy ==
  "disabled"` and allow them when `"enabled"`, and the example policy's
  `check_network_policy` function is verified end to end.
- Rust tests: 31 → 35 passing (+4 network policy tests).

### Documentation
- Updated root `README.md` Roadmap to mark items 5–8 as done, consolidated the
  stale "Current Status (v2)" section, and refreshed the Rust runtime progress
  section to reflect the active Linux `bwrap` backend and Starlark network policy.
- Updated `docs/README.md` to reflect the implemented desktop shell, Linux `bwrap`
  backend, and Starlark `ctx.network_policy` contract.

## 2026-09-10 (Night Build v3)

### Desktop shell (`apps/desktop`)
- New `@dev-agent/desktop` package: a local web server with a streaming chat UI.
- `src/server.ts` serves a static HTML chat UI and streams chat responses from
  `POST /api/chat` as Server-Sent Events (`token`, `tool`, `tool-result`, `turn`, `done`, `error`).
- `src/chat-session.ts` builds the `AgentLoop` with the default tools and model
  provider, and bridges its streaming callbacks to SSE events. Reuses
  `@dev-agent/agent-core`, `@dev-agent/model`, `@dev-agent/tools`, `@dev-agent/mcp`,
  and `@dev-agent/executor`.
- Single-page dark/light chat UI in `public/index.html` (vanilla JS, no build step).
- Configurable via env vars (`DEV_AGENT_MODEL_PROVIDER`, `DEV_AGENT_DESKTOP_HOST`,
  `DEV_AGENT_DESKTOP_PORT`, `DEV_AGENT_MEMORY_FILE`). Health check at `GET /health`.
- New HTTP-level tests covering the UI, health, chat SSE stream, and 404 handling.

### CLI streaming and session management hardening
- Agent loop now wires `onToken`, `onToolCall`, `onToolResult` callbacks so tokens
  print live and tool activity is shown with color in interactive and `--once` modes.
- New `--no-stream` flag disables live token output (falls back to printing the final answer).
- New `--session-list` command enumerates saved sessions sorted by recency, showing
  file size and last-modified time. Honors `DEV_AGENT_SESSION_DIR` for the sessions directory.
- New E2E tests for `--session-list` (empty and populated) and `--no-stream`.

### Linux bubblewrap backend (`runtime/rust`)
- `RestrictedExecutor` now has a real `#[cfg(target_os = "linux")]` execution path
  using `bwrap` (bubblewrap) instead of returning `Unsupported`.
- `build_bwrap_args` is a pure function (testable on any host) that constructs the
  bubblewrap argument list: namespace unsharing (`--unshare-user-try`, `--unshare-ipc`,
  `--unshare-pid`, `--unshare-uts`, `--unshare-cgroup-try`), read-only root filesystem
  with per-distro path detection, writable/read-only path bind mounts, network policy
  (`--unshare-net` for disabled/loopback), environment injection (`--setenv`), cwd
  enforcement (`--chdir`), and `--die-with-parent`.
- Resource limits (`setrlimit`) now shared across macOS and Linux backends
  (CPU, FSIZE, NOFILE, NPROC, CORE).
- Linux-only live `bwrap` integration test (skipped when `bwrap` is not installed).
- New unit tests for the argument builder: namespace flags, network policy toggling,
  writable/readonly binds, environment variables.

## 2026-09-10 (Night Build v2)
