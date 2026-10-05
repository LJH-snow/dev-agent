# Progress — managed runtime inspect→spawn TOCTOU narrowing

## 2026-10-05

- Residual being addressed: the managed runtime binary was fully validated
  (private modes, regular file, size, checksum) when `RuntimeManager.path()`
  selected it, but nothing re-checked it before `RustExecutor.spawn()`. A
  same-UID process could swap the binary after selection and before the first
  tool execution.
- RED first: two new `packages/executor/tests/rust-executor.test.ts` cases —
  a rejecting `verifyBeforeSpawn` fails `run()` closed before any spawn, and a
  recording verifier receives the binary path and the mock run still succeeds.
  Confirmed failing before implementation (12/14), green after (14/14).
- Implementation:
  - `RustExecutorOptions.verifyBeforeSpawn?: (binaryPath) => Promise<void>|void`
    runs in `start()` after all other startup steps and immediately before
    `spawn()` — the narrowest window. A rejection aborts the start.
  - `createExecutor()` forwards the hook.
  - `createCliRuntimeSpawnVerifier` (runtime-command.ts) wraps a fresh
    `RuntimeManager` and re-runs `manager.path()` — a second full inspection
    including checksum + owner/mode — and refuses if the validated path no
    longer matches the selected one.
  - CLI main wires the verifier only when the executor source is the managed
    runtime (`runtimeSelectionSource === "runtime"`); explicit
    `--rust-executor` / `DEV_AGENT_RUST_BINARY` paths stay caller-trusted by
    the documented contract.
- Verification: executor full suite 61/61 (2 new), CLI full suite 842/842.
- Residual honestly stated: the window is narrowed to
  second-inspect→spawn (milliseconds), not eliminated; an attacker who can
  rewrite the cache directory content *and* its install metadata/complete
  marker consistently (same-UID planted state) still re-baselines the trust
  anchor and remains out of scope, as does a root attacker. No runtime
  security proof is claimed.
