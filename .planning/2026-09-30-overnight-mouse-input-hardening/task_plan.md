# Overnight CLI mouse-input hardening

## Goal

Make the Ink mouse protocol boundary fail closed when an X10 report is split,
truncated, malformed, or delayed. A partial `[M` prefix must not keep consuming
future composer text forever, and invalid packets must be returned to the normal
input path instead of being silently dropped.

## Scope and boundaries

- Touch only `apps/cli/src/ink/mouse-wheel.ts`, its focused tests, and the
  mouse-tracking cleanup in `apps/cli/src/ink/app.tsx` if required.
- Do not touch the parallel desktop worktree changes or unrelated CLI features.
- No runtime dependency and no changes to Ink internals.
- Preserve current SGR/X10 wheel, click, motion, and Ink ESC-stripped behavior.
- Keep all input buffering bounded and fail closed.

## Phases

1. **Protocol audit and design**
   - Keep split X10 support for normal short-lived PTY fragmentation.
   - Add a bounded pending lifetime and an explicit reset operation.
   - Preserve an expired/malformed prefix and payload as `remaining` text.
   - Validate X10 byte range and decoded coordinates before consuming a packet.

2. **Implementation**
   - Store the exact X10 prefix, payload, and start time.
   - Expire pending state after a small bounded window; never wait forever.
   - On invalid packet, return the original bytes to the caller.
   - Reset parser state when mouse tracking is disabled/unmounted.

3. **Regression coverage**
   - Existing SGR/X10 click, wheel, motion, and adjacent text tests.
   - Delayed partial prefix restores literal input.
   - Malformed X10 packet is not silently consumed.
   - Reset clears pending state.
   - Real Ink navigation still handles a wheel event after parser changes.

4. **Verification**
   - Build source and tests, run focused mouse/navigation suites, run typechecks,
     and run `git diff --check`.
   - Record exact results and any unrelated concurrent failures.
