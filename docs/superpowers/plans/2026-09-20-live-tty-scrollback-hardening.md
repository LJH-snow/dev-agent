# Live TTY Scrollback Hardening Plan

> Date: 2026-09-20
>
> Scope: Ink rich TTY rendering in `apps/cli`.

## Goal

Keep the Signal Loom launch surface visually rich without allowing the launch
frame to turn later prompt updates into full-screen redraws that erase terminal
scrollback or leave a large blank viewport.

## Root Cause

Ink treats a dynamic frame whose height reaches the terminal row count as a
full-screen frame. If the launch welcome remains inside that dynamic frame,
the first prompt can trigger the clear-terminal branch. That branch includes
the terminal scrollback erase sequence, so the user cannot scroll back through
the session while the CLI is active.

## Implementation

- [x] Add a real TTY regression test with a short terminal height.
- [x] Render the Signal Loom welcome surface through Ink `Static` output once.
- [x] Keep only the active transcript, status, composer, and footer in the
      dynamic viewport.
- [x] Keep completed run entries in static scrollback output.
- [x] Merge the welcome and completed transcript items into one root-level
      `Static` sequence, matching Ink 6's single static-node lifecycle.
- [x] Add a stable React key for the static welcome item.
- [x] Normalize zero PTY dimensions before Ink's first render so a wrapper
      cannot trigger the full-screen clear-terminal path.

## Acceptance

- A prompt submitted after launch must not emit
  `ESC [2J ESC [3J ESC [H` from the Ink dynamic update.
- The launch mark, tips, composer, and session footer remain visible.
- Completed answers are not repainted into later active frames.
- A PTY that reports `rows=0` or `columns=0` during startup does not clear
  terminal scrollback.
- Existing queue, approval, cancellation, EOF, resize, and non-rich output
  contracts remain unchanged.

## Verification

Focused TTY regression:

```text
Ink keeps the launch welcome out of the dynamic viewport: passed
```

Final verification completed:

- Ink app tests: **11/11**.
- CLI full suite: **421/421**.
- `pnpm test:evals`: **6/6**.
- `pnpm verify:typescript`: passed, including workspace build/typecheck,
  Desktop **143/143**, Tools **152/152**, documentation contracts **57/57**,
  package-install smoke, and release-boundary contracts.
- `git diff --check`: passed.
- No npm publish, tag, release, or network package release was performed.

Follow-up hardening completed on 2026-09-21:

- Added a terminal-size normalizer with resize reapplication and defaults of
  80 columns by 24 rows when the PTY reports zero dimensions.
- Verified the real PTY startup path emits zero clear-terminal sequences.
- Submitted prompts now move into Ink static scrollback as soon as their run
  starts. The live frame retains only the active assistant response, status,
  composer, and footer, so the prompt is not duplicated or left inside a tall
  blank viewport.
- Added a regression covering the prompt-to-scrollback transition and
  asserting that the submitted prompt is rendered exactly once before its
  answer completes.

Follow-up verification completed on 2026-09-21:

- CLI full suite: **443/443**.
- Agent Core: **173/173**.
- Tools: **153/153**.
- Rich CLI behavior evaluations: **6/6**.
- `git diff --check`: passed.

Verification refreshed on 2026-09-21:

- Rebuilt both `dist/index.js` and the package entry bundle
  `dist/cli.js`, which is the bundle used by the local global `dev-agent`
  symlink.
- Added a tall-terminal regression with 80 rows. The active status,
  composer, and footer remain close to the transcript instead of being
  positioned at the bottom of the terminal.
- Confirmed that completed transcript items remain in terminal scrollback.
- A native terminal wheel gesture made while Ink is continuously repainting
  can still return the viewport to the live cursor on the next frame. A true
  always-scrollable live viewport would require a separate internal scroll
  mode or mouse-tracking implementation; it is outside this compact-layout
  correction.
