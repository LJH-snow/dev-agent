# Rust Runtime

Rust side of dev-agent's low-level runtime boundary. The current crate provides
a working stdio executor binary that is consumed by the TypeScript `RustExecutor`
through a stable protobuf protocol. Restricted execution is active on macOS via
`sandbox-exec`; Linux backend support is planned next.

The TypeScript side defines `SandboxProfile` and `SandboxExecutor` in
`@dev-agent/executor`. The Rust runtime implements the actual sandbox back end
for those contracts on macOS.

Current capabilities (macOS):

- Sandboxed command execution
- Process management and isolation
- Filesystem security and permission enforcement
- Explicit network policy, read-only paths, writable paths, and per-command
  timeouts
- CPU, file-size, open-file, process-count, and core-dump resource limits

The stdio execution boundary is active, and macOS `sandbox-exec` currently
enforces the profile. Linux bubblewrap/seccomp support is the next backend.

## Policy Language: Starlark

When the Rust runtime implements sandbox and filesystem policies, it will use
**Starlark** as the policy configuration language. This follows the same
approach as the open-source Codex agent, which uses Starlark to express sandbox
rules (writable paths, network access, filesystem permissions) in a
deterministic, sandboxable, and auditable form.

In practice this means:

- Sandbox profiles (`SandboxProfile`) and filesystem/network policy rules are
  authored as Starlark scripts, not raw JSON or ad-hoc DSLs.
- The Rust runtime embeds a Starlark interpreter (via the `starlark` crate) to
  evaluate these policy scripts at runtime.
- TypeScript side sends a Starlark policy expression; Rust evaluates it inside
  the interpreter sandbox and applies the resulting allow/deny decisions to the
  command being executed.
- Starlark's deterministic execution and lack of I/O escape hatches make it
  safe to evaluate untrusted or model-generated policy snippets.

This keeps the policy surface human-readable, testable, and consistent with how
production coding agents govern tool execution.

## Building

Prerequisites:

- Rust toolchain (rustc, cargo). Install via [rustup](https://rustup.rs).
- The `protobufjs` npm package on the TypeScript side (already a dependency of
  `@dev-agent/executor`).

Build the crate:

```bash
cd runtime/rust
cargo build
```

This produces both the library (`libdev_agent_runtime`) and the
`dev-agent-executor` binary used by `RustExecutor` on the TypeScript side.

Run tests:

```bash
cargo test
```

## Status

The crate builds with the current Rust toolchain and `cargo test` passes for
`LocalExecutor`, `SandboxExecutor`, and `stdio_transport`. `dev-agent-executor`
accepts length-prefixed `Envelope` messages on stdin and writes `Response`
messages on stdout.

The TS side is wired end to end:

- `RustExecutor` in `@dev-agent/executor` spawns `dev-agent-executor` and
  supports `run` / `runSandboxed` over protobuf stdio.
- `apps/cli --check-rust <path>` sends a health check and decodes
  `HealthCheckResult` from the outer `Response` protobuf message.
- The real binary has passed a CLI smoke check reporting runtime version
  `0.1.0` and capabilities `run`, `run_sandboxed`.
- `SandboxExecutor::evaluate_policy` evaluates Starlark with the `starlark`
  crate, binds `ctx` to the policy script, supports direct booleans or a
  `policy(ctx)` function, and returns `Allow` / `Deny`. The real binary's
  `runSandboxed` path routes through this evaluator.
- Policy evaluation is guarded by tick and heap limits, and sandbox tests cover
 both allow and deny decisions through `RustExecutor`.
 - Linux placeholder improved: `RestrictedExecutor` now detects `bwrap`
   availability and returns a clearer unsupported message distinguishing
   "bwrap installed but backend not wired in" from "bwrap not installed".
- `SandboxExecutor` no longer passes through to `LocalExecutor`: after Starlark
  returns `Allow`, `runSandboxed` executes through `sandbox-exec` with writable
  path, read-only path, network policy, cwd, timeout, and resource constraints.
- Real-binary integration tests cover Starlark deny, read-only write rejection,
  disabled network, allowed writes, profile timeout, and resource limits.
