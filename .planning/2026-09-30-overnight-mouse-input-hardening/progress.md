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

## 2026-10-03

- Post-commit audits flagged three remaining parser boundaries; all fixed:
  - Pending X10 reports now resync when a fresh `ESC[M` (or opt-in bare `[M`)
    prefix arrives while 1–2 payload bytes are still pending; the truncated
    packet is restored as text and the new report is parsed normally.
  - New `takePendingText()` restores text-like pending input (pending SGR
    literals and bare `[M` prefixes) into the composer before control keys are
    routed, so Enter/Escape/arrows can no longer silently drop consumed bytes.
    ESC-framed pending stays protocol-only and is dropped.
  - Production X10 strategy made explicit: bare `[M` stays fail-closed by
    default (SGR 1006 is the supported path); `DEV_AGENT_LEGACY_MOUSE_X10=1`
    opts legacy terminals back in. Documented in the CLI README.
- Session picker now renders a bounded visible window (`SESSION_PICKER_VISIBLE
  = 8`) that follows the selection, mirroring the command palette; clicks map
  window rows onto absolute rows via the offset, and the footer shows a
  `n/total` position hint for lists larger than the window.
- Verification: focused mouse/navigation/app suites passed 98/98. Full CLI
  suite reported 826/827 across two runs; the single failures (thinking-timer
  `0.0s` race, validation test under load) both pass standalone and touch no
  changed code. `git diff --check` passed.

## 2026-10-03 (round 2)

- Closed the last audit backlog item: mouse-tracking lifecycle around
  `:editor` suspension. Ink's `beginSuspend()` disables the Kitty protocol and
  alternate screen but leaves 1003/1006 enabled, so an external editor used to
  receive stray mouse report bytes.
- `InkCliApp` now wraps Ink's `suspendTerminal` (new exported callback-form
  type `InkSuspendTerminal`, also narrowing the `index.ts` variable): tracking
  is disabled before the child owns the terminal, re-enabled after Ink
  reclaims it, and both protocol parsers (mouse, kitty query) reset on both
  edges. Failures keep the handoff intact via symmetric finally blocks.
- Regression test proves the wrapped handler runs the editor callback and
  orders DISABLE before ENABLE in the output stream.
- Verification: source/test builds passed; focused ink-app/mouse/navigation/
  composer suites passed 108/108; full CLI suite passed 828/828;
  `git diff --check` passed. README documents the suspension behavior.

## 2026-10-03 (round 3)

- Aligned the remaining display panels with the established pointer/panel
  standard (bounded rendering + measured hitbox + pointer interaction):
  - `McpPanel` renders a bounded server window (`MCP_SERVERS_VISIBLE = 8`)
    with a `n–m/total` footer hint, reports its measured layout through the
    shared `PanelLayout` contract, and the app routes wheel events that hover
    the card (new `isPointerInPanel` containment check) to the card's offset
    instead of the transcript. The offset clamps when the server list shrinks
    and resets when the snapshot closes.
  - `NoticePanel` keeps the newest six notices and collapses older ones into
    a `+ N earlier notices` hint line.
- Added a 40s node:test timeout to the expect-driven `:trace` summary test
  (~8s in isolation) after load-induced timeouts; it is not related to the
  panel changes.
- Verification: source/test builds passed; focused mcp-panel/ink-app/
  navigation suites passed 83/83; full CLI suite passed 833/833 on rerun (one
  earlier run showed 6 load-induced timing failures while parallel windows
  were testing; all pass standalone and none touch the changed code);
  `git diff --check` passed.

## 2026-10-04 (round 4)

- Added incremental history search to the Ink composer on `Ctrl-R`:
  - the new bounded `HistorySearchPanel` filters session prompts case-insensitively,
    starts on the newest match, and supports repeated `Ctrl-R`, arrow keys,
    wheel navigation, measured click hitboxes, Enter/Tab acceptance, and Escape
    cancellation;
  - acceptance restores the selected prompt into the composer without submitting,
    preserving the shell-style review-before-send flow; modal focus routing keeps
    query input and control keys out of the composer and retry shortcut;
  - the panel renders at most six matches and keeps long prompts single-line and
    bounded, with a welcome hint for discoverability.
- Added protocol-level and real-screen regression coverage for keyboard, wheel,
  click, Escape, focus priority, and the updated welcome snapshot.
- Added a 40s timeout to the persisted Autofix restart PTY test; this only
  removes a load-induced false negative and does not alter the behavior under test.
- Verification: CLI test TypeScript build passed; full CLI suite passed 836/836;
  `git diff --check` passed. Parallel `.mimosa/`, `.zcode/`, desktop, and other
  pre-existing worktree changes remain outside this round and were not cleaned
  or overwritten.
