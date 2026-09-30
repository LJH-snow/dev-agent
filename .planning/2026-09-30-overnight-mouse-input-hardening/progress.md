# Progress — overnight CLI mouse-input hardening

## 2026-09-30

- Baseline inspected before edits: current branch contains unrelated desktop
  worktree changes in `apps/desktop`; those files are out of scope.
- Existing X10 parser supports normal split `[M` payloads but keeps incomplete
  state indefinitely and drops invalid decoded packets; implementation is being
  hardened at the parser boundary.
- Added bounded X10/SGR pending state with injectable timeout, explicit `reset()`
  and `resetX10()`, malformed-packet preservation, and lifecycle resets in the
  Ink app.
- Made ESC-stripped X10 opt-in (`allowEscStrippedX10`) because bare `[M` is
  ambiguous with composer text; production uses the fail-closed default.
- Added regression coverage for timeout recovery, malformed input, reset,
  byte-by-byte payloads, ESC-framed same-chunk splits, SGR marker fragments,
  ordinary bracket preservation, and default bare-X10 rejection.
- Verification on 2026-09-30: source/test TypeScript builds passed; focused
  mouse, navigation, and Ink app suites passed 94/94; `git diff --check` passed.
- Unrelated desktop changes remain in the worktree and were not staged,
  reverted, or otherwise overwritten.
