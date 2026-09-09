# @dev-agent/executor

Unified executor abstraction for dev-agent.

Implemented in phase 1:

- `Executor`, `ExecutorResult`, and `ExecutorRunOptions` types for a stable
  command execution contract.
- `LocalExecutor` using Node's `child_process`. It supports `cwd`, `env`, stdin
  `input`, and `timeoutMs`, and returns `stdout`, `stderr`, `exitCode`, and an
  optional `timedOut` flag.
- `SandboxProfile` and `SandboxExecutor` types as the contract for the Rust-backed
  sandbox runtime; the macOS backend is active via `sandbox-exec`.

Typical usage:

```ts
import { LocalExecutor } from "@dev-agent/executor";

const executor = new LocalExecutor();
const result = await executor.run("node", ["-e", "console.log(process.cwd())"], {
  cwd: process.cwd(),
  env: { DEV_AGENT_TEST: "1" },
  timeoutMs: 5000,
});
```

## Rust runtime boundary

The Rust runtime lives in `runtime/rust` and communicates with TypeScript over
**length-prefixed protobuf on stdio**. The protocol is defined in
`runtime/rust/proto/executor.proto`:

- TypeScript sends `Envelope` messages (either `RunRequest` or
  `RunSandboxedRequest`).
- Rust responds with `Response` messages (`RunResult`, `HealthCheckResult`, or
  `ErrorResult`).
- Each message is framed as a 4-byte big-endian length prefix followed by the
  protobuf payload.

`RustExecutor` in `src/rust-executor.ts` implements this boundary on the
TypeScript side: it spawns the Rust binary, encodes requests, decodes responses,
and implements both `Executor` and `SandboxExecutor`. It reuses the same
`ExecutorResult` contract as `LocalExecutor`, so callers can swap between them.
The protobuf stream is consumed as raw `Buffer` frames; text encoding is only
applied to the Rust process's stderr, never to stdio protocol payloads.

The CLI can verify the boundary directly:

```bash
node apps/cli/dist/index.js --check-rust \
  runtime/rust/target/debug/dev-agent-executor
```

`--check-rust` sends a `HealthCheck` envelope and decodes the
`HealthCheckResult` nested inside the `Response` protobuf payload.

### Testing the boundary without Rust

`tests/mock-executor-binary.mjs` is a self-contained mock of the Rust binary. It
speaks the same length-prefixed protobuf protocol (with a hand-rolled protobuf
wire-format implementation, so it needs no external dependencies). Behavior is
controlled via the `MOCK_EXECUTOR_BEHAVIOR` environment variable:

- `default` — echoes back a `RunResult` with stdout `mock:{command}`
- `reflect` — echoes back the exact `RunRequest` payload as JSON in stdout
- `error:CODE` — responds with an `ErrorResult` using the given code
- `hang` — never responds (for timeout/disconnect tests)

`tests/mock-binary.test.mjs` validates the mock binary's protocol implementation
by encoding requests, sending them over stdio, and decoding the responses. This
verifies the protobuf wire format matches what the Rust `prost` crate produces.

`tests/protobuf-roundtrip.test.mjs` verifies the other direction: it replicates
the TypeScript encoding logic from `RustExecutor` (without importing protobufjs),
sends encoded requests to the mock binary, and decodes the responses. This
validates that the TS-side encoding and decoding logic is correct.

### Factory function

`createExecutor(options)` provides a simple way to choose between `LocalExecutor`
and `RustExecutor`:

```ts
import { createExecutor } from "@dev-agent/executor";

// Use local executor (default)
const local = createExecutor();

// Use Rust executor with a specific binary path
const rust = createExecutor({ rustBinaryPath: "./runtime/rust/target/debug/dev-agent-executor" });
```

The Rust crate (`dev-agent-runtime`) provides:

- `LocalExecutor` — a Rust port of the Node `LocalExecutor`, used as the
  baseline implementation.
- `SandboxExecutor` — evaluates an optional Starlark `policy_script` before
  executing through the restricted backend. The Starlark interpreter-backed
  allow/deny path and macOS `sandbox-exec` filesystem/network enforcement are
  active.
- `dev-agent-executor` binary — reads `Envelope` messages from stdin and writes
  `Response` messages to stdout, serving as the stdio transport.

See `runtime/rust/README.md` for the full plan, including the Starlark policy
language.
